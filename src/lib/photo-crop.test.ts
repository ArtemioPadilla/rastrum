import { describe, it, expect } from 'vitest';
import { normalizeCropRect, rotatedDims, renameToJpeg, cropAndRotate } from './photo-crop';

describe('normalizeCropRect', () => {
  it('returns the rect untouched when valid', () => {
    expect(normalizeCropRect({ x: 10, y: 20, width: 100, height: 80 }, 200, 200))
      .toEqual({ x: 10, y: 20, width: 100, height: 80 });
  });

  it('clamps x/y to image bounds', () => {
    const r = normalizeCropRect({ x: -50, y: -10, width: 100, height: 80 }, 200, 200);
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('caps width/height so rect stays inside the image', () => {
    const r = normalizeCropRect({ x: 150, y: 150, width: 100, height: 100 }, 200, 200);
    expect(r.x).toBe(150);
    expect(r.y).toBe(150);
    expect(r.width).toBe(50);
    expect(r.height).toBe(50);
  });

  it('returns zero-area rect when image dims are invalid', () => {
    expect(normalizeCropRect({ x: 0, y: 0, width: 100, height: 100 }, 0, 100))
      .toEqual({ x: 0, y: 0, width: 0, height: 0 });
    expect(normalizeCropRect({ x: 0, y: 0, width: 100, height: 100 }, 100, NaN))
      .toEqual({ x: 0, y: 0, width: 0, height: 0 });
  });

  it('enforces min width/height of 1 when input is 0 or negative', () => {
    const r = normalizeCropRect({ x: 0, y: 0, width: 0, height: -5 }, 200, 200);
    expect(r.width).toBe(1);
    expect(r.height).toBe(1);
  });
});

describe('rotatedDims', () => {
  it('swaps w/h on 90° and 270°', () => {
    expect(rotatedDims(200, 100, 90)).toEqual({ w: 100, h: 200 });
    expect(rotatedDims(200, 100, 270)).toEqual({ w: 100, h: 200 });
  });

  it('preserves w/h on 0° and 180°', () => {
    expect(rotatedDims(200, 100, 0)).toEqual({ w: 200, h: 100 });
    expect(rotatedDims(200, 100, 180)).toEqual({ w: 200, h: 100 });
  });
});

describe('renameToJpeg', () => {
  it('replaces the extension', () => {
    expect(renameToJpeg('photo.heic')).toBe('photo.jpg');
    expect(renameToJpeg('image.PNG')).toBe('image.jpg');
  });

  it('appends .jpg when there is no extension', () => {
    expect(renameToJpeg('photo')).toBe('photo.jpg');
  });

  it('falls back to a default name on empty input', () => {
    expect(renameToJpeg('')).toBe('photo.jpg');
  });
});

describe('cropAndRotate', () => {
  it('rejects non-File inputs', async () => {
    await expect(cropAndRotate('not a file' as unknown as File, { rect: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0 }))
      .rejects.toThrow(/File/);
  });

  it('returns the original File when canvas APIs are unavailable', async () => {
    // happy-dom doesn't ship createImageBitmap by default — this path
    // is a graceful no-op for older browsers / SSR.
    const f = new File([new Uint8Array([1, 2, 3])], 'tiny.heic', { type: 'image/heic' });
    const out = await cropAndRotate(f, { rect: { x: 0, y: 0, width: 10, height: 10 }, rotation: 0 });
    expect(out).toBe(f);
  });
});
