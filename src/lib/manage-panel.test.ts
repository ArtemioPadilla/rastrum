import { describe, it, expect } from 'vitest';
import {
  buildDetailsUpdatePayload,
  isoToLocalDatetimeInput,
  localDatetimeInputToIso,
  pointGeographyLiteral,
  pointGeographyGeoJSON,
} from './manage-panel';

describe('manage-panel helpers', () => {
  describe('isoToLocalDatetimeInput', () => {
    it('returns empty string for null/undefined/invalid', () => {
      expect(isoToLocalDatetimeInput(null)).toBe('');
      expect(isoToLocalDatetimeInput(undefined)).toBe('');
      expect(isoToLocalDatetimeInput('')).toBe('');
      expect(isoToLocalDatetimeInput('not-a-date')).toBe('');
    });

    it('round-trips through localDatetimeInputToIso', () => {
      // Round-trip must preserve millisecond precision relative to the
      // input minute. The local-input format truncates seconds.
      const input = '2026-04-15T08:30';
      const iso = localDatetimeInputToIso(input);
      expect(iso).toMatch(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:00\.000Z$/);
      expect(isoToLocalDatetimeInput(iso!)).toBe(input);
    });
  });

  describe('localDatetimeInputToIso', () => {
    it('returns null for empty/invalid', () => {
      expect(localDatetimeInputToIso(null)).toBeNull();
      expect(localDatetimeInputToIso(undefined)).toBeNull();
      expect(localDatetimeInputToIso('')).toBeNull();
      expect(localDatetimeInputToIso('not-a-date')).toBeNull();
    });

    it('produces a UTC ISO string', () => {
      const out = localDatetimeInputToIso('2026-04-15T08:30');
      expect(out).toMatch(/Z$/);
      // The exact wall-clock UTC depends on host TZ, so just sanity-check
      // structure rather than exact value.
      expect(new Date(out!).toISOString()).toBe(out);
    });
  });

  describe('buildDetailsUpdatePayload', () => {
    const base = {
      notes: 'Sighted near the trail',
      obscure_level: '5km',
      observed_at_local: '2026-04-15T08:30',
      habitat: 'cloud_forest',
      weather: 'fog',
      establishment_means: 'wild',
    };

    it('includes every Details field in the payload', () => {
      const p = buildDetailsUpdatePayload(base);
      expect(p.notes).toBe('Sighted near the trail');
      expect(p.obscure_level).toBe('5km');
      expect(p.habitat).toBe('cloud_forest');
      expect(p.weather).toBe('fog');
      expect(p.establishment_means).toBe('wild');
      expect(p.observed_at).toBeTruthy();
      expect(p.updated_at).toBeTruthy();
    });

    it('coerces empty strings to null for nullable text columns', () => {
      const p = buildDetailsUpdatePayload({
        ...base,
        notes: '   ',
        habitat: '',
        weather: '',
        establishment_means: '',
      });
      expect(p.notes).toBeNull();
      expect(p.habitat).toBeNull();
      expect(p.weather).toBeNull();
      expect(p.establishment_means).toBeNull();
    });

    it('defaults obscure_level to none when blank', () => {
      const p = buildDetailsUpdatePayload({ ...base, obscure_level: '' });
      expect(p.obscure_level).toBe('none');
    });

    it('omits observed_at when input is empty (preserves existing value)', () => {
      const p = buildDetailsUpdatePayload({ ...base, observed_at_local: '' });
      expect('observed_at' in p).toBe(false);
    });

    it('always includes updated_at as a fresh ISO string', () => {
      const before = Date.now();
      const p = buildDetailsUpdatePayload(base);
      const after = Date.now();
      const t = new Date(p.updated_at).getTime();
      expect(t).toBeGreaterThanOrEqual(before);
      expect(t).toBeLessThanOrEqual(after);
    });
  });

  describe('pointGeographyGeoJSON', () => {
    it('emits a GeoJSON Point with [lng, lat] coordinates — used for supabase-js UPDATE', () => {
      // CDMX: lat=19.4326, lng=-99.1332
      // GeoJSON spec: coordinates are [longitude, latitude]
      const pt = pointGeographyGeoJSON(19.4326, -99.1332);
      expect(pt).toEqual({ type: 'Point', coordinates: [-99.1332, 19.4326] });
    });

    it('handles whole-number coords', () => {
      expect(pointGeographyGeoJSON(0, 0)).toEqual({ type: 'Point', coordinates: [0, 0] });
    });

    it('rejects out-of-range latitudes', () => {
      expect(() => pointGeographyGeoJSON(90.1, 0)).toThrow('coords_invalid');
      expect(() => pointGeographyGeoJSON(-90.1, 0)).toThrow('coords_invalid');
    });

    it('rejects out-of-range longitudes', () => {
      expect(() => pointGeographyGeoJSON(0, 180.1)).toThrow('coords_invalid');
      expect(() => pointGeographyGeoJSON(0, -180.1)).toThrow('coords_invalid');
    });

    it('rejects non-finite numbers', () => {
      expect(() => pointGeographyGeoJSON(Number.NaN, 0)).toThrow('coords_invalid');
      expect(() => pointGeographyGeoJSON(0, Number.POSITIVE_INFINITY)).toThrow('coords_invalid');
    });
  });

  describe('pointGeographyLiteral', () => {
    it('emits SRID-prefixed POINT(lng lat) — longitude first per PostGIS', () => {
      // 19.4326 / -99.1332 → CDMX. Longitude must precede latitude in the
      // WKT literal even though the function arg order is (lat, lng).
      expect(pointGeographyLiteral(19.4326, -99.1332)).toBe('SRID=4326;POINT(-99.1332 19.4326)');
    });

    it('handles whole-number coords', () => {
      expect(pointGeographyLiteral(0, 0)).toBe('SRID=4326;POINT(0 0)');
    });

    it('rejects out-of-range latitudes', () => {
      expect(() => pointGeographyLiteral(90.1, 0)).toThrow('coords_invalid');
      expect(() => pointGeographyLiteral(-90.1, 0)).toThrow('coords_invalid');
    });

    it('rejects out-of-range longitudes', () => {
      expect(() => pointGeographyLiteral(0, 180.1)).toThrow('coords_invalid');
      expect(() => pointGeographyLiteral(0, -180.1)).toThrow('coords_invalid');
    });

    it('rejects non-finite numbers', () => {
      expect(() => pointGeographyLiteral(Number.NaN, 0)).toThrow('coords_invalid');
      expect(() => pointGeographyLiteral(0, Number.POSITIVE_INFINITY)).toThrow('coords_invalid');
    });
  });
});
