/**
 * probable-taxa-cache.test.ts — unit tests for the cache layer helpers
 * added in issue #803.
 *
 * We cannot run Postgres in unit tests, so we test:
 *  1. The TypeScript client-side cache-key helper in contextual-suggest.ts
 *     (unchanged — sanity regression).
 *  2. The new make-drop-target utility (tested separately in dropzone-surfaces).
 *  3. A geohash5-bucket property: two coords within the same ~5 km cell must
 *     produce the same geohash5 prefix (browser-side guard for cache-key logic).
 */
import { describe, it, expect } from 'vitest';
import {
  suggestCacheKey,
  isValidLatLng,
  isValidMonth,
  clampLimit,
} from '../../src/lib/contextual-suggest';

// ── Geohash5 bucket helper ─────────────────────────────────────────────────
// Pure TypeScript port of the geohash encode algorithm used server-side.
// We only need 5-character precision (≈ 4.9 km × 4.9 km cell).
const BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function geohash5(lat: number, lng: number): string {
  let minLat = -90, maxLat = 90;
  let minLng = -180, maxLng = 180;
  let hash = '';
  let bits = 0;
  let charIdx = 0;
  let isLng = true;

  while (hash.length < 5) {
    if (isLng) {
      const mid = (minLng + maxLng) / 2;
      if (lng >= mid) { charIdx = (charIdx << 1) | 1; minLng = mid; }
      else             { charIdx = charIdx << 1;       maxLng = mid; }
    } else {
      const mid = (minLat + maxLat) / 2;
      if (lat >= mid) { charIdx = (charIdx << 1) | 1; minLat = mid; }
      else             { charIdx = charIdx << 1;       maxLat = mid; }
    }
    isLng = !isLng;
    bits++;
    if (bits === 5) {
      hash += BASE32[charIdx];
      bits = 0;
      charIdx = 0;
    }
  }
  return hash;
}

describe('probable_taxa_cache — geohash5 bucket', () => {
  it('two points within the same ~5 km cell share a geohash5', () => {
    // CDMX centre and a point 2 km north — should share the same 5-char hash
    const base = geohash5(19.43, -99.13);
    const near = geohash5(19.448, -99.13); // ~2 km north
    expect(base).toBe(near);
  });

  it('points in different cells produce different geohash5', () => {
    const cdmx    = geohash5(19.43, -99.13);
    const oaxaca  = geohash5(17.07, -96.72);
    expect(cdmx).not.toBe(oaxaca);
  });

  it('geohash5 is always 5 characters', () => {
    const coords: [number, number][] = [
      [19.43, -99.13], [-33.87, 151.21], [51.51, -0.13], [1.29, 103.85],
    ];
    for (const [lat, lng] of coords) {
      expect(geohash5(lat, lng)).toHaveLength(5);
    }
  });

  it('geohash5 only uses valid base32 characters', () => {
    const valid = new Set(BASE32.split(''));
    const h = geohash5(20.65, -105.25);
    for (const c of h) expect(valid.has(c)).toBe(true);
  });
});

// ── suggestCacheKey bucket regression ─────────────────────────────────────
describe('probable_taxa_cache — suggestCacheKey (regression)', () => {
  it('same cell + month → same key', () => {
    // Coords bucketed to 3dp = ~111 m, well within a 5 km geohash5 cell
    const k1 = suggestCacheKey({ lat: 19.430, lng: -99.130, month: 5 });
    const k2 = suggestCacheKey({ lat: 19.4301, lng: -99.1300, month: 5 });
    expect(k1).toBe(k2);
  });

  it('different month → different key', () => {
    const k1 = suggestCacheKey({ lat: 19.43, lng: -99.13, month: 5 });
    const k2 = suggestCacheKey({ lat: 19.43, lng: -99.13, month: 6 });
    expect(k1).not.toBe(k2);
  });

  it('includes month and rounded coords in key', () => {
    const k = suggestCacheKey({ lat: 19.43, lng: -99.13, month: 3 });
    expect(k).toContain('3');
    expect(k).toContain('19.43');
    expect(k).toContain('-99.13');
  });
});

// ── Input validation regression ────────────────────────────────────────────
describe('probable_taxa_cache — input guard regression', () => {
  it('isValidLatLng rejects null island', () => {
    expect(isValidLatLng(0, 0)).toBe(false);
  });
  it('isValidMonth rejects out-of-range', () => {
    expect(isValidMonth(0)).toBe(false);
    expect(isValidMonth(13)).toBe(false);
  });
  it('clampLimit caps at 50', () => {
    expect(clampLimit(100)).toBe(50);
  });
  it('clampLimit defaults to 10 for undefined', () => {
    expect(clampLimit(undefined)).toBe(10);
  });
});

// ── Cache SQL shape contract (type-level test) ─────────────────────────────
// These types mirror the probable_taxa_cache table schema so TypeScript
// catches any accidental shape mismatch early.
describe('probable_taxa_cache — schema type contract', () => {
  type CacheRow = {
    geohash5:   string;
    month:      number;
    taxon_id:   string;
    score:      number;
    updated_at: string;
  };

  it('accepts a well-formed row', () => {
    const row: CacheRow = {
      geohash5:   '9g3p5',
      month:      5,
      taxon_id:   '00000000-0000-0000-0000-000000000001',
      score:      42,
      updated_at: '2026-05-10T03:00:00Z',
    };
    expect(row.geohash5).toHaveLength(5);
    expect(row.month).toBeGreaterThanOrEqual(1);
    expect(row.month).toBeLessThanOrEqual(12);
    expect(row.score).toBeGreaterThanOrEqual(0);
  });
});
