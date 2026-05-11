/**
 * home-nearby.test.ts — unit tests for the HomeNearby component logic.
 *
 * Issue #712: Deeper location integration.
 *
 * Tests the pure utility functions extracted from HomeNearby.astro:
 *   - haversineKm: correct distance computation
 *   - getCachedLocation / setCachedLocation: sessionStorage TTL logic
 *   - renderCard: HTML output shape
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Extracted pure functions (mirror HomeNearby.astro script logic) ───────────

const LOCATION_TTL_MS = 5 * 60 * 1000;

interface CachedLocation {
  lat: number;
  lng: number;
  ts: number;
}

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

function getCachedLocation(
  store: Map<string, string>,
  key: string,
  now: number,
): CachedLocation | null {
  const raw = store.get(key);
  if (!raw) return null;
  try {
    const loc: CachedLocation = JSON.parse(raw);
    if (now - loc.ts > LOCATION_TTL_MS) return null;
    return loc;
  } catch {
    return null;
  }
}

function setCachedLocation(store: Map<string, string>, key: string, lat: number, lng: number, now: number): void {
  store.set(key, JSON.stringify({ lat, lng, ts: now }));
}

function escape(s: string): string {
  const m: Record<string, string> = { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' };
  return s.replace(/[&<>"']/g, c => m[c]);
}

interface NearbyRow {
  id: string;
  scientific_name: string | null;
  common_name_en: string | null;
  common_name_es: string | null;
  photo_url: string | null;
  observed_at: string;
  distance_m: number;
}

function renderCard(
  row: NearbyRow,
  lang: 'en' | 'es',
  shareBase: string,
  labelKmAway: string,
): string {
  const displayName =
    (lang === 'es'
      ? row.common_name_es ?? row.common_name_en
      : row.common_name_en ?? row.common_name_es) ?? row.scientific_name ?? '';
  const distKm = row.distance_m > 0 ? (row.distance_m / 1000).toFixed(1) : null;
  const distLabel = distKm ? labelKmAway.replace('{{dist}}', distKm) : '';
  const href = `${shareBase}?id=${escape(row.id)}`;
  return `<li><a href="${href}">${escape(displayName)}${distLabel ? ` | ${escape(distLabel)}` : ''}</a></li>`;
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('haversineKm', () => {
  it('returns ~0 for identical coordinates', () => {
    expect(haversineKm(19.43, -99.13, 19.43, -99.13)).toBeCloseTo(0, 3);
  });

  it('returns correct distance CDMX → Guadalajara (~460 km)', () => {
    const km = haversineKm(19.4326, -99.1332, 20.6597, -103.3496);
    expect(km).toBeGreaterThan(450);
    expect(km).toBeLessThan(480);
  });

  it('returns correct distance for nearby points (~1 km)', () => {
    // Move ~0.009 degrees N ≈ 1 km
    const km = haversineKm(19.43, -99.13, 19.439, -99.13);
    expect(km).toBeGreaterThan(0.9);
    expect(km).toBeLessThan(1.1);
  });

  it('is symmetric', () => {
    const a = haversineKm(19.43, -99.13, 20.66, -103.35);
    const b = haversineKm(20.66, -103.35, 19.43, -99.13);
    expect(a).toBeCloseTo(b, 5);
  });
});

describe('getCachedLocation / setCachedLocation', () => {
  const KEY = 'rastrum.user_location';
  let store: Map<string, string>;
  let now: number;

  beforeEach(() => {
    store = new Map();
    now = Date.now();
  });

  it('returns null when nothing is stored', () => {
    expect(getCachedLocation(store, KEY, now)).toBeNull();
  });

  it('returns stored location when fresh', () => {
    setCachedLocation(store, KEY, 19.43, -99.13, now);
    const result = getCachedLocation(store, KEY, now);
    expect(result).not.toBeNull();
    expect(result!.lat).toBe(19.43);
    expect(result!.lng).toBe(-99.13);
  });

  it('returns null when cache is stale (> 5 min)', () => {
    setCachedLocation(store, KEY, 19.43, -99.13, now - LOCATION_TTL_MS - 1000);
    expect(getCachedLocation(store, KEY, now)).toBeNull();
  });

  it('returns location when cache is exactly at TTL boundary', () => {
    // Exactly at TTL means ts = now - LOCATION_TTL_MS, so now - ts === LOCATION_TTL_MS
    // The check is `now - loc.ts > LOCATION_TTL_MS`, so exactly equal is NOT expired.
    setCachedLocation(store, KEY, 19.43, -99.13, now - LOCATION_TTL_MS);
    const result = getCachedLocation(store, KEY, now);
    // At exactly the boundary: NOT > LOCATION_TTL_MS, so still valid
    expect(result).not.toBeNull();
  });

  it('returns location when cache is 1ms before TTL', () => {
    setCachedLocation(store, KEY, 19.43, -99.13, now - LOCATION_TTL_MS + 1);
    const result = getCachedLocation(store, KEY, now);
    expect(result).not.toBeNull();
  });

  it('returns null on malformed JSON', () => {
    store.set(KEY, '{bad json}');
    expect(getCachedLocation(store, KEY, now)).toBeNull();
  });

  it('overwrites existing entry', () => {
    setCachedLocation(store, KEY, 19.43, -99.13, now);
    setCachedLocation(store, KEY, 20.66, -103.35, now);
    const result = getCachedLocation(store, KEY, now);
    expect(result!.lat).toBe(20.66);
    expect(result!.lng).toBe(-103.35);
  });
});

describe('renderCard', () => {
  const shareBase = '/share/obs/';
  const labelKmAway = '{{dist}} km away';

  it('renders a list item with species name and distance', () => {
    const row: NearbyRow = {
      id: 'abc-123',
      scientific_name: 'Quercus rugosa',
      common_name_en: 'Netleaf Oak',
      common_name_es: 'Encino',
      photo_url: null,
      observed_at: '2026-05-01T10:00:00Z',
      distance_m: 1500,
    };
    const html = renderCard(row, 'en', shareBase, labelKmAway);
    expect(html).toContain('Netleaf Oak');
    expect(html).toContain('1.5 km away');
    expect(html).toContain('/share/obs/?id=abc-123');
  });

  it('uses common_name_es in Spanish', () => {
    const row: NearbyRow = {
      id: 'xyz-456',
      scientific_name: 'Quercus rugosa',
      common_name_en: 'Netleaf Oak',
      common_name_es: 'Encino',
      photo_url: null,
      observed_at: '2026-05-01T10:00:00Z',
      distance_m: 3200,
    };
    const html = renderCard(row, 'es', shareBase, '{{dist}} km de distancia');
    expect(html).toContain('Encino');
    expect(html).toContain('3.2 km de distancia');
  });

  it('falls back to scientific_name when common names are null', () => {
    const row: NearbyRow = {
      id: 'no-common',
      scientific_name: 'Tillandsia usneoides',
      common_name_en: null,
      common_name_es: null,
      photo_url: null,
      observed_at: '2026-05-01T10:00:00Z',
      distance_m: 500,
    };
    const html = renderCard(row, 'en', shareBase, labelKmAway);
    expect(html).toContain('Tillandsia usneoides');
  });

  it('omits distance label when distance_m is 0', () => {
    const row: NearbyRow = {
      id: 'no-dist',
      scientific_name: 'Drosera',
      common_name_en: 'Sundew',
      common_name_es: null,
      photo_url: null,
      observed_at: '2026-05-01T10:00:00Z',
      distance_m: 0,
    };
    const html = renderCard(row, 'en', shareBase, labelKmAway);
    expect(html).not.toContain('km away');
  });

  it('escapes HTML in species name', () => {
    const row: NearbyRow = {
      id: 'xss-test',
      scientific_name: '<script>alert(1)</script>',
      common_name_en: null,
      common_name_es: null,
      photo_url: null,
      observed_at: '2026-05-01T10:00:00Z',
      distance_m: 100,
    };
    const html = renderCard(row, 'en', shareBase, labelKmAway);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
