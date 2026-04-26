import { describe, it, expect } from 'vitest';
import {
  buildBatchRow, applyBulkSet, isRowReady, summariseRows,
  type BatchRow, type BulkSetPatch, type ExifSummary,
} from './batch-import';

const fakeFile = (over: Partial<{ name: string; size: number; type: string }> = {}) => ({
  name: 'IMG_0001.jpg',
  size: 1024,
  type: 'image/jpeg',
  ...over,
});

describe('buildBatchRow', () => {
  it('produces a row with no GPS when EXIF is missing', () => {
    const row = buildBatchRow(fakeFile(), null);
    expect(row.lat).toBeNull();
    expect(row.lng).toBeNull();
    expect(row.locationSource).toBe('none');
    expect(row.datetime).toBeNull();
    expect(row.evidenceType).toBe('direct_sighting');
    expect(row.excluded).toBe(false);
  });

  it('extracts lat / lng / altitude from EXIF', () => {
    const exif: ExifSummary = { latitude: 17.144, longitude: -96.7447, GPSAltitude: 1500 };
    const row = buildBatchRow(fakeFile(), exif);
    expect(row.lat).toBe(17.144);
    expect(row.lng).toBe(-96.7447);
    expect(row.altitudeM).toBe(1500);
    expect(row.locationSource).toBe('exif');
  });

  it('honours the camera-trap default evidence type', () => {
    const row = buildBatchRow(fakeFile(), null, { defaultEvidenceType: 'camera_trap' });
    expect(row.evidenceType).toBe('camera_trap');
  });

  it('parses Date instances for datetime', () => {
    const d = new Date('2026-04-24T15:30:00Z');
    const row = buildBatchRow(fakeFile(), { DateTimeOriginal: d });
    expect(row.datetime).toBe(d.toISOString());
  });

  it('parses EXIF "YYYY:MM:DD HH:MM:SS" datetime strings into a real ISO string', () => {
    // EXIF datetimes have no timezone info — the parser interprets them
    // as local time (matching what every camera EXIF reader does). We
    // assert the parse succeeded rather than the exact UTC offset, which
    // is host-dependent.
    const row = buildBatchRow(fakeFile(), { DateTimeOriginal: '2026:04:24 15:30:45' });
    expect(row.datetime).not.toBeNull();
    expect(Date.parse(row.datetime!)).toBeGreaterThan(0);
    // The local date should be 2026-04-24 — round-trip through Date.
    const d = new Date(row.datetime!);
    expect(d.getFullYear()).toBe(2026);
    expect(d.getMonth()).toBe(3); // April
    expect(d.getDate()).toBe(24);
  });

  it('falls back to CreateDate, then ModifyDate', () => {
    const r1 = buildBatchRow(fakeFile(), { CreateDate: '2026:01:01 00:00:00' });
    expect(r1.datetime).not.toBeNull();
    const d1 = new Date(r1.datetime!);
    expect(d1.getFullYear()).toBe(2026);
    expect(d1.getMonth()).toBe(0);
    const r2 = buildBatchRow(fakeFile(), { ModifyDate: new Date('2025-12-31T23:59:59Z') });
    expect(r2.datetime).toBe('2025-12-31T23:59:59.000Z');
  });

  it('rejects unparseable strings without throwing', () => {
    const row = buildBatchRow(fakeFile(), { DateTimeOriginal: 'not-a-date' });
    expect(row.datetime).toBeNull();
  });

  it('keeps the file name and size verbatim', () => {
    const row = buildBatchRow(fakeFile({ name: 'CAM01_2026.jpg', size: 5_000_000 }), null);
    expect(row.fileName).toBe('CAM01_2026.jpg');
    expect(row.fileSize).toBe(5_000_000);
  });
});

describe('applyBulkSet', () => {
  const base = (): BatchRow => ({
    id: 'a',
    fileName: 'x.jpg',
    fileSize: 1,
    mimeType: 'image/jpeg',
    lat: 17,
    lng: -96,
    altitudeM: null,
    locationSource: 'exif',
    datetime: null,
    habitat: null,
    weather: null,
    evidenceType: 'direct_sighting',
    notes: null,
    excluded: false,
  });

  it('applies a single field across all rows', () => {
    const rows = [base(), { ...base(), id: 'b' }];
    const next = applyBulkSet(rows, { habitat: 'cloud_forest' });
    expect(next.every(r => r.habitat === 'cloud_forest')).toBe(true);
  });

  it('does not modify the input array (immutability)', () => {
    const rows = [base()];
    applyBulkSet(rows, { habitat: 'cloud_forest' });
    expect(rows[0].habitat).toBeNull();
  });

  it('skips excluded rows', () => {
    const rows = [base(), { ...base(), id: 'b', excluded: true }];
    const next = applyBulkSet(rows, { weather: 'overcast' });
    expect(next[0].weather).toBe('overcast');
    expect(next[1].weather).toBeNull();
  });

  it('honours explicit null to clear a field', () => {
    const rows = [{ ...base(), habitat: 'cloud_forest' as const }];
    const next = applyBulkSet(rows, { habitat: null });
    expect(next[0].habitat).toBeNull();
  });

  it('leaves untouched fields alone (undefined patch values are no-ops)', () => {
    const rows = [{ ...base(), habitat: 'cloud_forest' as const, weather: 'sunny' as const }];
    const patch: BulkSetPatch = { weather: 'cloudy' };
    const next = applyBulkSet(rows, patch);
    expect(next[0].habitat).toBe('cloud_forest');
    expect(next[0].weather).toBe('cloudy');
  });

  it('applies a bulk location across all included rows', () => {
    const rows = [base(), { ...base(), id: 'b', lat: null, lng: null, locationSource: 'none' as const }];
    const next = applyBulkSet(rows, { location: { lat: 16.5, lng: -95.0, altitudeM: 800 } });
    expect(next[0].lat).toBe(16.5);
    expect(next[0].lng).toBe(-95.0);
    expect(next[0].altitudeM).toBe(800);
    expect(next[0].locationSource).toBe('bulk');
    expect(next[1].lat).toBe(16.5);
    expect(next[1].locationSource).toBe('bulk');
  });

  it('clears location when patch.location is null', () => {
    const rows = [base()];
    const next = applyBulkSet(rows, { location: null });
    expect(next[0].lat).toBeNull();
    expect(next[0].lng).toBeNull();
    expect(next[0].locationSource).toBe('none');
  });

  it('refuses to overwrite evidenceType when patch value is undefined string', () => {
    const rows = [base()];
    const next = applyBulkSet(rows, {});
    expect(next[0].evidenceType).toBe('direct_sighting');
  });
});

describe('isRowReady', () => {
  const ok = (over: Partial<BatchRow> = {}): BatchRow => ({
    id: 'a', fileName: 'x', fileSize: 1, mimeType: 'image/jpeg',
    lat: 17, lng: -96, altitudeM: null,
    locationSource: 'exif', datetime: null,
    habitat: null, weather: null,
    evidenceType: 'direct_sighting', notes: null, excluded: false,
    ...over,
  });

  it('reports ready when row has finite lat / lng', () => {
    expect(isRowReady(ok())).toBe(true);
  });

  it('reports not ready when GPS is missing', () => {
    expect(isRowReady(ok({ lat: null }))).toBe(false);
    expect(isRowReady(ok({ lng: null }))).toBe(false);
  });

  it('reports not ready for excluded rows', () => {
    expect(isRowReady(ok({ excluded: true }))).toBe(false);
  });

  it('rejects out-of-range coordinates', () => {
    expect(isRowReady(ok({ lat: 91 }))).toBe(false);
    expect(isRowReady(ok({ lng: -181 }))).toBe(false);
  });
});

describe('summariseRows', () => {
  const r = (over: Partial<BatchRow> = {}): BatchRow => ({
    id: Math.random().toString(36),
    fileName: 'x', fileSize: 1, mimeType: 'image/jpeg',
    lat: 17, lng: -96, altitudeM: null,
    locationSource: 'exif', datetime: '2026-04-24T15:30:00Z',
    habitat: null, weather: null,
    evidenceType: 'direct_sighting', notes: null, excluded: false,
    ...over,
  });

  it('counts ready, with-GPS, with-datetime, excluded', () => {
    const rows = [r(), r({ lat: null, lng: null, locationSource: 'none' }), r({ excluded: true }), r({ datetime: null })];
    const sm = summariseRows(rows);
    expect(sm.total).toBe(4);
    expect(sm.excluded).toBe(1);
    expect(sm.withGps).toBe(2);     // first and last (excluded one not counted)
    expect(sm.withoutGps).toBe(1);  // the one with null lat/lng
    expect(sm.withDatetime).toBe(2);
    expect(sm.ready).toBe(2);
  });

  it('handles an empty array', () => {
    const sm = summariseRows([]);
    expect(sm).toEqual({ total: 0, withGps: 0, withoutGps: 0, withDatetime: 0, ready: 0, excluded: 0 });
  });
});
