import { describe, it, expect } from 'vitest';
import { validatePolygonGeoJSON, isValidSlug } from './projects';

describe('validatePolygonGeoJSON', () => {
  it('accepts a minimal Polygon with one closed linear ring', () => {
    const poly = {
      type: 'Polygon',
      coordinates: [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
    };
    expect(validatePolygonGeoJSON(poly)).toBe(poly);
  });

  it('accepts a MultiPolygon', () => {
    const mp = {
      type: 'MultiPolygon',
      coordinates: [
        [[[0, 0], [1, 0], [1, 1], [0, 1], [0, 0]]],
        [[[2, 2], [3, 2], [3, 3], [2, 3], [2, 2]]],
      ],
    };
    expect(validatePolygonGeoJSON(mp)).toBe(mp);
  });

  it('rejects non-objects, wrong types, and bad coordinates', () => {
    expect(validatePolygonGeoJSON(null)).toBeNull();
    expect(validatePolygonGeoJSON('Polygon')).toBeNull();
    expect(validatePolygonGeoJSON({ type: 'Point', coordinates: [0, 0] })).toBeNull();
    expect(validatePolygonGeoJSON({ type: 'Polygon', coordinates: [] })).toBeNull();
    expect(validatePolygonGeoJSON({ type: 'Polygon', coordinates: [[[0, 0], [1, 1]]] })).toBeNull();
    expect(validatePolygonGeoJSON({ type: 'MultiPolygon', coordinates: [[]] })).toBeNull();
  });
});

describe('isValidSlug', () => {
  it('accepts lowercase, digits, hyphens 2–64 chars starting with alnum', () => {
    expect(isValidSlug('anp-sierra-juarez')).toBe(true);
    expect(isValidSlug('proj01')).toBe(true);
    expect(isValidSlug('a1')).toBe(true);
  });

  it('rejects uppercase, leading hyphen, single char, spaces, too long', () => {
    expect(isValidSlug('ANP-Sierra')).toBe(false);
    expect(isValidSlug('-abc')).toBe(false);
    expect(isValidSlug('a')).toBe(false);
    expect(isValidSlug('has space')).toBe(false);
    expect(isValidSlug('x'.repeat(65))).toBe(false);
  });
});
