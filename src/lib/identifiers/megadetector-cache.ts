/**
 * MegaDetector v5a weight cache — mirrors `birdnet-cache.ts`.
 *
 * Files we cache (Cache API, key = absolute URL):
 *   - megadetector_v5a.onnx        (~85 MB; YOLOv5 ONNX export)
 *
 * The weights base URL comes from `import.meta.env.PUBLIC_MEGADETECTOR_WEIGHTS_URL`.
 * Until the operator hosts the file the plugin reports `model_not_bundled`
 * and the cascade transparently falls through.
 *
 * Operator action: run the recipe at `infra/megadetector/convert.sh` —
 * it clones ultralytics/yolov5, runs `export.py --weights md_v5a.0.0.pt
 * --include onnx --imgsz 640 --opset 12 --simplify`, and INT8-quantises
 * the result via onnxruntime so the client downloads ~85 MB instead of
 * ~140 MB. Upload the resulting `megadetector_v5a.onnx` to a CORS-open
 * public URL (e.g. Cloudflare R2 under media.rastrum.org/models/) and
 * set `PUBLIC_MEGADETECTOR_WEIGHTS_URL` to the directory URL (no
 * trailing slash). See infra/megadetector/README.md for full notes.
 *
 * NOTE: do not try `python detection/run_detector_batch.py --export-onnx`
 * — that's the inference batch runner and has no export flag. The
 * megadetector PyPI package ships inference utilities, not export.
 *
 * License: code MIT (this file). Model: MIT (Microsoft AI for Earth) —
 * safe for commercial use.
 *
 * Refs:
 *   - https://github.com/agentmorris/MegaDetector
 *   - docs/specs/modules/09-camera-trap.md
 */

export const MEGADETECTOR_CACHE_NAME = 'rastrum/megadetector';
export const MEGADETECTOR_MODEL_FILE = 'megadetector_v5a.onnx';

export interface MegadetectorCacheStatus {
  modelCached: boolean;
  approxBytes: number;
}

export function getMegadetectorWeightsBaseUrl(): string | null {
  const raw = import.meta.env.PUBLIC_MEGADETECTOR_WEIGHTS_URL;
  if (!raw || typeof raw !== 'string') return null;
  return raw.replace(/\/+$/, '') || null;
}

function modelUrl(): string | null {
  const base = getMegadetectorWeightsBaseUrl();
  return base ? `${base}/${MEGADETECTOR_MODEL_FILE}` : null;
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  return caches.open(MEGADETECTOR_CACHE_NAME).catch(() => null);
}

async function matchByFile(cache: Cache, file: string): Promise<Response | undefined> {
  const keys = await cache.keys();
  for (const req of keys) {
    if (req.url.endsWith(`/${file}`)) return cache.match(req);
  }
  return undefined;
}

export async function getMegadetectorCacheStatus(): Promise<MegadetectorCacheStatus> {
  const cache = await openCache();
  if (!cache) return { modelCached: false, approxBytes: 0 };
  const res = await matchByFile(cache, MEGADETECTOR_MODEL_FILE);
  if (!res) return { modelCached: false, approxBytes: 0 };
  const len = res.headers.get('content-length');
  return { modelCached: true, approxBytes: len ? parseInt(len, 10) : 0 };
}

export interface MegadetectorDownloadProgress {
  bytesLoaded: number;
  bytesTotal: number;
  /** 0..1 when totals are known. */
  progress: number;
  text: string;
}

export async function downloadMegadetectorWeights(
  onProgress: (p: MegadetectorDownloadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  const url = modelUrl();
  if (!url) {
    throw new Error(
      'MegaDetector weights URL is not configured. Set PUBLIC_MEGADETECTOR_WEIGHTS_URL to the base URL hosting megadetector_v5a.onnx.',
    );
  }
  if (typeof caches === 'undefined') {
    throw new Error('Cache API is not available in this browser.');
  }
  const cache = await caches.open(MEGADETECTOR_CACHE_NAME);

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

export async function getCachedModelBuffer(): Promise<ArrayBuffer | null> {
  const cache = await openCache();
  if (!cache) return null;
  const res = await matchByFile(cache, MEGADETECTOR_MODEL_FILE);
  if (!res) return null;
  return res.arrayBuffer();
}

export async function clearMegadetectorCache(): Promise<{ deleted: number }> {
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
