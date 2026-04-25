/**
 * Pure audio-preprocessing helpers for the BirdNET-Lite identifier.
 *
 * BirdNET-Lite expects a 3-second mono buffer at 48 kHz, normalised to
 * [-1, 1]. The model emits a softmax over its 6,522-class label set;
 * we take the top-K and map indices back through the labels file.
 *
 * Everything in this module is dependency-free and side-effect-free so
 * it can be unit-tested without a browser. The runtime adapter
 * (`birdnet.ts`) is responsible for decoding audio (Web Audio API) and
 * running the ONNX session — both of which are browser-only.
 */

/** Sample rate the BirdNET model was trained on. */
export const BIRDNET_SAMPLE_RATE = 48000;
/** Window length in samples = 3 s × 48 kHz. */
export const BIRDNET_WINDOW_SAMPLES = 144000;
/** Top-K predictions to return per identification. */
export const BIRDNET_TOP_K = 5;

export interface ParsedLabel {
  scientific_name: string;
  common_name_en: string | null;
}

/**
 * BirdNET label rows are formatted `Genus species_Common Name`. Some rows
 * (extinct, hybrid, abbreviated) lack an underscore — fall back to the
 * raw token as the scientific name in that case.
 */
export function parseLabel(raw: string): ParsedLabel {
  const trimmed = raw.trim();
  if (!trimmed) return { scientific_name: '', common_name_en: null };
  const idx = trimmed.indexOf('_');
  if (idx < 0) return { scientific_name: trimmed, common_name_en: null };
  const sci = trimmed.slice(0, idx).trim();
  const com = trimmed.slice(idx + 1).trim();
  return {
    scientific_name: sci,
    common_name_en: com.length > 0 ? com : null,
  };
}

/**
 * Nearest-neighbour resampler. Fast and good-enough for BirdNET, which
 * is itself trained on noisy field recordings — a high-quality polyphase
 * filter is not worth the bundle weight.
 */
export function resampleNearest(samples: Float32Array, fromRate: number, toRate: number): Float32Array {
  if (fromRate === toRate) return samples;
  if (fromRate <= 0 || toRate <= 0) return new Float32Array(0);
  const ratio = fromRate / toRate;
  const outLen = Math.max(0, Math.floor(samples.length / ratio));
  const out = new Float32Array(outLen);
  for (let i = 0; i < outLen; i++) {
    const srcIdx = Math.min(samples.length - 1, Math.floor(i * ratio));
    out[i] = samples[srcIdx];
  }
  return out;
}

/** Average across channels to produce a mono buffer. */
export function toMono(channelData: Float32Array[]): Float32Array {
  if (channelData.length === 0) return new Float32Array(0);
  if (channelData.length === 1) return channelData[0];
  const len = channelData[0].length;
  const out = new Float32Array(len);
  const n = channelData.length;
  for (let i = 0; i < len; i++) {
    let acc = 0;
    for (let c = 0; c < n; c++) acc += channelData[c][i] ?? 0;
    out[i] = acc / n;
  }
  return out;
}

/**
 * Peak-normalise samples to [-1, 1]. A silent buffer is left untouched.
 */
export function normalise(samples: Float32Array): Float32Array {
  let peak = 0;
  for (let i = 0; i < samples.length; i++) {
    const v = Math.abs(samples[i]);
    if (v > peak) peak = v;
  }
  if (peak === 0) return samples;
  const out = new Float32Array(samples.length);
  for (let i = 0; i < samples.length; i++) out[i] = samples[i] / peak;
  return out;
}

/**
 * Centre-crop or zero-pad to `targetLen`. BirdNET wants exactly
 * 144,000 samples; longer clips get the middle 3 s, shorter ones get
 * symmetric zero-padding.
 */
export function windowSamples(samples: Float32Array, targetLen: number): Float32Array {
  if (samples.length === targetLen) return samples;
  const out = new Float32Array(targetLen);
  if (samples.length > targetLen) {
    const start = Math.floor((samples.length - targetLen) / 2);
    out.set(samples.subarray(start, start + targetLen));
    return out;
  }
  const offset = Math.floor((targetLen - samples.length) / 2);
  out.set(samples, offset);
  return out;
}

export interface TopKEntry {
  classIdx: number;
  score: number;
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
 * Full preprocessing pipeline: mono → resample → window → normalise.
 * Returns a Float32Array of exactly BIRDNET_WINDOW_SAMPLES values that
 * can be wrapped in an ONNX tensor of shape [1, 144000].
 */
export function buildInputTensor(channelData: Float32Array[], sampleRate: number): Float32Array {
  const mono = toMono(channelData);
  const resampled = resampleNearest(mono, sampleRate, BIRDNET_SAMPLE_RATE);
  const windowed = windowSamples(resampled, BIRDNET_WINDOW_SAMPLES);
  return normalise(windowed);
}
