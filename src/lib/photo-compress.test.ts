import { describe, it, expect } from 'vitest';
import { computeScale, isImageFile, compressIfLarge, DEFAULT_MAX_MP } from './photo-compress';

describe('computeScale', () => {
  it('returns 1 when pixels exactly equal the maxMP budget (no resize)', () => {
    // 2000 × 2000 = 4 000 000 = exactly 4 MP
    expect(computeScale(2000, 2000, 4)).toBe(1);
  });

  it('returns 0.5 when the image is 4× the budget', () => {
    // 4000 × 4000 = 16 MP, budget = 4 MP, so scale = sqrt(0.25) = 0.5
    expect(computeScale(4000, 4000, 4)).toBeCloseTo(0.5, 5);
  });

  it('returns 1 when the image is already small', () => {
    expect(computeScale(800, 600, 4)).toBe(1);
  });

  it('handles zero / negative / NaN dimensions defensively', () => {
    expect(computeScale(0, 100, 4)).toBe(1);
    expect(computeScale(-1, 100, 4)).toBe(1);
    expect(computeScale(NaN, 100, 4)).toBe(1);
  });

  it('handles invalid maxMP defensively', () => {
    expect(computeScale(4000, 4000, 0)).toBe(1);
    expect(computeScale(4000, 4000, -2)).toBe(1);
    expect(computeScale(4000, 4000, NaN)).toBe(1);
  });

  it('uses DEFAULT_MAX_MP when omitted', () => {
    expect(DEFAULT_MAX_MP).toBe(4);
    // default of 4 MP — 4000×4000 = 16 MP → scale 0.5
    expect(computeScale(4000, 4000)).toBeCloseTo(0.5, 5);
  });
});

describe('isImageFile', () => {
  it('returns true for image/* MIME types', () => {
    expect(isImageFile(new File([], 'a.jpg', { type: 'image/jpeg' }))).toBe(true);
    expect(isImageFile(new File([], 'a.png', { type: 'image/png' }))).toBe(true);
  });

  it('returns false for non-image MIME types', () => {
    expect(isImageFile(new File([], 'a.mp4', { type: 'video/mp4' }))).toBe(false);
    expect(isImageFile(new File([], 'a.bin', { type: '' }))).toBe(false);
  });
});

describe('compressIfLarge', () => {
  it('rejects non-File inputs', async () => {
    await expect(compressIfLarge('not a file' as unknown as File)).rejects.toThrow(/File/);
  });

  it('rejects non-image File inputs', async () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'x.mp4', { type: 'video/mp4' });
    await expect(compressIfLarge(f)).rejects.toThrow(/image/);
  });

  it('returns the original File when createImageBitmap is unavailable', async () => {
    // happy-dom doesn't ship createImageBitmap by default — this path is
    // a graceful no-op, which is what we want for older browsers / SSR.
    const f = new File([new Uint8Array([1, 2, 3])], 'tiny.jpg', { type: 'image/jpeg' });
    const out = await compressIfLarge(f);
    expect(out.file).toBe(f);
    expect(out.resized).toBe(false);
  });
});
