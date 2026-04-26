/**
 * EfficientNet-Lite0 ONNX base classifier (client-side).
 *
 * Compact (~2.8 MB FP32) generic image classifier from the TensorFlow
 * Model Garden, exported to ONNX and run on-device via onnxruntime-web.
 * Trained on ImageNet ILSVRC 2012 (1,000 classes) — heavy on objects and
 * everyday scenes, but it's a useful zero-cost offline fallback while
 * we don't yet ship a species-aware model. Pipeline:
 *
 *   1. Decode the user's photo (Blob/URL) into an HTMLImageElement.
 *   2. Resize to 224×224 RGB on a Canvas2D (cover crop).
 *   3. Convert RGBA bytes → CHW Float32 tensor with ImageNet
 *      mean/std normalisation.
 *   4. Run the cached `efficientnet_lite0.onnx` session (top-K).
 *   5. Map class indices through `imagenet_labels.txt`.
 *
 * Weights aren't bundled — the user explicitly downloads them once via
 * Profile → Edit → AI settings → EfficientNet-Lite0. After that,
 * identification is fully offline.
 *
 * Limitations
 * -----------
 *   - ImageNet labels are English common names ("flamingo", "jaguar",
 *     "Granny Smith") — *not* scientific binomials. We surface the top
 *     label verbatim and tag every result as `kingdom: 'Animalia'` (the
 *     dominant ImageNet category) with a warning the user should treat
 *     this as a hint rather than a positive ID.
 *   - 1,000 classes is a tiny slice of biodiversity. Many tropical
 *     species are entirely absent. The cascade should still prefer
 *     PlantNet / Claude / a future regional ONNX over this one.
 *
 * License: code MIT (this file). Model: Apache-2.0
 * (https://github.com/tensorflow/models — TensorFlow Model Garden).
 */
import type { Identifier, IDResult, IdentifyInput } from './types';
import {
  ONNX_BASE_INPUT_SIZE, ONNX_BASE_TOP_K,
  preprocessRgba, parseLabel, softmax, topK,
} from './onnx-base-image';
import {
  getOnnxBaseCacheStatus, getCachedModelBuffer, getCachedLabels,
  getOnnxBaseWeightsBaseUrl,
} from './onnx-base-cache';

const PLUGIN_ID = 'onnx_efficientnet_lite0';

type OrtSession = {
  inputNames: string[];
  outputNames: string[];
  run(feeds: Record<string, unknown>): Promise<Record<string, { data: Float32Array | unknown }>>;
};
let session: OrtSession | null = null;
let labels: string[] | null = null;

async function ensureSession(): Promise<OrtSession> {
  if (session) return session;
  const buffer = await getCachedModelBuffer();
  if (!buffer) {
    throw new Error('EfficientNet-Lite0 model is not cached. Open Profile → Edit → AI settings to download it.');
  }
  const ort = await import('onnxruntime-web');
  const factory = (ort as unknown as { InferenceSession: { create(buf: ArrayBuffer, opts?: unknown): Promise<OrtSession> } }).InferenceSession;
  session = await factory.create(buffer, { executionProviders: ['wasm'] });
  return session;
}

async function ensureLabels(): Promise<string[]> {
  if (labels) return labels;
  const list = await getCachedLabels();
  if (!list) throw new Error('EfficientNet-Lite0 labels are not cached.');
  labels = list;
  return labels;
}

async function blobFromInput(input: IdentifyInput): Promise<Blob> {
  if (input.media.kind === 'url') {
    const res = await fetch(input.media.url);
    if (!res.ok) throw new Error(`Image fetch failed: HTTP ${res.status}`);
    return res.blob();
  }
  if (input.media.kind === 'blob') return input.media.blob;
  return new Blob([input.media.bytes as unknown as BlobPart], { type: input.media.mime });
}

async function decodeAndResize(blob: Blob): Promise<{ rgba: Uint8ClampedArray; width: number; height: number }> {
  if (typeof document === 'undefined') {
    throw new Error('Image decoding requires a DOM (Canvas2D).');
  }
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const el = new Image();
      el.onload = () => resolve(el);
      el.onerror = () => reject(new Error('Failed to decode image'));
      el.src = url;
    });
    const size = ONNX_BASE_INPUT_SIZE;
    const canvas = document.createElement('canvas');
    canvas.width = size;
    canvas.height = size;
    const ctx = canvas.getContext('2d', { willReadFrequently: true });
    if (!ctx) throw new Error('Canvas2D context unavailable.');

    // Cover crop: scale the shortest edge to 224 then centre-crop. This
    // matches the standard ImageNet eval recipe (resize-then-centre-crop).
    const srcW = img.naturalWidth || img.width;
    const srcH = img.naturalHeight || img.height;
    const scale = Math.max(size / srcW, size / srcH);
    const drawW = srcW * scale;
    const drawH = srcH * scale;
    const dx = (size - drawW) / 2;
    const dy = (size - drawH) / 2;
    ctx.drawImage(img, dx, dy, drawW, drawH);
    const data = ctx.getImageData(0, 0, size, size);
    return { rgba: data.data, width: size, height: size };
  } finally {
    URL.revokeObjectURL(url);
  }
}

export const onnxBaseIdentifier: Identifier = {
  id: PLUGIN_ID,
  name: 'EfficientNet-Lite0 (on-device)',
  brand: '🌎',
  description: 'Compact ImageNet classifier (~2.8 MB) running offline via onnxruntime-web. General-purpose — useful as an always-available fallback when nothing else is reachable.',
  setupSteps: [
    { text: 'Profile → Edit → AI settings → EfficientNet-Lite0 → Download (~2.8 MB).' },
    { text: 'After download, identification runs entirely on this device — photos never leave the browser.' },
    {
      text: 'Model: TensorFlow Model Garden (Apache-2.0).',
      link: 'https://github.com/tensorflow/models',
      details: 'Trained on ImageNet ILSVRC 2012 — 1,000 generic classes. Surface results as hints, not research-grade IDs.',
    },
  ],
  capabilities: {
    media: ['photo'],
    taxa: ['*'],
    runtime: 'client',
    license: 'free',
    cost_per_id_usd: 0,
  },
  async isAvailable() {
    if (!getOnnxBaseWeightsBaseUrl()) {
      return { ready: false, reason: 'model_not_bundled', message: 'PUBLIC_ONNX_BASE_URL is not set.' };
    }
    const status = await getOnnxBaseCacheStatus();
    if (!status.modelCached || !status.labelsCached) {
      return { ready: false, reason: 'needs_download', message: '~2.8 MB download (model + labels).' };
    }
    return { ready: true };
  },
  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.mediaKind !== 'photo') throw new Error(`${PLUGIN_ID}: requires mediaKind=photo`);
    const onProgress = input.onProgress ?? (() => {});

    onProgress({ progress: 0.05, text: 'Loading EfficientNet model…' });
    const [sess, lbls] = await Promise.all([ensureSession(), ensureLabels()]);

    onProgress({ progress: 0.3, text: 'Decoding image…' });
    const blob = await blobFromInput(input);
    const { rgba, width, height } = await decodeAndResize(blob);

    onProgress({ progress: 0.55, text: 'Preparing tensor…' });
    const tensorData = preprocessRgba(rgba, width, height);
    const ort = await import('onnxruntime-web');
    const TensorCtor = (ort as unknown as { Tensor: new (type: string, data: Float32Array, dims: number[]) => unknown }).Tensor;
    const inputTensor = new TensorCtor('float32', tensorData, [1, 3, ONNX_BASE_INPUT_SIZE, ONNX_BASE_INPUT_SIZE]);

    onProgress({ progress: 0.7, text: 'Running inference…' });
    const inputName = sess.inputNames[0] ?? 'input';
    const feeds: Record<string, unknown> = { [inputName]: inputTensor };
    const out = await sess.run(feeds);
    const outputName = sess.outputNames[0] ?? Object.keys(out)[0];
    const scoresRaw = out[outputName]?.data;
    if (!(scoresRaw instanceof Float32Array)) {
      throw new Error('EfficientNet output tensor missing or wrong type.');
    }

    onProgress({ progress: 0.95, text: 'Reading top predictions…' });
    const probs = softmax(scoresRaw);
    const top = topK(probs, ONNX_BASE_TOP_K);
    const best = top[0];
    if (!best) throw new Error('EfficientNet returned no predictions.');

    const parsed = parseLabel(lbls[best.classIdx] ?? '');
    const candidates = top.map(t => {
      const p = parseLabel(lbls[t.classIdx] ?? '');
      return { label: p.label, synset: p.synset, score: t.score };
    });

    onProgress({ progress: 1, text: 'Done' });

    return {
      // ImageNet labels are English common names — store the label as
      // the scientific name surrogate so downstream code has *something*
      // unique to write into identifications.scientific_name. The
      // warning makes the limitation explicit.
      scientific_name: parsed.label || `imagenet:${best.classIdx}`,
      common_name_en: parsed.label || null,
      common_name_es: null,
      family: null,
      kingdom: 'Animalia',
      confidence: best.score,
      source: PLUGIN_ID,
      raw: { top: candidates, synset: parsed.synset },
      warning: 'EfficientNet-Lite0 is a generic ImageNet classifier — labels are English common names, not scientific binomials. Treat as a hint, not a positive ID.',
    };
  },
};
