import { describe, it, expect, beforeEach } from 'vitest';
import {
  parseFilters,
  serializeFilters,
  loadGps,
  saveGps,
  clearGps,
  type CommunityFilters,
} from '../../src/lib/community-url';

describe('community-url', () => {
  it('parses an empty querystring to defaults', () => {
    expect(parseFilters('')).toEqual({
      sort: 'observation_count',
      country: null,
      taxa: [],
      experts: false,
      nearby: false,
      page: 1,
    });
  });

  it('round-trips a fully populated state', () => {
    const f: CommunityFilters = {
      sort: 'obs_count_30d',
      country: 'MX',
      taxa: ['Aves', 'Plantae'],
      experts: true,
      nearby: false,
      page: 2,
    };
    expect(parseFilters(serializeFilters(f))).toEqual(f);
  });

  it('drops unknown sort values silently (does not crash)', () => {
    expect(parseFilters('?sort=unknown_thing').sort).toBe('observation_count');
  });

  it('treats nearby=true as forcing sort=distance when no sort is given', () => {
    expect(parseFilters('?nearby=true')).toMatchObject({
      nearby: true,
      sort: 'distance',
    });
  });

  it('keeps an explicit sort even when nearby=true', () => {
    expect(parseFilters('?nearby=true&sort=species_count')).toMatchObject({
      nearby: true,
      sort: 'species_count',
    });
  });

  it('parses comma-separated taxa', () => {
    expect(parseFilters('?taxon=Aves,Plantae').taxa).toEqual(['Aves', 'Plantae']);
  });

  it('clamps page to >= 1', () => {
    expect(parseFilters('?page=0').page).toBe(1);
    expect(parseFilters('?page=-5').page).toBe(1);
    expect(parseFilters('?page=abc').page).toBe(1);
  });

  it('emits no key for empty arrays / nulls / defaults', () => {
    const f: CommunityFilters = {
      sort: 'observation_count',
      country: null,
      taxa: [],
      experts: false,
      nearby: false,
      page: 1,
    };
    expect(serializeFilters(f)).toBe('');
  });

  it('rejects invalid country codes', () => {
    expect(parseFilters('?country=mexico').country).toBe(null);
    expect(parseFilters('?country=MEX').country).toBe(null);
    expect(parseFilters('?country=MX').country).toBe('MX');
  });

  it('serializes country with leading question mark', () => {
    expect(serializeFilters({
      sort: 'observation_count',
      country: 'BR',
      taxa: [],
      experts: false,
      nearby: false,
      page: 1,
    })).toBe('?country=BR');
  });

  it('round-trips with experts and nearby together', () => {
    const f: CommunityFilters = {
      sort: 'distance',
      country: null,
      taxa: ['Aves'],
      experts: true,
      nearby: true,
      page: 1,
    };
    expect(parseFilters(serializeFilters(f))).toEqual(f);
  });

  it('NEVER serializes GPS coords into the URL — privacy invariant', () => {
    // Even if GPS is set in sessionStorage, the filter serializer must
    // not leak coords into ?lat=…&lng=… (would leak via Referer header
    // and browser history). Coords are an out-of-band mode toggle, not
    // a URL filter. Regression guard.
    const f: CommunityFilters = {
      sort: 'distance',
      country: 'MX',
      taxa: [],
      experts: false,
      nearby: true,
      page: 1,
    };
    const qs = serializeFilters(f);
    expect(qs).not.toMatch(/\blat\b/);
    expect(qs).not.toMatch(/\blng\b/);
    expect(qs).not.toMatch(/\bgps\b/);
    expect(qs).not.toMatch(/\d+\.\d+/); // No floats anywhere
  });

  it('parseFilters ignores any lat/lng/gps querystring values', () => {
    // Hand-crafted attack URL — even if a user pastes coords manually
    // (or another tool generates them), the parser drops them. The
    // round-trip never carries them.
    const f = parseFilters('?nearby=true&lat=19.43&lng=-99.13&gps=on');
    // Filter shape is unchanged — no lat/lng fields exist on the type
    // and serializing it produces only the known keys.
    const out = serializeFilters(f);
    expect(out).toContain('nearby=true');
    expect(out).toContain('sort=distance');
    expect(out).not.toMatch(/\blat\b/);
    expect(out).not.toMatch(/\blng\b/);
    expect(out).not.toMatch(/\bgps\b/);
  });
});

describe('community-url GPS sessionStorage', () => {
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
    saveGps({ lat: 19.4326, lng: -99.1332 }, storage);
    expect(loadGps(storage)).toEqual({ lat: 19.4326, lng: -99.1332 });
  });

  it('returns null when no coords are stored', () => {
    expect(loadGps(storage)).toBeNull();
  });

  it('rejects malformed payloads', () => {
    storage.setItem('rastrum.community.gps', 'not-json');
    expect(loadGps(storage)).toBeNull();

    storage.setItem('rastrum.community.gps', JSON.stringify({ lat: 'foo', lng: 0 }));
    expect(loadGps(storage)).toBeNull();

    storage.setItem('rastrum.community.gps', JSON.stringify({ lat: 0 }));
    expect(loadGps(storage)).toBeNull();
  });

  it('rejects out-of-range coords', () => {
    storage.setItem('rastrum.community.gps', JSON.stringify({ lat: 95, lng: 0 }));
    expect(loadGps(storage)).toBeNull();
    storage.setItem('rastrum.community.gps', JSON.stringify({ lat: 0, lng: -200 }));
    expect(loadGps(storage)).toBeNull();
  });

  it('clearGps wipes the slot', () => {
    saveGps({ lat: 1, lng: 2 }, storage);
    clearGps(storage);
    expect(loadGps(storage)).toBeNull();
  });

  it('returns null when storage is unavailable (no throw)', () => {
    expect(loadGps(null)).toBeNull();
    expect(() => saveGps({ lat: 1, lng: 2 }, null)).not.toThrow();
    expect(() => clearGps(null)).not.toThrow();
  });
});
