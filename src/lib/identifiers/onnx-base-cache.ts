/**
 * EfficientNet-Lite0 weight cache management — mirrors `birdnet-cache.ts`
 * but for the much smaller (~2.8 MB) generic ImageNet classifier we use
 * as the always-available offline vision fallback.
 *
 * Files we cache (Cache API, key = absolute URL):
 *   - efficientnet_lite0.onnx     (~2.8 MB FP32; model card lists ~5 MB
 *                                  TFLite, ONNX export trims unused ops)
 *   - imagenet_labels.txt         (~22 KB; 1,000 ImageNet ILSVRC classes)
 *
 * The weights base URL comes from `import.meta.env.PUBLIC_ONNX_BASE_URL`.
 * The model is small enough that we *could* base64-bundle it directly
 * into the build, but the R2 download path keeps parity with BirdNET and
 * lets us swap models without a redeploy.
 *
 * TODO(deploy): Convert TensorFlow Model Garden's
 * `efficientnet-lite0` checkpoint to ONNX (e.g. via tf2onnx with
 * `--opset 13`) and upload the resulting `efficientnet_lite0.onnx`
 * alongside the standard ImageNet ILSVRC 2012 1000-class label file as
 * `imagenet_labels.txt` (one row per class, `nXXXXXXXX label[, alt]…`)
 * to Cloudflare R2 under a public read-only path. Then set
 * `PUBLIC_ONNX_BASE_URL` to the directory URL (no trailing slash).
 *
 * Upstream model: https://github.com/tensorflow/models/tree/master/official/legacy/image_classification
 * License: Apache-2.0 (TensorFlow Model Garden).
 *
 * Limitation: the model was trained on ImageNet, which is heavy on
 * everyday objects and uses English common names rather than scientific
 * binomials. We map every prediction to `Life.Animalia` ('*' in the
 * cascade) and surface top-K indiscriminately — the user is expected to
 * treat this as a low-confidence offline hint, never as research-grade.
 */

export const ONNX_BASE_CACHE_NAME = 'rastrum/onnx-base';
export const ONNX_BASE_MODEL_FILE  = 'efficientnet_lite0.onnx';
export const ONNX_BASE_LABELS_FILE = 'imagenet_labels.txt';

export interface OnnxBaseCacheStatus {
  modelCached: boolean;
  labelsCached: boolean;
  approxBytes: number;
}

/**
 * Read the configured base URL. Returns null if the env var is unset
 * (which is the expected default until weights are hosted).
 */
export function getOnnxBaseWeightsBaseUrl(): string | null {
  const raw = import.meta.env.PUBLIC_ONNX_BASE_URL;
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/\/+$/, '');
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  return caches.open(ONNX_BASE_CACHE_NAME).catch(() => null);
}

async function matchByFile(cache: Cache, file: string): Promise<Response | undefined> {
  const keys = await cache.keys();
  for (const req of keys) {
    if (req.url.endsWith(`/${file}`)) {
      return cache.match(req);
    }
  }
  return undefined;
}

/**
 * Probe the Cache API to see if the model + labels are present and
 * report an approximate byte count (sum of Content-Length headers when
 * available).
 */
export async function getOnnxBaseCacheStatus(): Promise<OnnxBaseCacheStatus> {
  const cache = await openCache();
  if (!cache) {
    return { modelCached: false, labelsCached: false, approxBytes: 0 };
  }
  const keys = await cache.keys();
  let modelCached = false;
  let labelsCached = false;
  let approxBytes = 0;
  for (const req of keys) {
    if (req.url.endsWith(`/${ONNX_BASE_MODEL_FILE}`)) {
      modelCached = true;
    } else if (req.url.endsWith(`/${ONNX_BASE_LABELS_FILE}`)) {
      labelsCached = true;
    } else {
      continue;
    }
    try {
      const res = await cache.match(req);
      const len = res?.headers.get('content-length');
      if (len) approxBytes += parseInt(len, 10);
    } catch { /* ignore */ }
  }
  return { modelCached, labelsCached, approxBytes };
}

export interface OnnxBaseDownloadProgress {
  file: 'model' | 'labels';
  bytesLoaded: number;
  bytesTotal: number;
  /** 0..1 across both files combined, when totals are known. */
  progress: number;
  text: string;
}

/**
 * Download model + labels into the EfficientNet cache, streaming
 * progress. Throws a clear error when `PUBLIC_ONNX_BASE_URL` is not set.
 */
export async function downloadOnnxBaseWeights(
  onProgress: (p: OnnxBaseDownloadProgress) => void = () => {},
): Promise<void> {
  const base = getOnnxBaseWeightsBaseUrl();
  if (!base) {
    throw new Error(
      'EfficientNet-Lite0 weights URL is not configured. Set PUBLIC_ONNX_BASE_URL to the base URL hosting efficientnet_lite0.onnx.',
    );
  }
  if (typeof caches === 'undefined') {
    throw new Error('Cache API is not available in this browser.');
  }
  const cache = await caches.open(ONNX_BASE_CACHE_NAME);

  const modelHref  = `${base}/${ONNX_BASE_MODEL_FILE}`;
  const labelsHref = `${base}/${ONNX_BASE_LABELS_FILE}`;

  // Labels first — they're tiny and a quick connectivity check.
  await streamInto(cache, labelsHref, 'labels', 0, 1, onProgress);
  await streamInto(cache, modelHref,  'model',  0, 1, onProgress);
}

async function streamInto(
  cache: Cache,
  url: string,
  file: 'model' | 'labels',
  baseProgress: number,
  span: number,
  onProgress: (p: OnnxBaseDownloadProgress) => void,
): Promise<void> {
  const res = await fetch(url, { mode: 'cors' });
  if (!res.ok || !res.body) {
    throw new Error(`Failed to fetch ${url}: HTTP ${res.status}`);
  }
  const lenHeader = res.headers.get('content-length');
  const bytesTotal = lenHeader ? parseInt(lenHeader, 10) : 0;
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let bytesLoaded = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done) break;
    if (value) {
      chunks.push(value);
      bytesLoaded += value.length;
      const ratio = bytesTotal > 0 ? bytesLoaded / bytesTotal : 0;
      onProgress({
        file,
        bytesLoaded,
        bytesTotal,
        progress: baseProgress + ratio * span,
        text: `${file} ${Math.round(ratio * 100)}%`,
      });
    }
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { body.set(c, off); off += c.length; }
  const headers = new Headers(res.headers);
  if (!headers.has('content-length')) headers.set('content-length', String(total));
  const stored = new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  });
  await cache.put(url, stored);
}

/** Returns the cached ONNX bytes, or null if the model isn't downloaded. */
export async function getCachedModelBuffer(): Promise<ArrayBuffer | null> {
  const cache = await openCache();
  if (!cache) return null;
  const res = await matchByFile(cache, ONNX_BASE_MODEL_FILE);
  if (!res) return null;
  return res.arrayBuffer();
}

/**
 * Returns the cached label rows as a string array (one entry per class),
 * or null if the labels aren't downloaded yet. Empty lines are dropped.
 */
export async function getCachedLabels(): Promise<string[] | null> {
  const cache = await openCache();
  if (!cache) return null;
  const res = await matchByFile(cache, ONNX_BASE_LABELS_FILE);
  if (!res) return null;
  const text = await res.text();
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

/** Delete every entry in the EfficientNet cache. */
export async function clearOnnxBaseCache(): Promise<{ deleted: number }> {
  const cache = await openCache();
  if (!cache) return { deleted: 0 };
  const keys = await cache.keys();
  let deleted = 0;
  for (const req of keys) {
    const ok = await cache.delete(req);
    if (ok) deleted++;
  }
  return { deleted };
}
