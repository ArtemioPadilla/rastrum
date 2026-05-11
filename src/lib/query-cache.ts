/**
 * src/lib/query-cache.ts — #713 Perf: SWR-style in-memory TTL cache.
 *
 * A lightweight, dependency-free in-memory cache for expensive Supabase
 * queries. Each entry stores the resolved value plus a `fetchedAt` timestamp.
 * Callers supply a `staleMs` threshold; stale entries trigger a background
 * refresh while still returning the cached value immediately (SWR pattern).
 *
 * Pre-configured TTLs (from issue #713):
 *   - Profile stats:     5 min
 *   - Species data:      1 h
 *   - Leaderboard:       10 min
 *
 * This module is intentionally framework-agnostic (no React / Vue / Astro
 * imports) so it can be used in Edge Functions and server-side scripts too.
 */

export interface CacheEntry<T> {
  value: T;
  fetchedAt: number;
}

export interface CacheOptions {
  /** How long (ms) before the entry is considered stale. Stale data is still returned while a background refresh fires. */
  staleMs: number;
  /** If set, entries older than this are purged immediately and will block until refetched. Default: 4 × staleMs. */
  maxAgeMs?: number;
}

/** Named TTL constants exported for easy reuse. */
export const CACHE_TTL = {
  PROFILE_STATS:  5  * 60 * 1000,  //  5 min
  SPECIES_DATA:   60 * 60 * 1000,  //  1 h
  LEADERBOARD:    10 * 60 * 1000,  // 10 min
} as const;

type Fetcher<T> = () => Promise<T>;

interface InFlight<T> {
  promise: Promise<T>;
}

export class QueryCache {
  private store = new Map<string, CacheEntry<unknown>>();
  private inFlight = new Map<string, InFlight<unknown>>();

  /**
   * Retrieve a value, using the cache when fresh or stale-while-revalidate
   * when stale. Blocks only if no cached value exists at all.
   */
  async get<T>(
    key: string,
    fetcher: Fetcher<T>,
    opts: CacheOptions,
  ): Promise<T> {
    const { staleMs, maxAgeMs = staleMs * 4 } = opts;
    const now = Date.now();
    const entry = this.store.get(key) as CacheEntry<T> | undefined;

    if (entry) {
      const age = now - entry.fetchedAt;
      if (age < maxAgeMs) {
        // Return the cached value. If stale, kick off a background refresh.
        if (age >= staleMs) {
          this._refresh(key, fetcher).catch(() => {/* swallow; next get() will retry */});
        }
        return entry.value;
      }
      // Beyond maxAge — purge and fall through to a fresh fetch.
      this.store.delete(key);
    }

    // No cached value — fetch now (deduplicated).
    return this._refresh(key, fetcher);
  }

  /**
   * Explicitly invalidate a cache key, forcing the next `get()` to refetch.
   */
  invalidate(key: string): void {
    this.store.delete(key);
  }

  /** Evict all cache entries. */
  clear(): void {
    this.store.clear();
    this.inFlight.clear();
  }

  /** Number of cached entries (for testing/monitoring). */
  get size(): number {
    return this.store.size;
  }

  private async _refresh<T>(key: string, fetcher: Fetcher<T>): Promise<T> {
    // Deduplicate concurrent callers
    const existing = this.inFlight.get(key) as InFlight<T> | undefined;
    if (existing) return existing.promise;

    const promise = fetcher().then((value) => {
      this.store.set(key, { value, fetchedAt: Date.now() });
      this.inFlight.delete(key);
      return value;
    }).catch((err) => {
      this.inFlight.delete(key);
      throw err;
    });

    this.inFlight.set(key, { promise } as InFlight<unknown>);
    return promise;
  }
}

/** Module-level singleton — use this for all app queries. */
export const queryCache = new QueryCache();
