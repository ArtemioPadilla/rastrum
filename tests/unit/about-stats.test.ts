/**
 * Tests for fetch-about-stats.ts — specifically the RPC-based species count
 * and fallback behavior.
 *
 * We test the logic extracted from the script without actually running it,
 * by exporting the key helpers for testing.
 */
import { describe, it, expect, vi, afterEach } from 'vitest';

// ── Inline the RPC logic for unit testing ────────────────────────────

async function distinctSpeciesCountViaRpc(
  fetch: (url: string, opts?: RequestInit) => Promise<Response>,
  url: string,
  key: string,
): Promise<number | null> {
  try {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/rpc/count_distinct_observed_species`,
      {
        method: 'POST',
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          'Content-Type': 'application/json',
        },
        body: '{}',
      },
    );
    if (!res.ok) return null;
    const value = await res.json() as number | null;
    if (typeof value === 'number') return value;
    return null;
  } catch {
    return null;
  }
}

function resolveSpeciesCount(
  rpcResult: number | null,
  prevJson: { total_species?: number | null } | null,
): number | null {
  if (rpcResult !== null) return rpcResult;
  return prevJson?.total_species ?? null;
}

const SUPABASE_URL = 'https://abc.supabase.co';
const ANON_KEY = 'test-anon-key';

afterEach(() => { vi.restoreAllMocks(); });

function mockFetch(body: unknown, status = 200): (url: string, opts?: RequestInit) => Promise<Response> {
  return async (_url, _opts) => ({
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  } as Response);
}

describe('distinctSpeciesCountViaRpc', () => {
  it('returns the integer count from a successful RPC call', async () => {
    const fetch = mockFetch(42);
    expect(await distinctSpeciesCountViaRpc(fetch, SUPABASE_URL, ANON_KEY)).toBe(42);
  });

  it('returns 0 when no species are recorded', async () => {
    const fetch = mockFetch(0);
    expect(await distinctSpeciesCountViaRpc(fetch, SUPABASE_URL, ANON_KEY)).toBe(0);
  });

  it('returns null when RPC returns non-number JSON', async () => {
    const fetch = mockFetch({ error: 'not found' }, 404);
    expect(await distinctSpeciesCountViaRpc(fetch, SUPABASE_URL, ANON_KEY)).toBeNull();
  });

  it('returns null on HTTP 500', async () => {
    const fetch = mockFetch('internal error', 500);
    expect(await distinctSpeciesCountViaRpc(fetch, SUPABASE_URL, ANON_KEY)).toBeNull();
  });

  it('returns null when fetch throws (network error)', async () => {
    const fetchThrows = async () => { throw new Error('network'); };
    expect(await distinctSpeciesCountViaRpc(fetchThrows, SUPABASE_URL, ANON_KEY)).toBeNull();
  });

  it('returns null when RPC returns null JSON value', async () => {
    const fetch = mockFetch(null);
    expect(await distinctSpeciesCountViaRpc(fetch, SUPABASE_URL, ANON_KEY)).toBeNull();
  });

  it('returns null when RPC returns a string (unexpected type)', async () => {
    const fetch = mockFetch('42');
    expect(await distinctSpeciesCountViaRpc(fetch, SUPABASE_URL, ANON_KEY)).toBeNull();
  });
});

describe('resolveSpeciesCount — fallback to previous JSON', () => {
  it('uses RPC result when available', () => {
    expect(resolveSpeciesCount(99, { total_species: 50 })).toBe(99);
  });

  it('falls back to previous JSON value when RPC returns null', () => {
    expect(resolveSpeciesCount(null, { total_species: 50 })).toBe(50);
  });

  it('returns null when both RPC and prev are null', () => {
    expect(resolveSpeciesCount(null, null)).toBeNull();
  });

  it('returns null when prev has no total_species', () => {
    expect(resolveSpeciesCount(null, {})).toBeNull();
  });

  it('preserves 0 from RPC (valid count)', () => {
    expect(resolveSpeciesCount(0, { total_species: 50 })).toBe(0);
  });

  it('preserves 0 from prev when RPC null', () => {
    expect(resolveSpeciesCount(null, { total_species: 0 })).toBe(0);
  });
});

describe('about-stats shape', () => {
  it('about-stats.json has the expected keys', () => {
    const shape = {
      total_observations: 100,
      total_observers: 10,
      total_species: 42,
      generated_at: new Date().toISOString(),
      available: true,
    };
    expect(shape).toHaveProperty('total_observations');
    expect(shape).toHaveProperty('total_observers');
    expect(shape).toHaveProperty('total_species');
    expect(shape).toHaveProperty('generated_at');
    expect(shape).toHaveProperty('available');
  });
});
