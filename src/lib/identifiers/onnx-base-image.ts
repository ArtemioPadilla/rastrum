/**
 * Pure image-preprocessing helpers for the EfficientNet-Lite0 ONNX
 * identifier. Mirrors the structure of `birdnet-audio.ts` but for the
 * vision side: the runtime adapter (`onnx-base.ts`) decodes a Blob/URL
 * into a 224×224 RGB byte array and this module turns that into the NCHW
 * Float32 tensor the model expects.
 *
 * Everything here is dependency-free and side-effect-free so it can be
 * unit-tested without a browser.
 */

/** Square input edge in pixels EfficientNet-Lite0 was trained on. */
export const ONNX_BASE_INPUT_SIZE = 224;
/** Top-K predictions to surface per identification. */
export const ONNX_BASE_TOP_K = 5;

/**
 * Standard ImageNet ILSVRC mean (per RGB channel, in [0, 1]).
 * Used by every torchvision/keras reference EfficientNet recipe.
 */
export const IMAGENET_MEAN: readonly [number, number, number] = [0.485, 0.456, 0.406];
/** Standard ImageNet ILSVRC std (per RGB channel, in [0, 1]). */
export const IMAGENET_STD: readonly [number, number, number] = [0.229, 0.224, 0.225];

export interface TopKEntry {
  classIdx: number;
  score: number;
}

/**
 * Convert RGBA pixel bytes (length = w*h*4, e.g. from a canvas
 * ImageData) into a NCHW Float32 tensor of shape [1, 3, H, W],
 * normalised against the ImageNet mean/std.
 *
 * The alpha channel is dropped. Pixel values are first scaled to [0, 1]
 * by dividing by 255, then standardised: `(x - mean) / std`.
 */
export function preprocessRgba(
  rgba: Uint8ClampedArray | Uint8Array,
  width: number,
  height: number,
): Float32Array {
  if (width <= 0 || height <= 0) return new Float32Array(0);
  const expected = width * height * 4;
  if (rgba.length < expected) {
    throw new Error(`preprocessRgba: expected ${expected} bytes, got ${rgba.length}`);
  }
  const planeSize = width * height;
  const out = new Float32Array(3 * planeSize);
  for (let i = 0; i < planeSize; i++) {
    const r = rgba[i * 4 + 0] / 255;
    const g = rgba[i * 4 + 1] / 255;
    const b = rgba[i * 4 + 2] / 255;
    out[0 * planeSize + i] = (r - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    out[1 * planeSize + i] = (g - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    out[2 * planeSize + i] = (b - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
  }
  return out;
}

/**
 * Numerically-stable softmax. Some EfficientNet ONNX exports emit raw
 * logits, others a softmax already; we apply this defensively so top-K
 * scores read as probabilities either way (a softmax of an
 * already-softmaxed vector is still a valid probability distribution).
 */
export function softmax(logits: ArrayLike<number>): Float32Array {
  const out = new Float32Array(logits.length);
  if (logits.length === 0) return out;
  let max = -Infinity;
  for (let i = 0; i < logits.length; i++) {
    const v = logits[i];
    if (v > max) max = v;
  }
  let sum = 0;
  for (let i = 0; i < logits.length; i++) {
    const e = Math.exp(logits[i] - max);
    out[i] = e;
    sum += e;
  }
  if (sum === 0) return out;
  for (let i = 0; i < logits.length; i++) out[i] = out[i] / sum;
  return out;
}

/**
 * Return the indices and scores of the top-K entries, sorted high → low.
 * Stable for ties via insertion order.
 */
export function topK(scores: ArrayLike<number>, k: number): TopKEntry[] {
  const entries: TopKEntry[] = [];
  for (let i = 0; i < scores.length; i++) {
    entries.push({ classIdx: i, score: scores[i] });
  }
  entries.sort((a, b) => b.score - a.score);
  return entries.slice(0, Math.max(0, k));
}

/**
 * Parse a single ImageNet label row.
 *
 * The labels file we ship is the standard ImageNet ILSVRC 2012 mapping
 * with one synset per line, formatted `nXXXXXXXX label[, alt]`. Some
 * widely-shared variants drop the WordNet id and emit only the label.
 * We accept either.
 */
export interface ParsedLabel {
  /**
   * Best-effort scientific or English label. ImageNet is ENGLISH common
   * names — we return the first comma-separated alias as the canonical
   * form. Genuine taxonomic names are recovered later via a lookup.
   */
  label: string;
  /** WordNet synset id when present (e.g. 'n01440764'). */
  synset: string | null;
}
export function parseLabel(raw: string): ParsedLabel {
  const trimmed = raw.trim();
  if (!trimmed) return { label: '', synset: null };
  const m = /^(n\d{8})\s+(.+)$/.exec(trimmed);
  if (m) {
    return {
      label: (m[2].split(',')[0] ?? '').trim(),
      synset: m[1],
    };
  }
  return { label: (trimmed.split(',')[0] ?? '').trim(), synset: null };
}
