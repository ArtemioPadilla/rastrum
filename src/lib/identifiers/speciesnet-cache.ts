/**
 * SpeciesNet distilled model weight cache — mirrors `megadetector-cache.ts`.
 *
 * Files we cache (Cache API, key = absolute URL):
 *   - speciesnet_distilled_v1.onnx  (~100 MB; distilled EfficientNet ONNX)
 *
 * The weights URL comes from `import.meta.env.PUBLIC_SPECIESNET_WEIGHTS_URL`.
 * Until the operator trains, converts, and hosts the file the plugin
 * reports `model_not_bundled` and the cascade transparently falls through.
 *
 * Operator action: train a distilled SpeciesNet on iWildCam categories,
 * export to ONNX, INT8-quantise, and upload to a CORS-open public URL
 * (e.g. Cloudflare R2 under media.rastrum.org/models/). Set
 * `PUBLIC_SPECIESNET_WEIGHTS_URL` to the full URL of the ONNX file.
 *
 * License: code MIT (this file). Model: TBD (depends on training data).
 */

export const SPECIESNET_CACHE_NAME = 'rastrum/speciesnet';
export const SPECIESNET_MODEL_FILE = 'speciesnet_distilled_v1.onnx';

export interface SpeciesNetCacheStatus {
  modelCached: boolean;
  approxBytes: number;
}

export function getSpeciesNetWeightsUrl(): string | null {
  const raw = import.meta.env.PUBLIC_SPECIESNET_WEIGHTS_URL;
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/\/+$/, '') || null;
}

function modelUrl(): string | null {
  const base = getSpeciesNetWeightsUrl();
  return base ? `${base}/${SPECIESNET_MODEL_FILE}` : null;
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  return caches.open(SPECIESNET_CACHE_NAME).catch(() => null);
}

async function matchByFile(cache: Cache, file: string): Promise<Response | undefined> {
  const keys = await cache.keys();
  for (const req of keys) {
    if (req.url.endsWith(`/${file}`)) return cache.match(req);
  }
  return undefined;
}

export async function getSpeciesNetCacheStatus(): Promise<SpeciesNetCacheStatus> {
  const cache = await openCache();
  if (!cache) return { modelCached: false, approxBytes: 0 };
  const res = await matchByFile(cache, SPECIESNET_MODEL_FILE);
  if (!res) return { modelCached: false, approxBytes: 0 };
  const len = res.headers.get('content-length');
  return { modelCached: true, approxBytes: len ? parseInt(len, 10) : 0 };
}

export interface SpeciesNetDownloadProgress {
  bytesLoaded: number;
  bytesTotal: number;
  /** 0..1 when totals are known. */
  progress: number;
  text: string;
}

export async function downloadSpeciesNetWeights(
  onProgress: (p: SpeciesNetDownloadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  const url = modelUrl();
  if (!url) {
    throw new Error(
      'SpeciesNet weights URL is not configured. Set PUBLIC_SPECIESNET_WEIGHTS_URL to the base URL hosting speciesnet_distilled_v1.onnx.',
    );
  }
  if (typeof caches === 'undefined') {
    throw new Error('Cache API is not available in this browser.');
  }
  const cache = await caches.open(SPECIESNET_CACHE_NAME);

  const res = await fetch(url, { mode: 'cors', signal });
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
        bytesLoaded,
        bytesTotal,
        progress: ratio,
        text: bytesTotal > 0 ? `${Math.round(ratio * 100)}%` : `${bytesLoaded}`,
      });
    }
  }
  const total = chunks.reduce((n, c) => n + c.length, 0);
  const body = new Uint8Array(total);
  let off = 0;
  for (const c of chunks) { body.set(c, off); off += c.length; }
  const headers = new Headers(res.headers);
  if (!headers.has('content-length')) headers.set('content-length', String(total));
  await cache.put(url, new Response(body, {
    status: res.status,
    statusText: res.statusText,
    headers,
  }));
}

export async function getCachedSpeciesNetBuffer(): Promise<ArrayBuffer | null> {
  const cache = await openCache();
  if (!cache) return null;
  const res = await matchByFile(cache, SPECIESNET_MODEL_FILE);
  if (!res) return null;
  return res.arrayBuffer();
}

export async function clearSpeciesNetCache(): Promise<{ deleted: number }> {
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
