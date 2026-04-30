/**
 * kml-parser.ts — Client-side KML polygon parser for Rastrum project boundaries.
 * Parses KML files (standard format from CONABIO, CONANP, Google Earth) into GeoJSON.
 *
 * Coordinate order: KML uses "lon,lat,alt" tuples — GeoJSON also uses [lon,lat].
 * Do NOT swap the order here; the values are already correct as-is.
 */

export type KMLGeoJSON = { type: 'Polygon'; coordinates: number[][][] };

export type KMLValidationResult =
  | { ok: true; geojson: KMLGeoJSON; vertexCount: number; name?: string; hadMultiGeometry?: boolean }
  | { ok: false; error: 'no_polygon' | 'too_large' | 'invalid_xml' };

const MAX_KML_BYTES = 500_000;

/**
 * Parse the first (or largest) polygon found in a KML string into GeoJSON.
 *
 * Handles:
 * - Simple <Polygon> placemarks (most common)
 * - <MultiGeometry> with multiple polygons (common in CONABIO/CONANP exports)
 *   → selects the polygon with the most vertices and warns the caller via hadMultiGeometry
 *
 * KML coordinate format: "lon,lat,alt" space-separated tuples.
 * GeoJSON format: [[lon, lat], ...] — same order, altitude dropped.
 */
export function parseKML(text: string): { geojson: KMLGeoJSON; hadMultiGeometry: boolean } | null {
  const doc = new DOMParser().parseFromString(text, 'text/xml');
  if (doc.querySelector('parsererror')) return null;

  const allPolygons = Array.from(doc.querySelectorAll('Polygon'));
  if (allPolygons.length === 0) return null;

  const hadMultiGeometry =
    allPolygons.length > 1 ||
    doc.querySelector('MultiGeometry') !== null;

  // For MultiGeometry: pick the polygon with the most vertices (largest area proxy)
  let bestCoordEl: Element | null = null;
  let bestCount = 0;
  for (const poly of allPolygons) {
    const coordsEl =
      poly.querySelector('outerBoundaryIs LinearRing coordinates') ??
      poly.querySelector('LinearRing coordinates') ??
      poly.querySelector('coordinates');
    if (!coordsEl?.textContent) continue;
    const count = coordsEl.textContent.trim().split(/\s+/).length;
    if (count > bestCount) {
      bestCount = count;
      bestCoordEl = coordsEl;
    }
  }

  if (!bestCoordEl?.textContent) return null;

  const pairs = bestCoordEl.textContent
    .trim()
    .split(/\s+/)
    .filter(Boolean)
    .map(pair => {
      const parts = pair.split(',').map(Number);
      // KML: lon,lat,alt → GeoJSON: [lon, lat] (same order, drop altitude)
      return [parts[0], parts[1]] as [number, number];
    })
    .filter(([lon, lat]) => !isNaN(lon) && !isNaN(lat));

  if (pairs.length < 3) return null;

  return {
    geojson: { type: 'Polygon', coordinates: [pairs] },
    hadMultiGeometry,
  };
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
    const result = parseKML(text);
    if (!result) return { ok: false, error: 'no_polygon' };
    const { geojson, hadMultiGeometry } = result;
    const vertexCount = geojson.coordinates[0].length;
    const name = extractKMLName(text);
    return { ok: true, geojson, vertexCount, name, hadMultiGeometry };
  } catch {
    return { ok: false, error: 'invalid_xml' };
  }
}
