import { describe, it, expect } from 'vitest';
import { clampAndPad } from './bbox-crop';

describe('clampAndPad', () => {
  it('returns the bbox plus default 10% pad on each side', () => {
    const r = clampAndPad([100, 100, 300, 200], 1000, 1000);
    // bw=200, bh=100; pad=20, 10
    expect(r.x).toBe(80);
    expect(r.y).toBe(90);
    expect(r.w).toBe(240); // 320 - 80 ceil
    expect(r.h).toBe(120); // 210 - 90 ceil
  });

  it('clamps to image bounds at the top-left', () => {
    const r = clampAndPad([10, 10, 110, 110], 1000, 1000, 0.5);
    // pad=50,50 → ax1-50=-40 clamped to 0
    expect(r.x).toBe(0);
    expect(r.y).toBe(0);
  });

  it('clamps to image bounds at the bottom-right', () => {
    const r = clampAndPad([900, 900, 1000, 1000], 1000, 1000, 0.5);
    // pad=50,50 → ax2+50=1050 clamped to 1000
    expect(r.x + r.w).toBeLessThanOrEqual(1000);
    expect(r.y + r.h).toBeLessThanOrEqual(1000);
  });

  it('handles a zero-pad request (exact bbox)', () => {
    const r = clampAndPad([100, 200, 300, 400], 1000, 1000, 0);
    expect(r.x).toBe(100);
    expect(r.y).toBe(200);
    expect(r.w).toBe(200);
    expect(r.h).toBe(200);
  });

  it('normalises a flipped bbox (x2 < x1, y2 < y1)', () => {
    const r = clampAndPad([300, 200, 100, 50], 1000, 1000, 0);
    expect(r.x).toBe(100);
    expect(r.y).toBe(50);
    expect(r.w).toBe(200);
    expect(r.h).toBe(150);
  });

  it('returns at minimum 1×1 when the bbox degenerates', () => {
    const r = clampAndPad([500, 500, 500, 500], 1000, 1000, 0);
    expect(r.w).toBeGreaterThanOrEqual(1);
    expect(r.h).toBeGreaterThanOrEqual(1);
  });

  it('respects custom pad fraction', () => {
    const r = clampAndPad([100, 100, 200, 200], 1000, 1000, 0.25);
    // bw=100, pad=25 → x1=75, x2=225 → w=150
    expect(r.x).toBe(75);
    expect(r.w).toBe(150);
  });
});
