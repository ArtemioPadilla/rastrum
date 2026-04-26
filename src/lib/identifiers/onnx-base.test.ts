import { describe, it, expect } from 'vitest';
import {
  ONNX_BASE_INPUT_SIZE, ONNX_BASE_TOP_K,
  IMAGENET_MEAN, IMAGENET_STD,
  preprocessRgba, parseLabel, softmax, topK,
} from './onnx-base-image';

describe('onnx-base-image constants', () => {
  it('input size is the standard 224 ImageNet edge', () => {
    expect(ONNX_BASE_INPUT_SIZE).toBe(224);
  });
  it('exposes a top-K constant', () => {
    expect(ONNX_BASE_TOP_K).toBe(5);
  });
  it('uses canonical ImageNet mean/std triples', () => {
    expect(IMAGENET_MEAN).toEqual([0.485, 0.456, 0.406]);
    expect(IMAGENET_STD).toEqual([0.229, 0.224, 0.225]);
  });
});

describe('preprocessRgba', () => {
  it('produces a CHW Float32 tensor of length 3·H·W', () => {
    const w = 2, h = 2;
    const rgba = new Uint8ClampedArray(w * h * 4);
    const out = preprocessRgba(rgba, w, h);
    expect(out.length).toBe(3 * w * h);
  });

  it('places R, G, B planes contiguously (CHW layout)', () => {
    // Single pixel: R=255, G=0, B=0, A=255.
    const rgba = new Uint8ClampedArray([255, 0, 0, 255]);
    const out = preprocessRgba(rgba, 1, 1);
    // R plane is index 0, G plane is index 1, B plane is index 2.
    const expectedR = (1 - IMAGENET_MEAN[0]) / IMAGENET_STD[0];
    const expectedG = (0 - IMAGENET_MEAN[1]) / IMAGENET_STD[1];
    const expectedB = (0 - IMAGENET_MEAN[2]) / IMAGENET_STD[2];
    expect(out[0]).toBeCloseTo(expectedR, 5);
    expect(out[1]).toBeCloseTo(expectedG, 5);
    expect(out[2]).toBeCloseTo(expectedB, 5);
  });

  it('drops the alpha channel', () => {
    const opaque = new Uint8ClampedArray([128, 64, 32, 255]);
    const transparent = new Uint8ClampedArray([128, 64, 32, 0]);
    const a = preprocessRgba(opaque, 1, 1);
    const b = preprocessRgba(transparent, 1, 1);
    expect(Array.from(a)).toEqual(Array.from(b));
  });

  it('scales pixel values to [0,1] before normalising', () => {
    // Mid-grey: 128/255 ≈ 0.5019 — verify that's what we feed the
    // standardisation, not 128 itself.
    const rgba = new Uint8ClampedArray([128, 128, 128, 255]);
    const out = preprocessRgba(rgba, 1, 1);
    const v = 128 / 255;
    expect(out[0]).toBeCloseTo((v - IMAGENET_MEAN[0]) / IMAGENET_STD[0], 5);
    expect(out[1]).toBeCloseTo((v - IMAGENET_MEAN[1]) / IMAGENET_STD[1], 5);
    expect(out[2]).toBeCloseTo((v - IMAGENET_MEAN[2]) / IMAGENET_STD[2], 5);
  });

  it('throws when the buffer is shorter than expected', () => {
    expect(() => preprocessRgba(new Uint8ClampedArray(3), 2, 2)).toThrow();
  });

  it('returns an empty buffer for non-positive dimensions', () => {
    const rgba = new Uint8ClampedArray(16);
    expect(preprocessRgba(rgba, 0, 4).length).toBe(0);
    expect(preprocessRgba(rgba, 4, 0).length).toBe(0);
  });
});

describe('softmax', () => {
  it('returns a probability distribution that sums to 1', () => {
    const out = softmax([1, 2, 3, 4]);
    let sum = 0;
    for (const v of out) sum += v;
    expect(sum).toBeCloseTo(1, 6);
  });

  it('preserves the argmax of the input logits', () => {
    const out = softmax([0.1, 9.9, 0.5, 0.2]);
    let maxIdx = 0;
    for (let i = 1; i < out.length; i++) if (out[i] > out[maxIdx]) maxIdx = i;
    expect(maxIdx).toBe(1);
  });

  it('is numerically stable for large logits', () => {
    const out = softmax([1000, 1001, 999]);
    // Without the max-shift these would all be Infinity and produce NaN.
    for (const v of out) expect(Number.isFinite(v)).toBe(true);
    let sum = 0;
    for (const v of out) sum += v;
    expect(sum).toBeCloseTo(1, 6);
  });

  it('returns an empty buffer for an empty input', () => {
    expect(softmax([]).length).toBe(0);
  });
});

describe('topK', () => {
  it('returns indices sorted by score descending', () => {
    const out = topK([0.1, 0.9, 0.5, 0.2], 3);
    expect(out.map(e => e.classIdx)).toEqual([1, 2, 3]);
    expect(out[0].score).toBeCloseTo(0.9);
  });

  it('clamps k to the input length', () => {
    const out = topK([0.1, 0.2], 10);
    expect(out.length).toBe(2);
  });

  it('handles an empty input', () => {
    expect(topK([], 3)).toEqual([]);
  });

  it('returns the documented default of 5 entries when called with TOP_K', () => {
    const scores = new Float32Array(1000);
    for (let i = 0; i < scores.length; i++) scores[i] = Math.sin(i);
    const out = topK(scores, ONNX_BASE_TOP_K);
    expect(out.length).toBe(5);
    // Verify monotonic sort.
    for (let i = 1; i < out.length; i++) {
      expect(out[i - 1].score).toBeGreaterThanOrEqual(out[i].score);
    }
  });
});

describe('parseLabel', () => {
  it('splits a synset-prefixed row into label + synset', () => {
    expect(parseLabel('n01440764 tench, Tinca tinca')).toEqual({
      label: 'tench',
      synset: 'n01440764',
    });
  });

  it('keeps only the first comma-separated alias as the label', () => {
    expect(parseLabel('n02123045 tabby, tabby cat, queen').label).toBe('tabby');
  });

  it('falls back to the raw row when there is no synset prefix', () => {
    expect(parseLabel('flamingo')).toEqual({ label: 'flamingo', synset: null });
  });

  it('handles bare comma-separated rows without a synset', () => {
    expect(parseLabel('jaguar, panther').label).toBe('jaguar');
  });

  it('returns empty fields for an empty input', () => {
    expect(parseLabel('')).toEqual({ label: '', synset: null });
  });

  it('trims surrounding whitespace', () => {
    expect(parseLabel('  n01440764   tench  ')).toEqual({
      label: 'tench',
      synset: 'n01440764',
    });
  });
});
