/**
 * Camera-trap MegaDetector v5a — on-device ONNX (YOLOv5).
 *
 * Filters camera-trap photos as animal / human / vehicle / empty in the
 * browser via onnxruntime-web. Frames with no animal short-circuit the
 * cascade (FilteredFrameError) so we don't burn cloud quota on empty
 * shots. Frames *with* an animal throw "no species detected" so the
 * cascade falls through to the species-classification plugins
 * (PlantNet → Claude → Phi → EfficientNet) using the same input image.
 *
 * Weights aren't bundled — the operator hosts the ONNX file at
 * `${PUBLIC_MEGADETECTOR_WEIGHTS_URL}/megadetector_v5a.onnx` and the
 * user downloads it once via the onboarding tour or
 * Profile → Edit → AI settings.
 *
 * License: code MIT (this file). Model: MIT (Microsoft AI for Earth).
 * Cite: Beery, Morris & Yang (2019), Efficient pipeline for camera-trap
 * image review.
 *
 * Future work — see docs/specs/modules/09-camera-trap.md:
 *   - bbox-aware species ID (crop to detection then run cascade on crop)
 *   - distilled SpeciesNet for on-device animal classification
 *   - server-side fallback via PUBLIC_MEGADETECTOR_ENDPOINT (already
 *     wired in v1.0.x; keep as a switchable path).
 */
import type { Identifier, IDResult, IdentifyInput } from './types';
import { FilteredFrameError } from './errors';
import {
  getMegadetectorWeightsBaseUrl, getMegadetectorCacheStatus, getCachedModelBuffer,
} from './megadetector-cache';
import {
  letterboxRgba, postprocessYolo, pickDominant, YOLO_INPUT_SIZE, type LetterboxResult,
} from './megadetector-yolo';

export const CAMERA_TRAP_PLUGIN_ID = 'camera_trap_megadetector';

// Module-level ONNX session — keep across calls so the ~134 MB parse
// happens once per page lifetime. Cleared on `clearMegadetectorCache()`
// elsewhere if the model is removed.
type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | unknown; dims?: number[] }>>;
};
let session: OrtSession | null = null;

async function ensureSession(): Promise<OrtSession> {
  if (session) return session;
  const buffer = await getCachedModelBuffer();
  if (!buffer) {
    throw new Error(
      'MegaDetector model is not cached. Open Profile → Edit → AI settings (or replay the onboarding tour) to download it.',
    );
  }
  const ort = await import('onnxruntime-web');
  const factory = (ort as unknown as {
    InferenceSession: { create(buf: ArrayBuffer, opts?: unknown): Promise<OrtSession> };
  }).InferenceSession;
  session = await factory.create(buffer, { executionProviders: ['wasm'] });
  return session;
}

async function decodeImageToRgba(
  input: IdentifyInput,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  let blob: Blob;
  if (input.media.kind === 'url') {
    const res = await fetch(input.media.url, { mode: 'cors' });
    if (!res.ok) throw new Error(`MegaDetector: photo fetch failed (HTTP ${res.status})`);
    blob = await res.blob();
  } else if (input.media.kind === 'blob') {
    blob = input.media.blob;
  } else {
    blob = new Blob([new Uint8Array(input.media.bytes)], { type: input.media.mime });
  }
  const bitmap = await createImageBitmap(blob);
  const canvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(bitmap.width, bitmap.height)
    : (() => {
        const c = document.createElement('canvas');
        c.width = bitmap.width; c.height = bitmap.height;
        return c as unknown as OffscreenCanvas;
      })();
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!ctx) throw new Error('MegaDetector: 2D canvas unavailable');
  ctx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
  const img = ctx.getImageData(0, 0, bitmap.width, bitmap.height);
  bitmap.close?.();
  return { data: img.data, width: img.width, height: img.height };
}

async function runYolo(letterboxed: LetterboxResult): Promise<{
  raw: Float32Array; numAnchors: number; numAttrs: number;
}> {
  const sess = await ensureSession();
  const ort = await import('onnxruntime-web');
  const TensorCtor = (ort as unknown as {
    Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
  }).Tensor;
  const inputName = sess.inputNames[0] ?? 'images';
  const inputTensor = new TensorCtor('float32', letterboxed.data, letterboxed.dims);
  const feeds = { [inputName]: inputTensor };
  const outputs = await sess.run(feeds);
  const outName = sess.outputNames[0] ?? Object.keys(outputs)[0];
  const out = outputs[outName];
  if (!out || !out.data || !(out.data instanceof Float32Array) || !out.dims) {
    throw new Error('MegaDetector: unexpected ONNX output shape');
  }
  const dims = out.dims;
  // Standard YOLOv5 export: [1, N, attrs]. Some builds: [1, attrs, N].
  // Detect by which axis equals 8 or 9 (the attribute count).
  let numAnchors: number, numAttrs: number, raw: Float32Array;
  if (dims.length === 3 && (dims[2] === 8 || dims[2] === 9)) {
    numAnchors = dims[1];
    numAttrs = dims[2];
    raw = out.data;
  } else if (dims.length === 3 && (dims[1] === 8 || dims[1] === 9)) {
    // Transpose [1, attrs, N] → [1, N, attrs] virtually by re-indexing.
    numAnchors = dims[2];
    numAttrs = dims[1];
    const flat = new Float32Array(numAnchors * numAttrs);
    for (let a = 0; a < numAnchors; a++) {
      for (let f = 0; f < numAttrs; f++) {
        flat[a * numAttrs + f] = out.data[f * numAnchors + a];
      }
    }
    raw = flat;
  } else {
    throw new Error(`MegaDetector: unsupported output dims ${JSON.stringify(dims)}`);
  }
  return { raw, numAnchors, numAttrs };
}

export const cameraTrapMegadetectorIdentifier: Identifier = {
  id: CAMERA_TRAP_PLUGIN_ID,
  name: 'MegaDetector v5a (camera trap)',
  brand: '🎥',
  description:
    'On-device YOLOv5 detector. Filters camera-trap photos as animal / human / vehicle / empty before any cloud round-trip. Runs entirely in this browser; photos never leave your device for this filtering step.',
  setupSteps: [
    {
      text: 'Profile → Edit → AI settings → MegaDetector → Download (~134 MB).',
    },
    {
      text: 'After download, the filter runs offline. Empty / human / vehicle frames short-circuit the cascade and land in needs_review.',
    },
    {
      text: 'Operator: convert MegaDetector v5a to ONNX and host as megadetector_v5a.onnx behind PUBLIC_MEGADETECTOR_WEIGHTS_URL (CORS-open).',
      link: 'https://github.com/agentmorris/MegaDetector',
      details: 'See docs/specs/modules/09-camera-trap.md for the conversion recipe.',
    },
  ],
  capabilities: {
    media: ['photo'],
    taxa: ['Animalia', '*'],
    runtime: 'client',
    license: 'free',
    cost_per_id_usd: 0,
    // The detector doesn't classify species; we surface it with a low
    // ceiling so the cascade always tries a downstream species model
    // when an animal IS detected.
    confidence_ceiling: 0.4,
  },

  async isAvailable() {
    if (!getMegadetectorWeightsBaseUrl()) {
      return {
        ready: false,
        reason: 'model_not_bundled',
        message: 'PUBLIC_MEGADETECTOR_WEIGHTS_URL is not set.',
      };
    }
    const status = await getMegadetectorCacheStatus();
    if (!status.modelCached) {
      return { ready: false, reason: 'needs_download', message: '~134 MB download (model only).' };
    }
    return { ready: true };
  },

  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.mediaKind !== 'photo') {
      throw new Error('camera_trap_megadetector: requires mediaKind=photo');
    }
    const onProgress = input.onProgress ?? (() => {});

    onProgress({ progress: 0.05, text: 'Loading MegaDetector…' });
    await ensureSession();

    onProgress({ progress: 0.3, text: 'Decoding photo…' });
    const rgba = await decodeImageToRgba(input);

    onProgress({ progress: 0.55, text: 'Preparing tensor…' });
    const lb = letterboxRgba(rgba, YOLO_INPUT_SIZE);

    onProgress({ progress: 0.7, text: 'Running detector…' });
    const { raw, numAnchors, numAttrs } = await runYolo(lb);
    const detections = postprocessYolo({
      raw, numAnchors, numAttrs,
      minConfidence: 0.2, iouThreshold: 0.45,
    });
    const dominant = pickDominant(detections, 0.2);

    onProgress({ progress: 1, text: 'Done.' });

    if (dominant.label === 'empty' || dominant.label === 'human' || dominant.label === 'vehicle') {
      throw new FilteredFrameError({
        filtered_label: dominant.label,
        source: CAMERA_TRAP_PLUGIN_ID,
        raw: { detections, top: dominant.detection ?? null },
      });
    }

    // Animal detected — but MegaDetector doesn't classify species. Throw
    // so the cascade falls through to a species-capable plugin. The bbox
    // is preserved in the error.raw payload for callers that want to
    // pre-crop in a future iteration (see module 09 spec, "next steps").
    const err = new Error(
      'camera_trap_megadetector: animal detected but species classification not on-device — falling through to cascade.',
    ) as Error & { animal_bbox?: number[]; raw?: unknown };
    if (dominant.detection) err.animal_bbox = dominant.detection.bbox;
    err.raw = { detections, top: dominant.detection };
    throw err;
  },
};
