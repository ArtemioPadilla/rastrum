/**
 * Tests for `src/lib/peer-norms.ts`.
 *
 * The SQL side (`license_norm`, `privacy_norm`, `peer_norm_pct`) is
 * exercised by the `db-validate.yml` workflow which applies the schema
 * twice; here we lock in the JS contract — caching, n-threshold gating,
 * and the rendered bar HTML — without a real Supabase round-trip.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

const rpcMock = vi.fn();

vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    rpc: rpcMock,
  }),
}));

import {
  MIN_N_THRESHOLD,
  fetchPeerNorm,
  renderPeerNormHtml,
  _resetPeerNormCacheForTests,
} from '../../src/lib/peer-norms';

const COPY = {
  withPct: (p: string) => `${p}% of MX observers choose this`,
  insufficient: 'not enough data',
};

beforeEach(() => {
  rpcMock.mockReset();
  _resetPeerNormCacheForTests();
});

afterEach(() => {
  rpcMock.mockReset();
});

describe('fetchPeerNorm', () => {
  it('returns pct + n + total for an above-threshold row', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ pct: 82, n: 820, total: 1000 }],
      error: null,
    });
    const r = await fetchPeerNorm('license', 'MX', 'CC BY 4.0');
    expect(r).toEqual({ pct: 82, n: 820, total: 1000 });
    expect(rpcMock).toHaveBeenCalledWith('peer_norm_pct', {
      p_scope: 'license',
      p_country: 'MX',
      p_key: 'CC BY 4.0',
    });
  });

  it(`hides pct (returns null) when total < ${MIN_N_THRESHOLD}`, async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ pct: 50, n: 1, total: 2 }],
      error: null,
    });
    const r = await fetchPeerNorm('license', 'MX', 'CC0');
    expect(r.pct).toBeNull();
    expect(r.n).toBe(1);
    expect(r.total).toBe(2);
  });

  it('caches per (scope, country, key) for the page lifetime', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ pct: 12, n: 120, total: 1000 }],
      error: null,
    });
    await fetchPeerNorm('privacy:profile', 'MX', 'public');
    await fetchPeerNorm('privacy:profile', 'MX', 'public');
    await fetchPeerNorm('privacy:profile', 'MX', 'public');
    expect(rpcMock).toHaveBeenCalledTimes(1);
  });

  it('returns a zeroed result on RPC error', async () => {
    rpcMock.mockResolvedValueOnce({
      data: null,
      error: { message: 'boom' },
    });
    const r = await fetchPeerNorm('license', null, 'CC BY 4.0');
    expect(r).toEqual({ pct: null, n: 0, total: 0 });
  });

  it('coerces stringy numerics returned by PostgREST', async () => {
    rpcMock.mockResolvedValueOnce({
      data: [{ pct: '37.5', n: '375', total: '1000' }],
      error: null,
    });
    const r = await fetchPeerNorm('privacy:bio', 'MX', 'signed_in');
    expect(r.pct).toBe(37.5);
    expect(r.n).toBe(375);
    expect(r.total).toBe(1000);
  });
});

describe('renderPeerNormHtml', () => {
  it('renders the insufficient-data fallback when pct is null', () => {
    const html = renderPeerNormHtml({ pct: null, n: 5, total: 5 }, COPY);
    expect(html).toContain('not enough data');
    expect(html).not.toContain('width:');
  });

  it('renders a bar with width = pct when above threshold', () => {
    const html = renderPeerNormHtml(
      { pct: 82, n: 820, total: 1000 },
      COPY,
    );
    expect(html).toContain('width: 82%');
    expect(html).toContain('82% of MX observers choose this');
  });

  it('clamps pct to [0,100] for the bar width', () => {
    const html = renderPeerNormHtml(
      { pct: 150, n: 1, total: 1 },
      COPY,
    );
    expect(html).toContain('width: 100%');
  });

  it('escapes HTML in the copy strings', () => {
    const html = renderPeerNormHtml(
      { pct: 50, n: 50, total: 100 },
      {
        withPct: (p) => `<script>alert(${p})</script>`,
        insufficient: 'n/a',
      },
    );
    expect(html).not.toContain('<script>alert');
    expect(html).toContain('&lt;script&gt;');
  });
});
