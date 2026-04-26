/**
 * Batch photo importer helpers — see docs/specs/modules/19-batch-photo-importer.md.
 *
 * The page (BatchImporter.astro) reads many JPEG/HEIC files at once,
 * extracts EXIF GPS + datetime per file, lets the user edit each row,
 * and then calls saveObservationToOutbox() once per row. This module
 * holds the pure (testable) helpers — no DOM, no Dexie. The Astro
 * component owns all rendering and Dexie writes.
 */
import type { EvidenceType, HabitatType, WeatherTag } from './types';

/**
 * Normalised, editable row backing a single about-to-be-imported photo.
 * `lat`/`lng` are nullable because EXIF may be missing — the UI flags
 * those rows so the user can fix them before import.
 */
export interface BatchRow {
  /** Stable id. UUID v4 from the importer. */
  id: string;
  fileName: string;
  fileSize: number;
  mimeType: string;
  /** Live thumbnail object URL — UI manages the lifecycle. */
  thumbUrl?: string;
  lat: number | null;
  lng: number | null;
  altitudeM: number | null;
  /** Source of the lat/lng decision. `manual` means the user typed it in. */
  locationSource: 'exif' | 'manual' | 'bulk' | 'none';
  /** ISO 8601 datetime, when known. EXIF datetimes are converted to UTC. */
  datetime: string | null;
  habitat: HabitatType | null;
  weather: WeatherTag | null;
  evidenceType: EvidenceType;
  notes: string | null;
  /** UI flag — set by the user to skip this row at import. */
  excluded: boolean;
  /** "ready" once row has at least lat+lng+datetime. Computed on the fly. */
}

/**
 * EXIF result shape we consume — a thin subset of what `exifr` returns.
 * Tests can pass a hand-rolled object without needing to mock the lib.
 */
export interface ExifSummary {
  /** Decimal degrees. */
  latitude?: number | null;
  /** Decimal degrees. */
  longitude?: number | null;
  /** Metres. */
  GPSAltitude?: number | null;
  /** A Date object, ms epoch number, or ISO string. */
  DateTimeOriginal?: Date | number | string | null;
  /** Some cameras only set CreateDate. */
  CreateDate?: Date | number | string | null;
  /** Last fallback. */
  ModifyDate?: Date | number | string | null;
}

function asIso(v: unknown): string | null {
  if (v == null) return null;
  if (v instanceof Date) {
    const t = v.getTime();
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  if (typeof v === 'number' && Number.isFinite(v)) {
    return new Date(v).toISOString();
  }
  if (typeof v === 'string' && v.trim().length > 0) {
    // Accept either ISO or the EXIF "YYYY:MM:DD HH:MM:SS" form.
    const exifLike = /^(\d{4}):(\d{2}):(\d{2})[ T](\d{2}):(\d{2}):(\d{2})/;
    const m = v.match(exifLike);
    let s = v;
    if (m) s = `${m[1]}-${m[2]}-${m[3]}T${m[4]}:${m[5]}:${m[6]}`;
    const t = Date.parse(s);
    return Number.isFinite(t) ? new Date(t).toISOString() : null;
  }
  return null;
}

/** Coerce a number-ish to a finite number or null. */
function asNum(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  if (typeof v === 'string' && v.trim() !== '') {
    const n = Number(v);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

/**
 * Build a fresh BatchRow from a file + (possibly empty) EXIF summary.
 * Pure: the only side effect is reading the file's name/size/type.
 */
export function buildBatchRow(
  file: { name: string; size: number; type: string },
  exif: ExifSummary | null | undefined,
  opts: { id?: string; defaultEvidenceType?: EvidenceType } = {},
): BatchRow {
  const lat = asNum(exif?.latitude ?? null);
  const lng = asNum(exif?.longitude ?? null);
  const altitudeM = asNum(exif?.GPSAltitude ?? null);
  const datetime =
    asIso(exif?.DateTimeOriginal) ??
    asIso(exif?.CreateDate) ??
    asIso(exif?.ModifyDate);

  return {
    id: opts.id ?? (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : Math.random().toString(36).slice(2)),
    fileName: file.name,
    fileSize: file.size,
    mimeType: file.type || 'image/jpeg',
    lat: lat,
    lng: lng,
    altitudeM,
    locationSource: lat != null && lng != null ? 'exif' : 'none',
    datetime,
    habitat: null,
    weather: null,
    evidenceType: opts.defaultEvidenceType ?? 'direct_sighting',
    notes: null,
    excluded: false,
  };
}

/**
 * The fields the user can bulk-set across all rows.
 * Any property left undefined is left untouched on every row.
 * `null` is a real value (clear the field).
 */
export interface BulkSetPatch {
  habitat?: HabitatType | null;
  weather?: WeatherTag | null;
  evidenceType?: EvidenceType;
  notes?: string | null;
  /**
   * For camera-trap importer — apply ONE GPS to every row, regardless of
   * what EXIF said. UI exposes this only on the camera-trap page.
   */
  location?: { lat: number; lng: number; altitudeM?: number | null } | null;
}

/**
 * Merge a bulk patch into every row that isn't excluded. Returns a new
 * array — does not mutate the input.
 */
export function applyBulkSet(rows: ReadonlyArray<BatchRow>, patch: BulkSetPatch): BatchRow[] {
  return rows.map((row) => {
    if (row.excluded) return row;
    const next: BatchRow = { ...row };
    if (Object.prototype.hasOwnProperty.call(patch, 'habitat')) {
      next.habitat = patch.habitat ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'weather')) {
      next.weather = patch.weather ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'evidenceType') && patch.evidenceType) {
      next.evidenceType = patch.evidenceType;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'notes')) {
      next.notes = patch.notes ?? null;
    }
    if (Object.prototype.hasOwnProperty.call(patch, 'location')) {
      const loc = patch.location;
      if (loc) {
        next.lat = loc.lat;
        next.lng = loc.lng;
        next.altitudeM = loc.altitudeM ?? null;
        next.locationSource = 'bulk';
      } else {
        next.lat = null;
        next.lng = null;
        next.altitudeM = null;
        next.locationSource = 'none';
      }
    }
    return next;
  });
}

/** Returns true when a row has the minimum needed to be imported. */
export function isRowReady(row: BatchRow): boolean {
  if (row.excluded) return false;
  if (row.lat == null || row.lng == null) return false;
  if (!Number.isFinite(row.lat) || !Number.isFinite(row.lng)) return false;
  if (row.lat < -90 || row.lat > 90) return false;
  if (row.lng < -180 || row.lng > 180) return false;
  return true;
}

/** Aggregate counts for the importer header. */
export function summariseRows(rows: ReadonlyArray<BatchRow>): {
  total: number;
  withGps: number;
  withoutGps: number;
  withDatetime: number;
  ready: number;
  excluded: number;
} {
  let withGps = 0;
  let withDatetime = 0;
  let ready = 0;
  let excluded = 0;
  for (const r of rows) {
    if (r.excluded) { excluded++; continue; }
    if (r.lat != null && r.lng != null) withGps++;
    if (r.datetime) withDatetime++;
    if (isRowReady(r)) ready++;
  }
  return {
    total: rows.length,
    withGps,
    withoutGps: rows.length - excluded - withGps,
    withDatetime,
    ready,
    excluded,
  };
}
