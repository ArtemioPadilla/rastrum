/**
 * Self-heal stale dynamic-import ("chunk") failures after a deploy.
 *
 * When the static site is redeployed, `_astro/*.[hash].js` filenames
 * change. A tab/SW that still runs an old parent chunk will `import()` a
 * child hash that no longer exists on the origin → the pipeline (and any
 * other dynamic-import site) dies with a `TypeError: Failed to fetch
 * dynamically imported module`. Reloading normally is not enough because
 * the service worker keeps serving the stale shell cache-first.
 *
 * `recoverFromChunkLoadError` detects that specific failure and forces a
 * single full reload (one-shot guarded via sessionStorage so we never
 * loop). The reload re-fetches the fresh document; the new SW (which
 * already `skipWaiting()`s + `clients.claim()`s) then serves the current
 * asset graph. For non-chunk errors it returns `false` so the caller's
 * normal degraded fallback still runs.
 */

const GUARD_KEY = 'rastrum.chunkReload';

const CHUNK_ERROR_PATTERNS = [
  'failed to fetch dynamically imported module',
  'error loading dynamically imported module',
  'importing a module script failed',
];

export function isChunkLoadError(err: unknown): boolean {
  if (!err || typeof err !== 'object') return false;
  const e = err as { name?: unknown; message?: unknown };
  if (e.name === 'ChunkLoadError') return true;
  const msg = typeof e.message === 'string' ? e.message.toLowerCase() : '';
  if (!msg) return false;
  return CHUNK_ERROR_PATTERNS.some((p) => msg.includes(p));
}

export interface ChunkReloadDeps {
  storage: Pick<Storage, 'getItem' | 'setItem'>;
  reload: () => void;
}

/**
 * Returns `true` if it handled the error by triggering a one-shot reload.
 * Returns `false` if the caller should fall back to its normal handling
 * (error is not a chunk-load failure, or we've already reloaded once this
 * session and must not loop).
 */
export function recoverFromChunkLoadError(err: unknown, deps: ChunkReloadDeps): boolean {
  if (!isChunkLoadError(err)) return false;
  if (deps.storage.getItem(GUARD_KEY)) return false;
  deps.storage.setItem(GUARD_KEY, String(Date.now()));
  deps.reload();
  return true;
}
