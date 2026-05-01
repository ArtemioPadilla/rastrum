import { describe, it, expect } from 'vitest';
import { parseKML, extractKMLName, validateKML, isKMZ } from './kml-parser';

const SIMPLE_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>Test Zone</name>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>-96.72,17.06,0 -96.70,17.06,0 -96.70,17.08,0 -96.72,17.08,0 -96.72,17.06,0</coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>
</kml>`;

const NO_POLYGON_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>Just a Point</name>
    <Point><coordinates>-96.72,17.06,0</coordinates></Point>
  </Placemark>
</kml>`;

const FEW_COORDS_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <Polygon>
      <outerBoundaryIs>
        <LinearRing>
          <coordinates>-96.72,17.06,0 -96.70,17.06,0</coordinates>
        </LinearRing>
      </outerBoundaryIs>
    </Polygon>
  </Placemark>
</kml>`;

const MALFORMED_XML = `<?xml version="1.0"?>
<kml><Polygon><unclosed`;

const NAMED_DOCUMENT_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Document>
    <name>Sierra Juárez</name>
    <Placemark>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>-96.72,17.06,0 -96.70,17.06,0 -96.70,17.08,0 -96.72,17.08,0 -96.72,17.06,0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </Placemark>
  </Document>
</kml>`;

// MultiGeometry: two polygons — second one has more vertices (should be selected)
const MULTI_GEOMETRY_KML = `<?xml version="1.0" encoding="UTF-8"?>
<kml xmlns="http://www.opengis.net/kml/2.2">
  <Placemark>
    <name>Sierra Norte</name>
    <MultiGeometry>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>-96.70,17.06,0 -96.69,17.06,0 -96.69,17.07,0 -96.70,17.06,0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
      <Polygon>
        <outerBoundaryIs>
          <LinearRing>
            <coordinates>-96.72,17.06,0 -96.70,17.06,0 -96.70,17.08,0 -96.72,17.08,0 -96.71,17.09,0 -96.72,17.06,0</coordinates>
          </LinearRing>
        </outerBoundaryIs>
      </Polygon>
    </MultiGeometry>
  </Placemark>
</kml>`;

describe('parseKML', () => {
  it('returns a GeoJSON Polygon and hadMultiGeometry=false for a simple KML', () => {
    const result = parseKML(SIMPLE_KML);
    expect(result).not.toBeNull();
    expect(result?.geojson.type).toBe('Polygon');
    expect(result?.geojson.coordinates[0]).toHaveLength(5);
    expect(result?.hadMultiGeometry).toBe(false);
  });

  it('returns [lon, lat] pairs (no axis swap needed)', () => {
    const result = parseKML(SIMPLE_KML);
    // First coord in KML: -96.72,17.06  → [lon=-96.72, lat=17.06]
    expect(result?.geojson.coordinates[0][0]).toEqual([-96.72, 17.06]);
  });

  it('returns null when no Polygon element present', () => {
    expect(parseKML(NO_POLYGON_KML)).toBeNull();
  });

  it('returns null when fewer than 3 coordinate pairs', () => {
    expect(parseKML(FEW_COORDS_KML)).toBeNull();
  });

  it('returns null for malformed XML', () => {
    expect(parseKML(MALFORMED_XML)).toBeNull();
  });

  it('handles MultiGeometry: picks the polygon with most vertices, sets hadMultiGeometry=true', () => {
    const result = parseKML(MULTI_GEOMETRY_KML);
    expect(result).not.toBeNull();
    expect(result?.hadMultiGeometry).toBe(true);
    // The larger polygon (6 vertices) should be selected over the smaller (4 vertices)
    expect(result?.geojson.coordinates[0]).toHaveLength(6);
  });
});

describe('extractKMLName', () => {
  it('returns the Placemark name', () => {
    expect(extractKMLName(SIMPLE_KML)).toBe('Test Zone');
  });

  it('falls back to Document name if no Placemark name', () => {
    expect(extractKMLName(NAMED_DOCUMENT_KML)).toBe('Sierra Juárez');
  });

  it('returns undefined if no name element', () => {
    expect(extractKMLName(FEW_COORDS_KML)).toBeUndefined();
  });
});

describe('validateKML', () => {
  it('returns ok:true with geojson, vertexCount, name, hadMultiGeometry for valid KML', () => {
    const result = validateKML(SIMPLE_KML);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.geojson.type).toBe('Polygon');
      expect(result.vertexCount).toBe(5);
      expect(result.name).toBe('Test Zone');
      expect(result.hadMultiGeometry).toBe(false);
    }
  });

  it('returns ok:true with hadMultiGeometry=true for MultiGeometry KML', () => {
    const result = validateKML(MULTI_GEOMETRY_KML);
    expect(result.ok).toBe(true);
    if (result.ok) {
      expect(result.hadMultiGeometry).toBe(true);
      expect(result.vertexCount).toBe(6); // largest polygon selected
    }
  });

  it('returns error:too_large for KML exceeding 500 KB', () => {
    const bigKml = 'x'.repeat(500_001);
    const result = validateKML(bigKml);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('too_large');
  });

  it('returns error:no_polygon when KML has no Polygon element', () => {
    const result = validateKML(NO_POLYGON_KML);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no_polygon');
  });

  it('returns error:no_polygon for malformed XML (DOMParser parseerror)', () => {
    const result = validateKML(MALFORMED_XML);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(['no_polygon', 'invalid_xml']).toContain(result.error);
  });

  it('returns error:no_polygon when coordinate pairs are fewer than 3', () => {
    const result = validateKML(FEW_COORDS_KML);
    expect(result.ok).toBe(false);
    if (!result.ok) expect(result.error).toBe('no_polygon');
  });
});

describe('isKMZ', () => {
  it('detects .kmz extension', () => {
    expect(isKMZ({ name: 'zona.kmz', type: '', size: 100 } as unknown as File)).toBe(true);
    expect(isKMZ({ name: 'zona.kml', type: '', size: 100 } as unknown as File)).toBe(false);
  });

  it('detects kmz MIME type', () => {
    expect(isKMZ({ name: 'f', type: 'application/vnd.google-earth.kmz', size: 100 } as unknown as File)).toBe(true);
  });
});
