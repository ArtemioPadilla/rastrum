/**
 * explore-distance-filter.test.ts — unit tests for the ExploreRecentView
 * distance filter logic added in issue #712.
 *
 * Tests the pure functions extracted from ExploreRecentView.astro:
 *   - haversineKm: distance computation (shared with HomeNearby)
 *   - applyDistanceFilter: filter predicate with/without _distKm
 *   - Distance button label generation
 *   - getCachedLoc / setCachedLoc: sessionStorage TTL logic
 */
import { describe, it, expect } from 'vitest';

// ── Types (mirror ExploreRecentView Row) ──────────────────────────────────────

interface Row {
  id: string;
  observed_at: string;
  state_province: string | null;
  observer_id: string;
  identifications: unknown;
  media_files: unknown[];
  users: unknown;
}

type RowWithDist = Row & { _distKm?: number };

// ── Extracted pure functions ───────────────────────────────────────────────────

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371;
  const dLat = ((lat2 - lat1) * Math.PI) / 180;
  const dLng = ((lng2 - lng1) * Math.PI) / 180;
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos((lat1 * Math.PI) / 180) *
      Math.cos((lat2 * Math.PI) / 180) *
      Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

function applyDistanceFilter(
  rows: Row[],
  distanceFilterKm: number | null,
  _userLat: number | null,
  _userLng: number | null,
): Row[] {
  if (distanceFilterKm === null) return rows;
  return (rows as RowWithDist[]).filter((r) => {
    if (typeof r._distKm === 'number') return r._distKm <= distanceFilterKm;
    return true; // no coord data — include conservatively
  });
}

const LOCATION_TTL_MS = 5 * 60 * 1000;
interface CachedLoc { lat: number; lng: number; ts: number; }

function getCachedLoc(store: Map<string, string>, key: string, now: number): { lat: number; lng: number } | null {
  const raw = store.get(key);
  if (!raw) return null;
  try {
    const loc: CachedLoc = JSON.parse(raw);
    if (now - loc.ts > LOCATION_TTL_MS) return null;
    return { lat: loc.lat, lng: loc.lng };
  } catch { return null; }
}

function setCachedLoc(store: Map<string, string>, key: string, lat: number, lng: number, now: number): void {
  store.set(key, JSON.stringify({ lat, lng, ts: now }));
}

function makeDistanceButton(km: number | null, active: boolean, labelAll: string, labelKmTpl: string): string {
  const label = km === null ? labelAll : labelKmTpl.replace('{{km}}', String(km));
  return `<button data-km="${km === null ? '' : km}" aria-pressed="${active}">${label}</button>`;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRow(id: string, distKm?: number): RowWithDist {
  return {
    id,
    observed_at: '2026-05-01T10:00:00Z',
    state_province: null,
    observer_id: 'u1',
    identifications: null,
    media_files: [],
    users: null,
    _distKm: distKm,
  };
}

// ── Tests: applyDistanceFilter ────────────────────────────────────────────────

describe('applyDistanceFilter', () => {
  const rows: Row[] = [
    makeRow('r1', 3),
    makeRow('r2', 8),
    makeRow('r3', 12),
    makeRow('r4', 30),
    makeRow('r5'), // no distance data
  ];

  it('returns all rows when filter is null (All)', () => {
    const result = applyDistanceFilter(rows, null, 19.43, -99.13);
    expect(result).toHaveLength(5);
  });

  it('filters to rows within 5 km', () => {
    const result = applyDistanceFilter(rows, 5, 19.43, -99.13);
    // r1 (3 km), r5 (no data — included conservatively)
    const ids = result.map(r => r.id);
    expect(ids).toContain('r1');
    expect(ids).not.toContain('r2');
    expect(ids).not.toContain('r3');
    expect(ids).not.toContain('r4');
    expect(ids).toContain('r5'); // no coord — included conservatively
  });

  it('filters to rows within 10 km', () => {
    const result = applyDistanceFilter(rows, 10, 19.43, -99.13);
    const ids = result.map(r => r.id);
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
    expect(ids).not.toContain('r3');
    expect(ids).not.toContain('r4');
    expect(ids).toContain('r5'); // conservatively included
  });

  it('filters to rows within 25 km', () => {
    const result = applyDistanceFilter(rows, 25, 19.43, -99.13);
    const ids = result.map(r => r.id);
    expect(ids).toContain('r1');
    expect(ids).toContain('r2');
    expect(ids).toContain('r3');
    expect(ids).not.toContain('r4');
    expect(ids).toContain('r5');
  });

  it('includes all when filter is 50 km', () => {
    const result = applyDistanceFilter(rows, 50, 19.43, -99.13);
    expect(result).toHaveLength(5);
  });

  it('includes rows at exactly the boundary distance', () => {
    const exact = [makeRow('boundary', 10)];
    const result = applyDistanceFilter(exact, 10, 19.43, -99.13);
    expect(result).toHaveLength(1);
  });

  it('returns empty array when all rows are beyond filter radius', () => {
    const far = [makeRow('far1', 100), makeRow('far2', 200)];
    const result = applyDistanceFilter(far, 5, 19.43, -99.13);
    // No rows with _distKm ≤ 5; no rows without _distKm
    expect(result).toHaveLength(0);
  });
});

// ── Tests: haversineKm ────────────────────────────────────────────────────────

describe('haversineKm (explore)', () => {
  it('returns 0 for same point', () => {
    expect(haversineKm(19.43, -99.13, 19.43, -99.13)).toBeCloseTo(0, 3);
  });

  it('10 km radius covers nearby point', () => {
    // ~9 km north of CDMX
    const km = haversineKm(19.43, -99.13, 19.511, -99.13);
    expect(km).toBeLessThan(10);
  });

  it('10 km radius excludes distant point', () => {
    // ~60 km north
    const km = haversineKm(19.43, -99.13, 19.97, -99.13);
    expect(km).toBeGreaterThan(10);
  });
});

// ── Tests: distance button label generation ───────────────────────────────────

describe('makeDistanceButton', () => {
  it('generates "All" button for null radius', () => {
    const btn = makeDistanceButton(null, true, 'All', '{{km}} km');
    expect(btn).toContain('data-km=""');
    expect(btn).toContain('aria-pressed="true"');
    expect(btn).toContain('>All<');
  });

  it('generates km button with correct label', () => {
    const btn = makeDistanceButton(10, false, 'All', '{{km}} km');
    expect(btn).toContain('data-km="10"');
    expect(btn).toContain('aria-pressed="false"');
    expect(btn).toContain('>10 km<');
  });

  it('uses custom km template', () => {
    const btn = makeDistanceButton(25, false, 'Todos', '{{km}} km de ti');
    expect(btn).toContain('>25 km de ti<');
  });

  it('generates buttons for all standard radii', () => {
    const radii: (number | null)[] = [null, 5, 10, 25, 50];
    const btns = radii.map(km => makeDistanceButton(km, km === null, 'All', '{{km}} km'));
    expect(btns).toHaveLength(5);
    expect(btns[0]).toContain('All');
    expect(btns[1]).toContain('5 km');
    expect(btns[4]).toContain('50 km');
  });
});

// ── Tests: getCachedLoc / setCachedLoc ───────────────────────────────────────

describe('getCachedLoc / setCachedLoc (explore)', () => {
  const KEY = 'rastrum.user_location';

  it('returns null when store is empty', () => {
    const store = new Map<string, string>();
    expect(getCachedLoc(store, KEY, Date.now())).toBeNull();
  });

  it('round-trips lat/lng through cache', () => {
    const store = new Map<string, string>();
    const now = Date.now();
    setCachedLoc(store, KEY, 20.66, -103.35, now);
    const result = getCachedLoc(store, KEY, now);
    expect(result!.lat).toBe(20.66);
    expect(result!.lng).toBe(-103.35);
  });

  it('returns null when expired', () => {
    const store = new Map<string, string>();
    const now = Date.now();
    setCachedLoc(store, KEY, 19.43, -99.13, now - LOCATION_TTL_MS - 1);
    expect(getCachedLoc(store, KEY, now)).toBeNull();
  });
});
