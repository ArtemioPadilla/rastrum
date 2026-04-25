/**
 * BirdNET-Lite weight cache management — mirrors the WebLLM cache pattern
 * in `src/lib/local-ai.ts` but for ONNX-form BirdNET-Lite v2.4.
 *
 * Files we cache (Cache API, key = absolute URL):
 *   - birdnet_v2.4.onnx                           (~50 MB; ONNX-converted weights)
 *   - BirdNET_GLOBAL_6K_V2.4_Labels.txt           (~150 KB; plain text, one row per class)
 *
 * The weights base URL comes from `import.meta.env.PUBLIC_BIRDNET_WEIGHTS_URL`.
 * We don't bundle the model in the app build — it's fetched on first use
 * and stored in the browser's Cache storage. Subsequent loads are
 * instant and offline.
 *
 * TODO(deploy): Convert the upstream BirdNET-Lite v2.4 TFLite weights to
 * ONNX (e.g. via tf2onnx or onnxmltools) and upload the resulting
 * `birdnet_v2.4.onnx` + the unmodified `BirdNET_GLOBAL_6K_V2.4_Labels.txt`
 * to Cloudflare R2 under a public read-only path. Then set
 * `PUBLIC_BIRDNET_WEIGHTS_URL` to the directory URL (no trailing slash).
 *
 * Upstream model: https://github.com/kahst/BirdNET-Lite
 * License: code MIT, model CC BY-NC-SA 4.0 (Cornell Lab).
 * Cite: Kahl, S., Wood, C. M., Eibl, M., & Klinck, H. (2021). BirdNET:
 * A deep learning solution for avian diversity monitoring. Ecological
 * Informatics, 61, 101236.
 */

export const BIRDNET_CACHE_NAME = 'rastrum/birdnet';
export const BIRDNET_MODEL_FILE  = 'birdnet_v2.4.onnx';
export const BIRDNET_LABELS_FILE = 'BirdNET_GLOBAL_6K_V2.4_Labels.txt';

export interface BirdNETCacheStatus {
  modelCached: boolean;
  labelsCached: boolean;
  approxBytes: number;
}

/**
 * Read the configured base URL. Returns null if the env var is unset
 * (which is the expected default until weights are hosted).
 */
export function getBirdNETWeightsBaseUrl(): string | null {
  const raw = import.meta.env.PUBLIC_BIRDNET_WEIGHTS_URL;
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/\/+$/, '');
}

function modelUrl(): string | null {
  const base = getBirdNETWeightsBaseUrl();
  return base ? `${base}/${BIRDNET_MODEL_FILE}` : null;
}

function labelsUrl(): string | null {
  const base = getBirdNETWeightsBaseUrl();
  return base ? `${base}/${BIRDNET_LABELS_FILE}` : null;
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  return caches.open(BIRDNET_CACHE_NAME).catch(() => null);
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
export async function getBirdNETCacheStatus(): Promise<BirdNETCacheStatus> {
  const cache = await openCache();
  if (!cache) {
    return { modelCached: false, labelsCached: false, approxBytes: 0 };
  }
  const keys = await cache.keys();
  let modelCached = false;
  let labelsCached = false;
  let approxBytes = 0;
  for (const req of keys) {
    if (req.url.endsWith(`/${BIRDNET_MODEL_FILE}`)) {
      modelCached = true;
    } else if (req.url.endsWith(`/${BIRDNET_LABELS_FILE}`)) {
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

export interface BirdNETDownloadProgress {
  file: 'model' | 'labels';
  bytesLoaded: number;
  bytesTotal: number;
  /** 0..1 across both files combined, when totals are known. */
  progress: number;
  text: string;
}

/**
 * Download model + labels into the BirdNET cache, streaming progress.
 * Throws a clear error when `PUBLIC_BIRDNET_WEIGHTS_URL` is not set.
 */
export async function downloadBirdNETWeights(
  onProgress: (p: BirdNETDownloadProgress) => void = () => {},
): Promise<void> {
  const base = getBirdNETWeightsBaseUrl();
  if (!base) {
    throw new Error(
      'BirdNET weights URL is not configured. Set PUBLIC_BIRDNET_WEIGHTS_URL to the base URL hosting birdnet_v2.4.onnx.',
    );
  }
  if (typeof caches === 'undefined') {
    throw new Error('Cache API is not available in this browser.');
  }
  const cache = await caches.open(BIRDNET_CACHE_NAME);

  const modelHref  = `${base}/${BIRDNET_MODEL_FILE}`;
  const labelsHref = `${base}/${BIRDNET_LABELS_FILE}`;

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
  onProgress: (p: BirdNETDownloadProgress) => void,
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
  // Stitch the streamed chunks into a Response we can store in the
  // Cache. We preserve the upstream content-length so getBirdNETCacheStatus
  // can report a useful byte total.
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
  const res = await matchByFile(cache, BIRDNET_MODEL_FILE);
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
  const res = await matchByFile(cache, BIRDNET_LABELS_FILE);
  if (!res) return null;
  const text = await res.text();
  return text.split(/\r?\n/).map(l => l.trim()).filter(l => l.length > 0);
}

/** Delete every entry in the BirdNET cache. */
export async function clearBirdNETCache(): Promise<{ deleted: number }> {
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
