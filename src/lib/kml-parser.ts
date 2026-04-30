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
/** Maximum size for KMZ files (ZIP-compressed KML). 5MB = MAX_KML_BYTES * 10. */
const MAX_KMZ_BYTES = 5_000_000;

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

// ── KMZ support ────────────────────────────────────────────────────────────

/**
 * Extract the KML text from a KMZ file (ZIP archive containing doc.kml).
 * Uses JSZip (dynamically imported to keep the bundle lazy).
 *
 * @param file - A File or Blob with .kmz extension or application/vnd.google-earth.kmz MIME type
 * @returns The KML text content, or null if no .kml file found inside the archive
 */
export async function extractKMLFromKMZ(file: File | Blob): Promise<string | null> {
  // Dynamic import so JSZip is only loaded when a KMZ is actually uploaded
  const JSZip = (await import('jszip')).default;
  const zip = await JSZip.loadAsync(file);

  // KMZ spec: primary document is doc.kml; fall back to first .kml file found
  const docKml = zip.file('doc.kml');
  const kmlFile = docKml ?? Object.values(zip.files).find(f => f.name.endsWith('.kml') && !f.dir);

  if (!kmlFile) return null;
  return kmlFile.async('string');
}

/** Returns true if the file is a KMZ (by extension or MIME type).
 * Note: `application/zip` is guarded by extension check to avoid false positives
 * (iOS/Android sometimes report .kmz files as application/zip). */
export function isKMZ(file: File): boolean {
  const name = file.name.toLowerCase();
  return (
    name.endsWith('.kmz') ||
    file.type === 'application/vnd.google-earth.kmz' ||
    // application/zip only counts if the extension is .kmz (iOS/Android quirk)
    (file.type === 'application/zip' && name.endsWith('.kmz'))
  );
}

/**
 * Validate a KML or KMZ file. Handles both formats transparently.
 * For KMZ, extracts doc.kml first, then validates the KML content.
 */
export async function validateKMLOrKMZ(file: File): Promise<KMLValidationResult> {
  if (file.size > MAX_KMZ_BYTES) {
    // KMZ can be larger than 500KB when compressed; limit to 5MB for KMZ
    return { ok: false, error: 'too_large' };
  }

  let text: string;
  if (isKMZ(file)) {
    const extracted = await extractKMLFromKMZ(file);
    if (!extracted) return { ok: false, error: 'no_polygon' };
    text = extracted;
  } else {
    text = await file.text();
  }

  return validateKML(text);
}
