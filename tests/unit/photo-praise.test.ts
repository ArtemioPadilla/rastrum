import { describe, it, expect } from 'vitest';
import { pickPraise, taxonPraiseI18nPath, type TaxonGroup } from '../../src/lib/photo-praise';

// ── Existing agnostic tests (regression) ─────────────────────────────

describe('pickPraise — agnostic (no taxonGroup)', () => {
  it('returns null when EXIF is null', () => expect(pickPraise(null)).toBeNull());
  it('returns null when EXIF is undefined', () => expect(pickPraise(undefined)).toBeNull());
  it('returns null when EXIF is empty', () => expect(pickPraise({})).toBeNull());
  it('returns null for non-numeric values', () => expect(pickPraise({ ISO: 'auto', FNumber: null })).toBeNull());

  it('good_light: ISO < 400', () => {
    expect(pickPraise({ ISO: 100 })).toBe('good_light');
    expect(pickPraise({ ISO: 399 })).toBe('good_light');
  });
  it('balanced_exposure: 400 ≤ ISO < 800', () => {
    expect(pickPraise({ ISO: 400 })).toBe('balanced_exposure');
    expect(pickPraise({ ISO: 640 })).toBe('balanced_exposure');
  });
  it('null for high ISO', () => {
    expect(pickPraise({ ISO: 800 })).toBeNull();
    expect(pickPraise({ ISO: 3200 })).toBeNull();
  });
  it('portrait_aperture: FNumber ≤ 2.8', () => {
    expect(pickPraise({ FNumber: 1.4 })).toBe('portrait_aperture');
    expect(pickPraise({ FNumber: 2.8 })).toBe('portrait_aperture');
  });
  it('sharp_action: ExposureTime ≤ 1/500', () => {
    expect(pickPraise({ ExposureTime: 1 / 1000 })).toBe('sharp_action');
    expect(pickPraise({ ExposureTime: 1 / 500 })).toBe('sharp_action');
  });
  it('long_lens: FocalLength ≥ 200', () => {
    expect(pickPraise({ FocalLength: 200 })).toBe('long_lens');
    expect(pickPraise({ FocalLength: 600 })).toBe('long_lens');
  });
  it('priority: sharp_action > portrait_aperture', () => {
    expect(pickPraise({ ExposureTime: 1 / 1000, FNumber: 1.8 })).toBe('sharp_action');
  });
  it('priority: portrait_aperture > long_lens', () => {
    expect(pickPraise({ FNumber: 2.8, FocalLength: 400 })).toBe('portrait_aperture');
  });
  it('priority: long_lens > good_light', () => {
    expect(pickPraise({ FocalLength: 300, ISO: 100 })).toBe('long_lens');
  });
  it('rejects zero/negative noise', () => {
    expect(pickPraise({ ISO: 0, FNumber: 0, ExposureTime: 0, FocalLength: 0 })).toBeNull();
  });
});

// ── Taxon-aware: pickPraise returns the same key regardless of taxon ──

describe('pickPraise — taxon-aware (same key, taxon group ignored in key selection)', () => {
  const exif = { ISO: 100 };
  const groups: TaxonGroup[] = ['bird', 'mammal', 'reptile', 'amphibian', 'plant', 'fungus'];

  for (const group of groups) {
    it(`returns good_light for ${group} (same key as agnostic)`, () => {
      expect(pickPraise(exif, group)).toBe('good_light');
    });
  }

  it('returns null when EXIF is null regardless of taxonGroup', () => {
    expect(pickPraise(null, 'bird')).toBeNull();
  });

  it('returns same key for unknown taxon group', () => {
    expect(pickPraise({ ExposureTime: 1 / 1000 }, 'unknown_taxon')).toBe('sharp_action');
  });

  it('returns null for empty EXIF regardless of taxon group', () => {
    expect(pickPraise({}, 'plant')).toBeNull();
  });
});

// ── taxonPraiseI18nPath ───────────────────────────────────────────────

describe('taxonPraiseI18nPath', () => {
  it('returns correct path for known group', () => {
    expect(taxonPraiseI18nPath('good_light', 'bird')).toBe('photo_praise.good_light.bird');
    expect(taxonPraiseI18nPath('long_lens', 'fungus')).toBe('photo_praise.long_lens.fungus');
  });

  it('returns null for unknown taxon group', () => {
    expect(taxonPraiseI18nPath('good_light', 'insect')).toBeNull();
    expect(taxonPraiseI18nPath('good_light', '')).toBeNull();
  });

  it('returns null when taxonGroup is null', () => {
    expect(taxonPraiseI18nPath('good_light', null)).toBeNull();
  });

  it('returns null when taxonGroup is undefined', () => {
    expect(taxonPraiseI18nPath('good_light', undefined)).toBeNull();
  });

  it('covers all 6 taxon groups', () => {
    const groups: TaxonGroup[] = ['bird', 'mammal', 'reptile', 'amphibian', 'plant', 'fungus'];
    for (const g of groups) {
      expect(taxonPraiseI18nPath('sharp_action', g)).toBe(`photo_praise.sharp_action.${g}`);
    }
  });
});

// ── Fallback to agnostic copy ─────────────────────────────────────────

describe('pickPraise — fallback agnostic when cascade fails/no taxon', () => {
  it('still returns key when taxon is null (agnostic fallback)', () => {
    expect(pickPraise({ ISO: 200 }, null)).toBe('good_light');
  });

  it('still returns key when taxon is undefined (agnostic fallback)', () => {
    expect(pickPraise({ ISO: 200 })).toBe('good_light');
  });
});
