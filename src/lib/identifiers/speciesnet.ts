/**
 * Distilled SpeciesNet — on-device ONNX animal species classifier.
 *
 * Classifies camera-trap photos into ~20 Neotropical species (placeholder
 * label map; the real map ships with the trained model). Pipeline:
 *
 *   1. Optionally crop to a MegaDetector bbox via `mediaCrop`.
 *   2. Decode the photo into a 224×224 RGB canvas.
 *   3. Normalise to [0,1] then ImageNet mean/std (EfficientNet-style).
 *   4. Run the cached ONNX session (top-5).
 *   5. Map class indices through the bundled label map.
 *   6. Return the top prediction as an IDResult.
 *
 * Weights aren't bundled — the operator hosts the ONNX file at
 * `PUBLIC_SPECIESNET_WEIGHTS_URL` and the user downloads it once via
 * Profile → Edit → AI settings. Until the model is trained and hosted,
 * the plugin reports `model_not_bundled` and the cascade falls through.
 *
 * License: code MIT (this file). Model: TBD (depends on training data
 * and base architecture license).
 */
import type { Identifier, IDResult, IdentifyInput } from './types';
import {
  ONNX_BASE_INPUT_SIZE,
  IMAGENET_MEAN, IMAGENET_STD,
  preprocessRgba, softmax, topK,
} from './onnx-base-image';
import {
  getSpeciesNetWeightsUrl, getSpeciesNetCacheStatus, getCachedSpeciesNetBuffer,
} from './speciesnet-cache';
import { SPECIESNET_LABELS, lookupSpeciesNetLabel } from './speciesnet-labels';
import { clampAndPad } from './bbox-crop';

export const SPECIESNET_PLUGIN_ID = 'speciesnet_distilled';

/** Minimum device memory (GB) to attempt loading the ~100 MB model. */
const MIN_DEVICE_MEMORY_GB = 4;

/** Top-K predictions to surface per identification. */
const SPECIESNET_TOP_K = 5;

type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | unknown }>>;
};
let session: OrtSession | null = null;

async function ensureSession(): Promise<OrtSession> {
  if (session) return session;
  const buffer = await getCachedSpeciesNetBuffer();
  if (!buffer) {
    throw new Error(
      'SpeciesNet model is not cached. Open Profile → Edit → AI settings (or replay the onboarding tour) to download it.',
    );
  }
  const ort = await import('onnxruntime-web');
  const factory = (ort as unknown as {
    InferenceSession: { create(buf: ArrayBuffer, opts?: unknown): Promise<OrtSession> };
  }).InferenceSession;
  session = await factory.create(buffer, { executionProviders: ['wasm'] });
  return session;
}

/**
 * Decode the input media into RGBA pixel data. When `mediaCrop` is
 * provided, crop to the bbox first (with 10% padding) so the classifier
 * sees only the animal, not the full frame.
 */
async function decodeImageToRgba(
  input: IdentifyInput,
): Promise<{ data: Uint8ClampedArray; width: number; height: number }> {
  let blob: Blob;
  if (input.media.kind === 'url') {
    const res = await fetch(input.media.url, { mode: 'cors' });
    if (!res.ok) throw new Error(`SpeciesNet: photo fetch failed (HTTP ${res.status})`);
    blob = await res.blob();
  } else if (input.media.kind === 'blob') {
    blob = input.media.blob;
  } else {
    blob = new Blob([new Uint8Array(input.media.bytes)], { type: input.media.mime });
  }

  const bitmap = await createImageBitmap(blob);
  const srcW = bitmap.width;
  const srcH = bitmap.height;

  // Draw full image to a canvas so we can read pixels / crop.
  const fullCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(srcW, srcH)
    : (() => {
        const c = document.createElement('canvas');
        c.width = srcW; c.height = srcH;
        return c as unknown as OffscreenCanvas;
      })();
  const fullCtx = fullCanvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!fullCtx) throw new Error('SpeciesNet: 2D canvas unavailable');
  fullCtx.drawImage(bitmap as unknown as CanvasImageSource, 0, 0);
  bitmap.close?.();

  // If a crop hint is available, extract just the animal region.
  if (input.mediaCrop) {
    const rect = clampAndPad(input.mediaCrop.bbox, srcW, srcH, 0.1);
    const cropData = fullCtx.getImageData(rect.x, rect.y, rect.w, rect.h);
    return { data: cropData.data, width: rect.w, height: rect.h };
  }

  const imgData = fullCtx.getImageData(0, 0, srcW, srcH);
  return { data: imgData.data, width: srcW, height: srcH };
}

/**
 * Resize RGBA pixel data to the target square size using a canvas.
 * Uses cover-crop (scale shortest edge, centre-crop) to match the
 * standard ImageNet eval recipe.
 */
async function resizeToSquare(
  rgba: Uint8ClampedArray,
  srcW: number,
  srcH: number,
  size: number,
): Promise<Uint8ClampedArray> {
  // Build an ImageData from the raw RGBA, then draw it scaled.
  const srcCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(srcW, srcH)
    : (() => {
        const c = document.createElement('canvas');
        c.width = srcW; c.height = srcH;
        return c as unknown as OffscreenCanvas;
      })();
  const srcCtx = srcCanvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!srcCtx) throw new Error('SpeciesNet: 2D canvas unavailable');
  const imgData = new ImageData(new Uint8ClampedArray(rgba), srcW, srcH);
  srcCtx.putImageData(imgData, 0, 0);

  const dstCanvas = typeof OffscreenCanvas !== 'undefined'
    ? new OffscreenCanvas(size, size)
    : (() => {
        const c = document.createElement('canvas');
        c.width = size; c.height = size;
        return c as unknown as OffscreenCanvas;
      })();
  const dstCtx = dstCanvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D | null;
  if (!dstCtx) throw new Error('SpeciesNet: 2D canvas unavailable');

  // Cover crop: scale shortest edge to `size`, centre-crop the rest.
  const scale = Math.max(size / srcW, size / srcH);
  const drawW = srcW * scale;
  const drawH = srcH * scale;
  const dx = (size - drawW) / 2;
  const dy = (size - drawH) / 2;
  dstCtx.drawImage(srcCanvas as unknown as CanvasImageSource, dx, dy, drawW, drawH);

  return dstCtx.getImageData(0, 0, size, size).data;
}

export const speciesnetIdentifier: Identifier = {
  id: SPECIESNET_PLUGIN_ID,
  name: 'SpeciesNet (distilled)',
  brand: '🐾',
  description:
    'On-device animal species classifier (~100 MB ONNX, iWildCam categories). Identifies common camera-trap species without cloud LLMs.',
  setupSteps: [
    {
      text: 'Profile → Edit → AI settings → SpeciesNet → Download (~100 MB).',
    },
    {
      text: 'After download, species classification runs offline. Photos never leave your device.',
    },
    {
      text: 'Operator: train a distilled SpeciesNet, export to ONNX, and host as speciesnet_distilled_v1.onnx behind PUBLIC_SPECIESNET_WEIGHTS_URL (CORS-open).',
      details: 'The placeholder label map ships 20 Neotropical species. The real label map is generated by the training pipeline.',
    },
  ],
  capabilities: {
    media: ['photo'],
    taxa: ['Animalia'],
    runtime: 'client',
    license: 'free',
    confidence_ceiling: 0.85,
    cost_per_id_usd: 0,
  },

  async isAvailable() {
    if (!getSpeciesNetWeightsUrl()) {
      return {
        ready: false,
        reason: 'model_not_bundled',
        message: 'PUBLIC_SPECIESNET_WEIGHTS_URL is not set.',
      };
    }
    // Check device memory when the API is available.
    if (typeof navigator !== 'undefined' && 'deviceMemory' in navigator) {
      const mem = (navigator as unknown as { deviceMemory: number }).deviceMemory;
      if (mem < MIN_DEVICE_MEMORY_GB) {
        return {
          ready: false,
          reason: 'insufficient_memory',
          message: `Device reports ${mem} GB RAM; SpeciesNet needs ≥${MIN_DEVICE_MEMORY_GB} GB.`,
        };
      }
    }
    const status = await getSpeciesNetCacheStatus();
    if (!status.modelCached) {
      return { ready: false, reason: 'needs_download', message: '~100 MB download (model only).' };
    }
    return { ready: true };
  },

  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.mediaKind !== 'photo') {
      throw new Error('speciesnet_distilled: requires mediaKind=photo');
    }
    const onProgress = input.onProgress ?? (() => {});

    onProgress({ progress: 0.05, text: 'Loading SpeciesNet…' });
    const sess = await ensureSession();

    onProgress({ progress: 0.25, text: 'Decoding photo…' });
    const rgba = await decodeImageToRgba(input);

    onProgress({ progress: 0.4, text: 'Resizing to 224×224…' });
    const resized = await resizeToSquare(rgba.data, rgba.width, rgba.height, ONNX_BASE_INPUT_SIZE);

    onProgress({ progress: 0.55, text: 'Preparing tensor…' });
    const tensorData = preprocessRgba(resized, ONNX_BASE_INPUT_SIZE, ONNX_BASE_INPUT_SIZE);
    const ort = await import('onnxruntime-web');
    const TensorCtor = (ort as unknown as {
      Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown;
    }).Tensor;
    const inputTensor = new TensorCtor(
      'float32', tensorData,
      [1, 3, ONNX_BASE_INPUT_SIZE, ONNX_BASE_INPUT_SIZE],
    );

    onProgress({ progress: 0.7, text: 'Running classifier…' });
    const inputName = sess.inputNames[0] ?? 'input';
    const feeds: Record<string, unknown> = { [inputName]: inputTensor };
    const out = await sess.run(feeds);
    const outputName = sess.outputNames[0] ?? Object.keys(out)[0];
    const scoresRaw = out[outputName]?.data;
    if (!(scoresRaw instanceof Float32Array)) {
      throw new Error('SpeciesNet output tensor missing or wrong type.');
    }

    onProgress({ progress: 0.9, text: 'Reading top predictions…' });
    const probs = softmax(scoresRaw);
    const top = topK(probs, SPECIESNET_TOP_K);
    const best = top[0];
    if (!best) throw new Error('SpeciesNet returned no predictions.');

    const label = lookupSpeciesNetLabel(best.classIdx);
    const candidates = top.map(t => {
      const l = lookupSpeciesNetLabel(t.classIdx);
      return {
        classIdx: t.classIdx,
        score: t.score,
        scientific_name: l?.scientific_name ?? `unknown:${t.classIdx}`,
        common_name_en: l?.common_name_en ?? null,
        common_name_es: l?.common_name_es ?? null,
      };
    });

    onProgress({ progress: 1, text: 'Done.' });

    return {
      scientific_name: label?.scientific_name ?? `unknown:${best.classIdx}`,
      common_name_en: label?.common_name_en ?? null,
      common_name_es: label?.common_name_es ?? null,
      family: label?.family ?? null,
      kingdom: 'Animalia',
      confidence: Math.min(best.score, 0.85),
      source: SPECIESNET_PLUGIN_ID,
      raw: { top: candidates, labelCount: SPECIESNET_LABELS.length },
    };
  },
};
