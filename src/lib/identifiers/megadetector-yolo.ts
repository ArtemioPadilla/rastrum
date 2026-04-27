/**
 * YOLOv5 helpers for the on-device MegaDetector v5a plugin.
 *
 * Pure functions, no DOM / ONNX dependency — kept testable. The plugin
 * file (`camera-trap-megadetector.ts`) wires these together with the
 * Canvas + onnxruntime-web pieces.
 *
 * MegaDetector v5a is a YOLOv5 export from Microsoft AI for Earth.
 * The model expects a 640×640 RGB float32 NCHW tensor in [0, 1] and
 * outputs `[1, 25200, 9]` per the standard YOLOv5 head:
 *
 *     [cx, cy, w, h, obj_conf, cls_animal, cls_human, cls_vehicle, cls_empty]
 *
 * Some operator builds drop the empty class (8 elements). We support
 * both shapes.
 *
 * Refs: https://github.com/agentmorris/MegaDetector
 */

export const YOLO_INPUT_SIZE = 640;

/** Class index → label, matching MegaDetector v5a's training. */
export const MD_CLASS_LABELS = ['animal', 'human', 'vehicle', 'empty'] as const;
export type MdClassLabel = (typeof MD_CLASS_LABELS)[number];

export interface YoloDetection {
  /** xyxy in input-tensor pixel space (0..640). */
  bbox: [number, number, number, number];
  /** Final confidence = obj_conf × class_conf. */
  confidence: number;
  /** Index into MD_CLASS_LABELS. */
  classIndex: number;
  classLabel: MdClassLabel;
}

export interface LetterboxResult {
  /** NCHW float32 tensor data, length = 1 * 3 * size * size. */
  data: Float32Array;
  /** Same dims as expected by MegaDetector. */
  dims: [number, number, number, number];
  /** Scale + pad applied — used to undo letterbox in postprocess. */
  scale: number;
  padX: number;
  padY: number;
}

/**
 * Letterbox-resize an `ImageData`-shaped RGBA source into a square
 * RGB float32 tensor in [0, 1], NCHW. Aspect ratio is preserved; the
 * remaining border is filled with grey (114/255), matching the YOLOv5
 * preprocessing convention so the model's training distribution is
 * preserved.
 *
 * The caller is expected to have drawn the source image into a
 * canvas (any size) and obtained its `ImageData` via `getImageData`.
 * We rescale here rather than in the canvas so this is testable in
 * pure JS (no DOM).
 */
export function letterboxRgba(
  src: { data: Uint8ClampedArray; width: number; height: number },
  size: number = YOLO_INPUT_SIZE,
): LetterboxResult {
  const scale = Math.min(size / src.width, size / src.height);
  const newW = Math.round(src.width * scale);
  const newH = Math.round(src.height * scale);
  const padX = Math.floor((size - newW) / 2);
  const padY = Math.floor((size - newH) / 2);

  // NCHW: 3 planes (R, G, B), each size×size, contiguous.
  const out = new Float32Array(3 * size * size);
  const planeSize = size * size;
  // Default-fill the entire output with the grey letterbox value (114/255).
  out.fill(114 / 255);

  for (let y = 0; y < newH; y++) {
    // Nearest-neighbour sampling — fine for filter/detect models, much
    // faster than bilinear on cold devices.
    const sy = Math.min(src.height - 1, Math.floor(y / scale));
    for (let x = 0; x < newW; x++) {
      const sx = Math.min(src.width - 1, Math.floor(x / scale));
      const sIdx = (sy * src.width + sx) * 4;
      const dy = y + padY;
      const dx = x + padX;
      const idx = dy * size + dx;
      out[0 * planeSize + idx] = src.data[sIdx]     / 255; // R
      out[1 * planeSize + idx] = src.data[sIdx + 1] / 255; // G
      out[2 * planeSize + idx] = src.data[sIdx + 2] / 255; // B
    }
  }

  return { data: out, dims: [1, 3, size, size], scale, padX, padY };
}

/**
 * Decode the YOLOv5 output tensor into a flat list of detections.
 * Accepts the standard `[1, N, 8|9]` layout. Filters by
 * `obj_conf × class_conf > minConfidence` and runs class-agnostic NMS.
 *
 * The output bboxes are still in input-tensor pixel space; the caller
 * should `unletterbox()` to map back to source coordinates if needed.
 */
export function postprocessYolo(opts: {
  raw: Float32Array;
  numAnchors: number;
  numAttrs: number;
  minConfidence?: number;
  iouThreshold?: number;
  maxDetections?: number;
}): YoloDetection[] {
  const { raw, numAnchors, numAttrs } = opts;
  const minConfidence = opts.minConfidence ?? 0.2;
  const iouThreshold = opts.iouThreshold ?? 0.45;
  const maxDetections = opts.maxDetections ?? 300;
  const numClasses = numAttrs - 5;
  if (numClasses < 1) return [];

  const candidates: YoloDetection[] = [];
  for (let i = 0; i < numAnchors; i++) {
    const off = i * numAttrs;
    const objConf = raw[off + 4];
    if (objConf < minConfidence) continue;

    let bestCls = -1;
    let bestClsConf = 0;
    for (let c = 0; c < numClasses; c++) {
      const v = raw[off + 5 + c];
      if (v > bestClsConf) { bestClsConf = v; bestCls = c; }
    }
    const conf = objConf * bestClsConf;
    if (conf < minConfidence) continue;

    const cx = raw[off + 0];
    const cy = raw[off + 1];
    const w  = raw[off + 2];
    const h  = raw[off + 3];
    candidates.push({
      bbox: [cx - w / 2, cy - h / 2, cx + w / 2, cy + h / 2],
      confidence: conf,
      classIndex: bestCls,
      classLabel: (MD_CLASS_LABELS[bestCls] ?? 'animal'),
    });
  }

  candidates.sort((a, b) => b.confidence - a.confidence);
  return nms(candidates, iouThreshold).slice(0, maxDetections);
}

/** Standard non-max suppression. Class-agnostic — MegaDetector's classes
 *  are mutually exclusive in practice (no overlapping animal+human boxes
 *  on the same crop). */
function nms(dets: YoloDetection[], iouThreshold: number): YoloDetection[] {
  const keep: YoloDetection[] = [];
  const used = new Array<boolean>(dets.length).fill(false);
  for (let i = 0; i < dets.length; i++) {
    if (used[i]) continue;
    keep.push(dets[i]);
    for (let j = i + 1; j < dets.length; j++) {
      if (used[j]) continue;
      if (iou(dets[i].bbox, dets[j].bbox) > iouThreshold) used[j] = true;
    }
  }
  return keep;
}

function iou(a: [number, number, number, number], b: [number, number, number, number]): number {
  const [ax1, ay1, ax2, ay2] = a;
  const [bx1, by1, bx2, by2] = b;
  const x1 = Math.max(ax1, bx1);
  const y1 = Math.max(ay1, by1);
  const x2 = Math.min(ax2, bx2);
  const y2 = Math.min(ay2, by2);
  const inter = Math.max(0, x2 - x1) * Math.max(0, y2 - y1);
  const areaA = Math.max(0, ax2 - ax1) * Math.max(0, ay2 - ay1);
  const areaB = Math.max(0, bx2 - bx1) * Math.max(0, by2 - by1);
  const union = areaA + areaB - inter;
  return union > 0 ? inter / union : 0;
}

/**
 * Map a detection from input-tensor coords back to source-image coords,
 * undoing the letterbox transform.
 */
export function unletterbox(
  bbox: [number, number, number, number],
  ctx: { scale: number; padX: number; padY: number },
): [number, number, number, number] {
  const [x1, y1, x2, y2] = bbox;
  return [
    Math.max(0, (x1 - ctx.padX) / ctx.scale),
    Math.max(0, (y1 - ctx.padY) / ctx.scale),
    Math.max(0, (x2 - ctx.padX) / ctx.scale),
    Math.max(0, (y2 - ctx.padY) / ctx.scale),
  ];
}

/**
 * Pick the dominant detection: highest confidence overall. Treats the
 * frame as `empty` when no detection clears the threshold.
 */
export function pickDominant(
  detections: YoloDetection[],
  emptyThreshold: number = 0.2,
): { label: MdClassLabel; detection?: YoloDetection } {
  if (detections.length === 0 || detections[0].confidence < emptyThreshold) {
    return { label: 'empty' };
  }
  return { label: detections[0].classLabel, detection: detections[0] };
}
