/**
 * Offline map (pmtiles) cache management — mirrors the BirdNET cache pattern
 * in `src/lib/identifiers/birdnet-cache.ts`. Stores a single Mexico-wide
 * pmtiles archive (zoom 0–10) in the Cache API so MapLibre can render
 * the basemap with no network round-trips.
 *
 * Files we cache (Cache API, key = absolute URL):
 *   - mexico-z0-10.pmtiles                       (~50–200 MB depending on style)
 *
 * The pmtiles URL comes from `import.meta.env.PUBLIC_PMTILES_MX_URL`. We
 * don't bundle the archive in the app build — it's fetched on user
 * request and stored in the browser's Cache storage. Subsequent map
 * loads can be served entirely from the cache, even when offline.
 *
 * TODO(deploy): Generate a Mexico-bounded pmtiles archive at zoom 0–10
 * from OpenStreetMap-derived data (e.g. via `protomaps` extracts
 * https://maps.protomaps.com/builds, or `tippecanoe` from a Mexico OSM
 * extract). Upload the resulting `mexico-z0-10.pmtiles` to Cloudflare R2
 * with public read access and CORS allowing the production origin
 * (https://rastrum.artemiop.com). Then set `PUBLIC_PMTILES_MX_URL` in
 * the deployment environment to the absolute URL of the archive
 * (including the filename). When unset, the offline-map UI surfaces
 * a clear "not configured" message instead of a broken download.
 *
 * Upstream tools: https://github.com/protomaps/PMTiles
 *                 https://github.com/protomaps/basemaps
 * Tile data: © OpenStreetMap contributors, ODbL.
 */

export const PMTILES_CACHE_NAME = 'rastrum/pmtiles';
export const PMTILES_MX_FILE    = 'mexico-z0-10.pmtiles';

export interface PmtilesCacheStatus {
  cached: boolean;
  approxBytes: number;
}

/**
 * Read the configured pmtiles URL. Returns null if the env var is unset
 * (which is the expected default until the archive is hosted).
 */
export function getPmtilesMxUrl(): string | null {
  const raw = import.meta.env.PUBLIC_PMTILES_MX_URL;
  if (!raw || typeof raw !== 'string') return null;
  return raw.trim() || null;
}

async function openCache(): Promise<Cache | null> {
  if (typeof caches === 'undefined') return null;
  return caches.open(PMTILES_CACHE_NAME).catch(() => null);
}

/**
 * Probe the Cache API to see if the configured pmtiles URL is present
 * and report an approximate byte count (Content-Length when available).
 */
export async function getPmtilesCacheStatus(): Promise<PmtilesCacheStatus> {
  const cache = await openCache();
  if (!cache) return { cached: false, approxBytes: 0 };
  const url = getPmtilesMxUrl();
  if (!url) {
    // Without a configured URL we can't infer cache hits. Treat the
    // cache as empty so the UI prompts the operator to configure first.
    return { cached: false, approxBytes: 0 };
  }
  const res = await cache.match(url).catch(() => undefined);
  if (!res) return { cached: false, approxBytes: 0 };
  const len = res.headers.get('content-length');
  const approxBytes = len ? parseInt(len, 10) : 0;
  return { cached: true, approxBytes };
}

export interface PmtilesDownloadProgress {
  bytesLoaded: number;
  bytesTotal: number;
  /** 0..1 when totals are known. */
  progress: number;
  text: string;
}

/**
 * Stream the pmtiles archive into the Cache, surfacing per-chunk progress.
 * Throws a clear error when `PUBLIC_PMTILES_MX_URL` is not set.
 */
export async function downloadPmtilesMx(
  onProgress: (p: PmtilesDownloadProgress) => void = () => {},
  signal?: AbortSignal,
): Promise<void> {
  const url = getPmtilesMxUrl();
  if (!url) {
    throw new Error(
      'Offline map URL is not configured. Set PUBLIC_PMTILES_MX_URL to the absolute URL of the Mexico pmtiles archive.',
    );
  }
  if (typeof caches === 'undefined') {
    throw new Error('Cache API is not available in this browser.');
  }
  const cache = await caches.open(PMTILES_CACHE_NAME);

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

  // Stitch streamed chunks into a Response we can store in the Cache.
  // Preserve the upstream content-length so getPmtilesCacheStatus can
  // surface a useful byte total.
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

/** Delete the cached pmtiles archive. Returns the number of entries removed. */
export async function clearPmtilesCache(): Promise<{ deleted: number }> {
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

/** Tile-source decision: which URL to feed MapLibre's pmtiles protocol. */
export type TileSourceMode = 'remote' | 'cached' | 'offline-no-cache' | 'unconfigured';

export interface TileSourceDecisionInput {
  /** True when the user has the pmtiles archive cached locally. */
  hasCache: boolean;
  /** True when the browser believes it is online. */
  online: boolean;
  /** True when `PUBLIC_PMTILES_MX_URL` is configured. */
  configured: boolean;
  /**
   * When true, prefer the cached archive even on a healthy network. Most
   * callers leave this true — local reads are always faster than R2.
   */
  preferCacheWhenOnline?: boolean;
}

/**
 * Pure helper: decide which tile source MapLibre should use given the
 * current cache + connectivity + configuration state. Kept side-effect
 * free so it's easy to test without a real Cache API.
 *
 * Decision matrix:
 *   ─────────────┬──────────┬────────────────────────────────────┐
 *   configured?  │ cache?   │ online?  │ result                  │
 *   ─────────────┼──────────┼──────────┼─────────────────────────┤
 *   no           │ —        │ —        │ unconfigured            │
 *   yes          │ yes      │ —        │ cached (offline-capable)│
 *   yes          │ no       │ yes      │ remote (existing path)  │
 *   yes          │ no       │ no       │ offline-no-cache        │
 *   ─────────────┴──────────┴──────────┴─────────────────────────┘
 *
 * `preferCacheWhenOnline` only matters when both cache and remote are
 * available; we always prefer the cache there for speed.
 */
export function decideTileSource(input: TileSourceDecisionInput): TileSourceMode {
  if (!input.configured) return 'unconfigured';
  if (input.hasCache) return 'cached';
  if (input.online) return 'remote';
  return 'offline-no-cache';
}

/**
 * Build a stable Cache API key for the configured Mexico pmtiles
 * archive. Exposed as a helper so the map view can register the same
 * URL with MapLibre's pmtiles protocol that we use as the cache key.
 *
 * Returns null when `PUBLIC_PMTILES_MX_URL` is unset.
 */
export function getPmtilesCacheKey(): string | null {
  return getPmtilesMxUrl();
}

/**
 * Build the `pmtiles://` URL MapLibre's pmtiles protocol expects. The
 * pmtiles JS lib resolves this back to a regular HTTP(S) fetch which —
 * when the Cache API has the archive — is satisfied entirely from
 * IndexedDB-backed storage by the service worker / runtime cache match.
 *
 * Returns null when `PUBLIC_PMTILES_MX_URL` is unset.
 */
export function getPmtilesProtocolUrl(): string | null {
  const url = getPmtilesMxUrl();
  return url ? `pmtiles://${url}` : null;
}
