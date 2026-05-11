/**
 * Unit tests for #713 — src/lib/query-cache.ts (SWR-style TTL cache).
 *
 * Tests cover:
 *  1. Returns value from fetcher on first call
 *  2. Returns cached value on second call (fetcher not called again)
 *  3. Stale-while-revalidate: returns stale value immediately, fires background refresh
 *  4. Purges entries beyond maxAgeMs and refetches
 *  5. De-duplicates concurrent callers (fetcher called exactly once)
 *  6. invalidate() forces next get() to refetch
 *  7. clear() removes all entries
 *  8. CACHE_TTL constants have expected values
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { QueryCache, CACHE_TTL } from '../../src/lib/query-cache';

function makeCache() {
  return new QueryCache();
}

describe('QueryCache', () => {
  beforeEach(() => {
    vi.useRealTimers();
  });

  it('calls fetcher and returns the value on first get()', async () => {
    const cache = makeCache();
    const fetcher = vi.fn().mockResolvedValue(42);
    const result = await cache.get('key1', fetcher, { staleMs: 5000 });
    expect(result).toBe(42);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns cached value without calling fetcher again when fresh', async () => {
    const cache = makeCache();
    const fetcher = vi.fn().mockResolvedValue('hello');
    await cache.get('key2', fetcher, { staleMs: 60_000 });
    const result = await cache.get('key2', fetcher, { staleMs: 60_000 });
    expect(result).toBe('hello');
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it('returns stale value immediately and triggers background refresh', async () => {
    vi.useFakeTimers();
    const cache = makeCache();
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation(() => {
      callCount += 1;
      return Promise.resolve(`v${callCount}`);
    });

    // First fetch — populates cache
    const first = await cache.get('key3', fetcher, { staleMs: 1000 });
    expect(first).toBe('v1');

    // Advance time beyond staleMs but within maxAgeMs
    vi.advanceTimersByTime(2000);

    // Second get — should return stale 'v1' immediately, fire background refresh
    const second = await cache.get('key3', fetcher, { staleMs: 1000 });
    expect(second).toBe('v1');

    // Allow microtasks to run for the background refresh
    await Promise.resolve();
    await Promise.resolve();

    // Fetcher should have been called a second time
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('purges entry beyond maxAgeMs and blocks on refetch', async () => {
    vi.useFakeTimers();
    const cache = makeCache();
    let callCount = 0;
    const fetcher = vi.fn().mockImplementation(() => Promise.resolve(++callCount));

    await cache.get('key4', fetcher, { staleMs: 1000, maxAgeMs: 3000 });
    vi.advanceTimersByTime(5000); // beyond maxAgeMs

    const result = await cache.get('key4', fetcher, { staleMs: 1000, maxAgeMs: 3000 });
    expect(result).toBe(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('de-duplicates concurrent callers — fetcher invoked exactly once', async () => {
    const cache = makeCache();
    let resolvePromise!: (v: string) => void;
    const slowFetcher = vi.fn().mockReturnValue(new Promise<string>(r => { resolvePromise = r; }));

    // Fire 5 concurrent gets before the fetcher resolves
    const promises = [1, 2, 3, 4, 5].map(() =>
      cache.get('key5', slowFetcher, { staleMs: 60_000 }),
    );
    resolvePromise('final');
    const results = await Promise.all(promises);
    expect(results.every(r => r === 'final')).toBe(true);
    expect(slowFetcher).toHaveBeenCalledOnce();
  });

  it('invalidate() forces next get() to call fetcher again', async () => {
    const cache = makeCache();
    const fetcher = vi.fn().mockResolvedValueOnce('a').mockResolvedValueOnce('b');
    await cache.get('key6', fetcher, { staleMs: 60_000 });
    cache.invalidate('key6');
    const result = await cache.get('key6', fetcher, { staleMs: 60_000 });
    expect(result).toBe('b');
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it('clear() removes all entries', async () => {
    const cache = makeCache();
    const fetcher = vi.fn().mockResolvedValue(1);
    await cache.get('a', fetcher, { staleMs: 60_000 });
    await cache.get('b', fetcher, { staleMs: 60_000 });
    expect(cache.size).toBe(2);
    cache.clear();
    expect(cache.size).toBe(0);
  });
});

describe('CACHE_TTL', () => {
  it('PROFILE_STATS is 5 minutes', () => {
    expect(CACHE_TTL.PROFILE_STATS).toBe(5 * 60 * 1000);
  });

  it('SPECIES_DATA is 1 hour', () => {
    expect(CACHE_TTL.SPECIES_DATA).toBe(60 * 60 * 1000);
  });

  it('LEADERBOARD is 10 minutes', () => {
    expect(CACHE_TTL.LEADERBOARD).toBe(10 * 60 * 1000);
  });
});
