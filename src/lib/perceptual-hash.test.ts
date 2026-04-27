import { describe, it, expect } from 'vitest';
import { dHashFromGrayscale, hammingDistance, hashFile } from './perceptual-hash';

/** A 9×8 buffer with a smooth left→right gradient. Adjacent pixels never
 *  satisfy left > right, so every bit is 0 → hex 0000000000000000. */
function gradient(): Uint8Array {
  const buf = new Uint8Array(72);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      buf[y * 9 + x] = x * 30;       // strictly increasing per row
    }
  }
  return buf;
}

/** A 9×8 buffer with a reverse gradient — adjacent: left > right always.
 *  Every bit becomes 1 → hex ffffffffffffffff. */
function reverseGradient(): Uint8Array {
  const buf = new Uint8Array(72);
  for (let y = 0; y < 8; y++) {
    for (let x = 0; x < 9; x++) {
      buf[y * 9 + x] = 240 - x * 30; // strictly decreasing per row
    }
  }
  return buf;
}

describe('dHashFromGrayscale', () => {
  it('produces all-zero hash for a left→right gradient (no left>right anywhere)', () => {
    expect(dHashFromGrayscale(gradient())).toBe('0000000000000000');
  });

  it('produces all-ones hash for a right→left gradient', () => {
    expect(dHashFromGrayscale(reverseGradient())).toBe('ffffffffffffffff');
  });

  it('throws on a buffer of the wrong length', () => {
    expect(() => dHashFromGrayscale(new Uint8Array(70))).toThrow(/expected length 72/);
  });
});

describe('hammingDistance', () => {
  it('returns 0 for identical hashes', () => {
    const g = dHashFromGrayscale(gradient());
    expect(hammingDistance(g, g)).toBe(0);
  });

  it('returns 1 when one bit differs (off-by-1)', () => {
    // 0000000000000000 vs 0000000000000001 — single bit flipped in last nibble.
    expect(hammingDistance('0000000000000000', '0000000000000001')).toBe(1);
  });

  it('returns 3 when three bits differ (off-by-3)', () => {
    // 0000…0000 vs 0000…0007 — last hex nibble is 0111₂ → 3 set bits.
    expect(hammingDistance('0000000000000000', '0000000000000007')).toBe(3);
  });

  it('returns 10 for moderately different hashes (off-by-10)', () => {
    // Pick two hex strings that differ in exactly 10 bits.
    // 0xff (8 bits) + 0x03 (2 bits) → 10 differences in last 2 nibbles.
    expect(hammingDistance('00000000000000ff', '00000000000000fc')).toBe(2);
    expect(hammingDistance('00000000000000ff', '0000000000000000')).toBe(8);
    expect(hammingDistance('00000000000000ff', '0000000000000300')).toBe(10);
  });

  it('treats a fully different hash (gradient vs reverseGradient) as max distance', () => {
    // 0000…0000 vs ffff…ffff = 64 bits flipped.
    const a = dHashFromGrayscale(gradient());
    const b = dHashFromGrayscale(reverseGradient());
    expect(hammingDistance(a, b)).toBe(64);
  });

  it('returns max distance for malformed inputs', () => {
    expect(hammingDistance('zzzz', '0000')).toBe(64);
    expect(hammingDistance('0', '0000000000000000')).toBe(64);
  });
});

describe('hashFile', () => {
  it('rejects empty files', async () => {
    const empty = new File([], 'empty.jpg', { type: 'image/jpeg' });
    await expect(hashFile(empty)).rejects.toThrow(/empty/);
  });

  it('rejects non-image files', async () => {
    const f = new File([new Uint8Array([1, 2, 3])], 'x.txt', { type: 'text/plain' });
    await expect(hashFile(f)).rejects.toThrow(/image/);
  });

  it('rejects non-File inputs', async () => {
    await expect(hashFile('not a file' as unknown as File)).rejects.toThrow(/File/);
  });
});
