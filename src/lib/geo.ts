/**
 * geo.ts — shared geography utilities
 *
 * PostgREST returns geography columns as EWKB hex strings
 * (e.g. "0101000020E6100000..."). parseLocationToGeoJSON converts
 * that to a plain GeoJSON-compatible object with coordinates.
 */

/**
 * Parse a PostgREST geography value (EWKB hex or GeoJSON object)
 * into a {coordinates: [lng, lat]} pair, or null if invalid/missing.
 */
export function parseLocationToGeoJSON(
  raw: unknown,
): { coordinates: [number, number] } | null {
  if (!raw) return null;
  // Already a GeoJSON-like object
  if (typeof raw === 'object' && raw !== null && 'coordinates' in raw) {
    const r = raw as { coordinates?: [number, number] };
    return Array.isArray(r.coordinates) && r.coordinates.length >= 2
      ? (r as { coordinates: [number, number] })
      : null;
  }
  if (typeof raw !== 'string') return null;
  // EWKB hex: little-endian IEEE 754 doubles for coordinates.
  // Byte 0: byte order (01 = LE). Bytes 1-4: type flags (bit 0x20000000 = SRID present).
  // Then optionally 4 SRID bytes, then 8 bytes lng + 8 bytes lat.
  try {
    const hex = raw.replace(/\s/g, '');
    if (hex.length < 42) return null;
    const byteOrder = parseInt(hex.slice(0, 2), 16);
    if (byteOrder !== 1) return null; // only little-endian
    const typeHex = hex.slice(2, 10);
    const typeBytes = [0, 2, 4, 6].map(i => parseInt(typeHex.slice(i, i + 2), 16));
    const typeVal =
      typeBytes[0] | (typeBytes[1] << 8) | (typeBytes[2] << 16) | (typeBytes[3] << 24);
    const hasSrid = !!(typeVal & 0x20000000);
    const coordOffset = 10 + (hasSrid ? 8 : 0);
    if (hex.length < coordOffset + 32) return null;
    const readDoubleLE = (h: string, off: number): number => {
      const bytes = new Uint8Array(8);
      for (let i = 0; i < 8; i++) bytes[i] = parseInt(h.slice(off + i * 2, off + i * 2 + 2), 16);
      return new DataView(bytes.buffer).getFloat64(0, true);
    };
    const lng = readDoubleLE(hex, coordOffset);
    const lat = readDoubleLE(hex, coordOffset + 16);
    if (!isFinite(lng) || !isFinite(lat)) return null;
    return { coordinates: [lng, lat] };
  } catch {
    return null;
  }
}
