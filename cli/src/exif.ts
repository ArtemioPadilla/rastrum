/**
 * EXIF extraction adapter — wraps `exifr` with the same property-name
 * fallback used by the browser pipeline (`ObservationForm.fillFromExif`)
 * so the CLI and the PWA share the same matrix of edge cases.
 */
import exifr from 'exifr';
import { readFile } from 'node:fs/promises';

const parseExif = exifr.parse.bind(exifr);

export interface ExifReading {
  /** Decimal degrees, WGS84. Null when EXIF has no usable GPS. */
  lat: number | null;
  lng: number | null;
  altitudeM: number | null;
  /** EXIF DateTimeOriginal as ISO-8601, or null. */
  capturedAtIso: string | null;
}

function pickNumber(...candidates: unknown[]): number | null {
  for (const c of candidates) {
    if (typeof c === 'number' && Number.isFinite(c)) return c;
  }
  return null;
}

export async function readExif(path: string): Promise<ExifReading> {
  const buf = await readFile(path);
  let exif: Record<string, unknown> | undefined;
  try {
    exif = await parseExif(buf, { gps: true, tiff: true, exif: true }) as Record<string, unknown> | undefined;
  } catch {
    return { lat: null, lng: null, altitudeM: null, capturedAtIso: null };
  }
  if (!exif) return { lat: null, lng: null, altitudeM: null, capturedAtIso: null };

  const lat = pickNumber(exif.latitude, exif.Latitude, exif.GPSLatitude);
  const lng = pickNumber(exif.longitude, exif.Longitude, exif.GPSLongitude);
  // Reject (0,0) only as a pair — same rule as the PWA fillFromExif.
  const gpsValid = lat !== null && lng !== null && !(lat === 0 && lng === 0);

  const dateRaw = exif.DateTimeOriginal ?? exif.dateTimeOriginal ?? exif.CreateDate ?? exif.createDate;
  let capturedAtIso: string | null = null;
  if (dateRaw instanceof Date && !Number.isNaN(dateRaw.getTime())) {
    capturedAtIso = dateRaw.toISOString();
  } else if (typeof dateRaw === 'string') {
    const d = new Date(dateRaw);
    if (!Number.isNaN(d.getTime())) capturedAtIso = d.toISOString();
  }

  return {
    lat: gpsValid ? lat : null,
    lng: gpsValid ? lng : null,
    altitudeM: pickNumber(exif.GPSAltitude, exif.altitude, exif.Altitude),
    capturedAtIso,
  };
}
