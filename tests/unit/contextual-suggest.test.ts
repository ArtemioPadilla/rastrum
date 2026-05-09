import { describe, it, expect } from 'vitest';
import {
  isValidLatLng,
  isValidMonth,
  clampLimit,
  pickCommonName,
  formatDistancePill,
  suggestCacheKey,
} from '../../src/lib/contextual-suggest';

describe('contextual-suggest — isValidLatLng', () => {
  it('accepts in-range coords', () => {
    expect(isValidLatLng(19.43, -99.13)).toBe(true);
    expect(isValidLatLng(-90, 180)).toBe(true);
    expect(isValidLatLng(90, -180)).toBe(true);
  });

  it('rejects null island (0,0)', () => {
    expect(isValidLatLng(0, 0)).toBe(false);
  });

  it('rejects out-of-range', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });

  it('rejects non-finite', () => {
    expect(isValidLatLng(NaN, 0)).toBe(false);
    expect(isValidLatLng(0, Infinity)).toBe(false);
  });
});

describe('contextual-suggest — isValidMonth', () => {
  it('accepts 1..12', () => {
    for (let m = 1; m <= 12; m++) expect(isValidMonth(m)).toBe(true);
  });

  it('rejects 0, 13, fractional, negative, NaN', () => {
    expect(isValidMonth(0)).toBe(false);
    expect(isValidMonth(13)).toBe(false);
    expect(isValidMonth(2.5)).toBe(false);
    expect(isValidMonth(-1)).toBe(false);
    expect(isValidMonth(NaN)).toBe(false);
  });
});

describe('contextual-suggest — clampLimit', () => {
  it('defaults to 10 for null/undef/non-positive', () => {
    expect(clampLimit(undefined)).toBe(10);
    expect(clampLimit(0)).toBe(10);
    expect(clampLimit(-5)).toBe(10);
  });

  it('clamps to 50 max', () => {
    expect(clampLimit(100)).toBe(50);
    expect(clampLimit(51)).toBe(50);
  });

  it('passes valid values through', () => {
    expect(clampLimit(5)).toBe(5);
    expect(clampLimit(20)).toBe(20);
  });

  it('floors fractional values', () => {
    expect(clampLimit(7.9)).toBe(7);
  });

  it('handles NaN/Infinity', () => {
    expect(clampLimit(NaN)).toBe(10);
    expect(clampLimit(Infinity)).toBe(10);
  });
});

describe('contextual-suggest — pickCommonName', () => {
  const taxon = {
    scientific_name: 'Danaus plexippus',
    common_name_es: 'Mariposa monarca',
    common_name_en: 'Monarch butterfly',
  };

  it('picks Spanish common name when lang=es', () => {
    expect(pickCommonName(taxon, 'es')).toBe('Mariposa monarca');
  });

  it('picks English common name when lang=en', () => {
    expect(pickCommonName(taxon, 'en')).toBe('Monarch butterfly');
  });

  it('falls back to other locale when primary is null', () => {
    expect(pickCommonName({ ...taxon, common_name_es: null }, 'es')).toBe('Monarch butterfly');
    expect(pickCommonName({ ...taxon, common_name_en: null }, 'en')).toBe('Mariposa monarca');
  });

  it('falls back to scientific name when both are null', () => {
    expect(pickCommonName({
      scientific_name: 'Tlaconete',
      common_name_es: null,
      common_name_en: null,
    }, 'es')).toBe('Tlaconete');
  });

  it('trims trailing whitespace', () => {
    expect(pickCommonName({
      scientific_name: 'X',
      common_name_es: '  Mariposa  ',
      common_name_en: null,
    }, 'es')).toBe('Mariposa');
  });
});

describe('contextual-suggest — formatDistancePill', () => {
  it('returns "<1 km" for sub-kilometre distances', () => {
    expect(formatDistancePill(0.4, 'en')).toBe('<1 km');
    expect(formatDistancePill(0.0, 'es')).toBe('<1 km');
  });

  it('uses one decimal in 1..10 km range', () => {
    expect(formatDistancePill(2.34, 'en')).toBe('2.3 km');
    expect(formatDistancePill(9.5, 'es')).toBe('9.5 km');
  });

  it('rounds to integer above 10 km', () => {
    expect(formatDistancePill(15.4, 'en')).toBe('15 km');
    expect(formatDistancePill(49.6, 'es')).toBe('50 km');
  });

  it('returns empty string for null / negative / non-finite', () => {
    expect(formatDistancePill(null, 'en')).toBe('');
    expect(formatDistancePill(-1, 'en')).toBe('');
    expect(formatDistancePill(NaN, 'en')).toBe('');
  });
});

describe('contextual-suggest — suggestCacheKey', () => {
  it('quantises coords to ~1 km buckets', () => {
    const a = suggestCacheKey({ lat: 19.4326, lng: -99.1332, month: 5 });
    const b = suggestCacheKey({ lat: 19.4327, lng: -99.1331, month: 5 });
    expect(a).toBe(b);
  });

  it('differs by month', () => {
    const may = suggestCacheKey({ lat: 19.43, lng: -99.13, month: 5 });
    const jun = suggestCacheKey({ lat: 19.43, lng: -99.13, month: 6 });
    expect(may).not.toBe(jun);
  });

  it('differs by location bucket', () => {
    const cdmx = suggestCacheKey({ lat: 19.43, lng: -99.13, month: 5 });
    const oax  = suggestCacheKey({ lat: 17.07, lng: -96.72, month: 5 });
    expect(cdmx).not.toBe(oax);
  });

  it('produces stable namespaced keys', () => {
    const k = suggestCacheKey({ lat: 0.123, lng: -50.456, month: 7 });
    expect(k.startsWith('rastrum.suggest.')).toBe(true);
    expect(k).toContain('.7.');
  });
});
