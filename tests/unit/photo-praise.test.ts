import { describe, it, expect } from 'vitest';
import { pickPraise } from '../../src/lib/photo-praise';

describe('pickPraise', () => {
  it('returns null when EXIF is null', () => {
    expect(pickPraise(null)).toBeNull();
  });

  it('returns null when EXIF is undefined', () => {
    expect(pickPraise(undefined)).toBeNull();
  });

  it('returns null when EXIF is empty (no actionable camera tags)', () => {
    expect(pickPraise({})).toBeNull();
  });

  it('returns null when only non-numeric values are present', () => {
    expect(pickPraise({ ISO: 'auto', FNumber: null })).toBeNull();
  });

  it('returns "good_light" for low ISO (< 400)', () => {
    expect(pickPraise({ ISO: 100 })).toBe('good_light');
    expect(pickPraise({ ISO: 200 })).toBe('good_light');
    expect(pickPraise({ ISO: 399 })).toBe('good_light');
  });

  it('returns "balanced_exposure" for moderate ISO (400-799)', () => {
    expect(pickPraise({ ISO: 400 })).toBe('balanced_exposure');
    expect(pickPraise({ ISO: 640 })).toBe('balanced_exposure');
  });

  it('returns null for high ISO (no praise — do not lie)', () => {
    expect(pickPraise({ ISO: 800 })).toBeNull();
    expect(pickPraise({ ISO: 3200 })).toBeNull();
    expect(pickPraise({ ISO: 12800 })).toBeNull();
  });

  it('returns "portrait_aperture" for wide aperture (FNumber ≤ 2.8)', () => {
    expect(pickPraise({ FNumber: 1.4 })).toBe('portrait_aperture');
    expect(pickPraise({ FNumber: 2.8 })).toBe('portrait_aperture');
  });

  it('does not return portrait_aperture for narrow aperture', () => {
    expect(pickPraise({ FNumber: 5.6 })).toBeNull();
    expect(pickPraise({ FNumber: 11 })).toBeNull();
  });

  it('returns "sharp_action" for fast shutter (≤ 1/500s)', () => {
    expect(pickPraise({ ExposureTime: 1 / 1000 })).toBe('sharp_action');
    expect(pickPraise({ ExposureTime: 1 / 500 })).toBe('sharp_action');
  });

  it('does not return sharp_action for slow shutter', () => {
    expect(pickPraise({ ExposureTime: 1 / 60 })).toBeNull();
    expect(pickPraise({ ExposureTime: 0.5 })).toBeNull();
  });

  it('returns "long_lens" for telephoto (FocalLength ≥ 200mm)', () => {
    expect(pickPraise({ FocalLength: 200 })).toBe('long_lens');
    expect(pickPraise({ FocalLength: 600 })).toBe('long_lens');
  });

  it('does not return long_lens for short focal length', () => {
    expect(pickPraise({ FocalLength: 50 })).toBeNull();
    expect(pickPraise({ FocalLength: 100 })).toBeNull();
  });

  it('priority — sharp_action wins over portrait_aperture', () => {
    expect(pickPraise({ ExposureTime: 1 / 1000, FNumber: 1.8 })).toBe('sharp_action');
  });

  it('priority — portrait_aperture wins over long_lens', () => {
    expect(pickPraise({ FNumber: 2.8, FocalLength: 400 })).toBe('portrait_aperture');
  });

  it('priority — long_lens wins over good_light', () => {
    expect(pickPraise({ FocalLength: 300, ISO: 100 })).toBe('long_lens');
  });

  it('priority — good_light wins over balanced_exposure (only one fires anyway)', () => {
    expect(pickPraise({ ISO: 100 })).toBe('good_light');
    expect(pickPraise({ ISO: 500 })).toBe('balanced_exposure');
  });

  it('rejects zero/negative numeric noise', () => {
    expect(pickPraise({ ISO: 0, FNumber: 0, ExposureTime: 0, FocalLength: 0 })).toBeNull();
  });
});
