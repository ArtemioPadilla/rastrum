import { describe, it, expect, beforeEach } from 'vitest';
import {
  loadPlacesGps,
  savePlacesGps,
  clearPlacesGps,
  formatDistance,
  serializePlacesQuery,
} from '../../src/lib/places-url';

describe('places-url GPS sessionStorage', () => {
  let store: Map<string, string>;
  let storage: { getItem: (k: string) => string | null; setItem: (k: string, v: string) => void; removeItem: (k: string) => void };

  beforeEach(() => {
    store = new Map<string, string>();
    storage = {
      getItem: (k: string) => (store.has(k) ? store.get(k)! : null),
      setItem: (k: string, v: string) => { store.set(k, v); },
      removeItem: (k: string) => { store.delete(k); },
    };
  });

  it('round-trips lat/lng through saveGps + loadGps', () => {
    savePlacesGps({ lat: 19.4326, lng: -99.1332 }, storage);
    expect(loadPlacesGps(storage)).toEqual({ lat: 19.4326, lng: -99.1332 });
  });

  it('returns null when no coords are stored', () => {
    expect(loadPlacesGps(storage)).toBeNull();
  });

  it('rejects malformed payloads', () => {
    storage.setItem('rastrum.places.gps', 'not-json');
    expect(loadPlacesGps(storage)).toBeNull();

    storage.setItem('rastrum.places.gps', JSON.stringify({ lat: 'foo', lng: 0 }));
    expect(loadPlacesGps(storage)).toBeNull();

    storage.setItem('rastrum.places.gps', JSON.stringify({ lat: 0 }));
    expect(loadPlacesGps(storage)).toBeNull();
  });

  it('rejects out-of-range coords', () => {
    storage.setItem('rastrum.places.gps', JSON.stringify({ lat: 95, lng: 0 }));
    expect(loadPlacesGps(storage)).toBeNull();
    storage.setItem('rastrum.places.gps', JSON.stringify({ lat: 0, lng: -200 }));
    expect(loadPlacesGps(storage)).toBeNull();
  });

  it('clearGps wipes the slot', () => {
    savePlacesGps({ lat: 1, lng: 2 }, storage);
    clearPlacesGps(storage);
    expect(loadPlacesGps(storage)).toBeNull();
  });

  it('returns null when storage is unavailable (no throw)', () => {
    expect(loadPlacesGps(null)).toBeNull();
    expect(() => savePlacesGps({ lat: 1, lng: 2 }, null)).not.toThrow();
    expect(() => clearPlacesGps(null)).not.toThrow();
  });

  it('uses a different storage key than community-url (no collision)', () => {
    savePlacesGps({ lat: 1, lng: 2 }, storage);
    expect(store.has('rastrum.places.gps')).toBe(true);
    expect(store.has('rastrum.community.gps')).toBe(false);
  });
});

describe('places-url serializePlacesQuery — privacy invariant', () => {
  it('NEVER serializes GPS coords into the URL', () => {
    // Even if Near-me mode is active, the serializer must not leak
    // coords into ?lat=…&lng=… (would leak via Referer + history).
    // Coords stay in sessionStorage; URL only carries the toggle.
    // Mirrors tests/unit/community-url.test.ts regression guard.
    const qs = serializePlacesQuery({ near: true });
    expect(qs).toContain('near=true');
    expect(qs).not.toMatch(/\blat\b/);
    expect(qs).not.toMatch(/\blng\b/);
    expect(qs).not.toMatch(/\bgps\b/);
    expect(qs).not.toMatch(/\d+\.\d+/);
  });

  it('emits empty string when no options are set', () => {
    expect(serializePlacesQuery({})).toBe('');
  });

  it('round-trips type, q, page', () => {
    const qs = serializePlacesQuery({ type: 'protected_area', q: 'oaxaca', page: 3 });
    expect(qs).toContain('type=protected_area');
    expect(qs).toContain('q=oaxaca');
    expect(qs).toContain('page=3');
  });

  it('omits page=1', () => {
    expect(serializePlacesQuery({ page: 1 })).toBe('');
  });
});

describe('places-url formatDistance', () => {
  it('formats meters under 1 km', () => {
    expect(formatDistance(450, 'en')).toBe('~450 m');
    expect(formatDistance(999, 'es')).toBe('~999 m');
  });

  it('formats km with 1 decimal under 10 km', () => {
    expect(formatDistance(2300, 'en')).toBe('~2.3 km');
    expect(formatDistance(9990, 'es')).toBe('~10.0 km');
  });

  it('formats km with no decimal at 10 km+', () => {
    expect(formatDistance(15000, 'en')).toBe('~15 km');
    expect(formatDistance(123456, 'es')).toBe('~123 km');
  });

  it('returns empty string for invalid input', () => {
    expect(formatDistance(NaN, 'en')).toBe('');
    expect(formatDistance(-1, 'en')).toBe('');
  });
});
