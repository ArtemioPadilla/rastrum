/**
 * kml-parser.ts — Client-side KML polygon parser for Rastrum project boundaries.
 * Parses KML files (standard format from CONABIO, CONANP, Google Earth) into GeoJSON.
 */

export type KMLGeoJSON = { type: 'Polygon'; coordinates: number[][][] };

export type KMLValidationResult =
  | { ok: true; geojson: KMLGeoJSON; vertexCount: number; name?: string }
  | { ok: false; error: 'no_polygon' | 'too_large' | 'invalid_xml' | 'empty' };

const MAX_KML_BYTES = 500_000;

/**
 * Parse the first polygon found in a KML string into GeoJSON.
 * KML coordinates are "lon,lat,alt" space-separated tuples.
 */
export function parseKML(text: string): KMLGeoJSON | null {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) return null;

  // Try outer boundary first, fall back to any coordinates element
  const coordsEl =
    doc.querySelector('Polygon outerBoundaryIs LinearRing coordinates') ??
    doc.querySelector('Polygon LinearRing coordinates') ??
    doc.querySelector('coordinates');
  if (!coordsEl?.textContent) return null;

  const pairs = coordsEl.textContent
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(pair => {
      const parts = pair.split(',').map(Number);
      return [parts[0], parts[1]] as [number, number];
    })
    .filter(([lon, lat]) => !isNaN(lon) && !isNaN(lat));

  if (pairs.length < 3) return null;

  return { type: 'Polygon', coordinates: [pairs] };
}

/** Extract the first placemark name from KML (for display). */
export function extractKMLName(text: string): string | undefined {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  const nameEl = doc.querySelector('Placemark > name') ?? doc.querySelector('Document > name');
  return nameEl?.textContent?.trim() || undefined;
}

/** Validate a KML text and return a typed result. */
export function validateKML(text: string): KMLValidationResult {
  if (text.length > MAX_KML_BYTES) return { ok: false, error: 'too_large' };
  try {
    const geojson = parseKML(text);
    if (!geojson) return { ok: false, error: 'no_polygon' };
    const vertexCount = geojson.coordinates[0].length;
    if (vertexCount < 3) return { ok: false, error: 'empty' };
    const name = extractKMLName(text);
    return { ok: true, geojson, vertexCount, name };
  } catch {
    return { ok: false, error: 'invalid_xml' };
  }
}
