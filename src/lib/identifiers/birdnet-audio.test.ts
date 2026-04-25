import { describe, it, expect } from 'vitest';
import {
  BIRDNET_SAMPLE_RATE, BIRDNET_WINDOW_SAMPLES, BIRDNET_TOP_K,
  parseLabel, resampleNearest, toMono, normalise, windowSamples, topK,
  buildInputTensor,
} from './birdnet-audio';

describe('birdnet-audio constants', () => {
  it('window length matches 3 s at 48 kHz', () => {
    expect(BIRDNET_SAMPLE_RATE).toBe(48000);
    expect(BIRDNET_WINDOW_SAMPLES).toBe(48000 * 3);
  });

  it('exposes a top-K constant', () => {
    expect(BIRDNET_TOP_K).toBe(5);
  });
});

describe('parseLabel', () => {
  it('splits a standard "Genus species_Common Name" row', () => {
    expect(parseLabel('Tyrannus melancholicus_Tropical Kingbird')).toEqual({
      scientific_name: 'Tyrannus melancholicus',
      common_name_en: 'Tropical Kingbird',
    });
  });

  it('falls back to the whole token when no underscore is present', () => {
    expect(parseLabel('UnknownTaxon')).toEqual({
      scientific_name: 'UnknownTaxon',
      common_name_en: null,
    });
  });

  it('returns null common name when only the underscore is given', () => {
    expect(parseLabel('Genus species_')).toEqual({
      scientific_name: 'Genus species',
      common_name_en: null,
    });
  });

  it('trims surrounding whitespace', () => {
    expect(parseLabel('  Sciurus aureogaster_Mexican Gray Squirrel  ')).toEqual({
      scientific_name: 'Sciurus aureogaster',
      common_name_en: 'Mexican Gray Squirrel',
    });
  });

  it('returns empty fields for an empty string', () => {
    expect(parseLabel('')).toEqual({ scientific_name: '', common_name_en: null });
  });
});

describe('resampleNearest', () => {
  it('returns the same buffer when rates match', () => {
    const samples = new Float32Array([0.1, 0.2, 0.3, 0.4]);
    const out = resampleNearest(samples, 48000, 48000);
    expect(out).toBe(samples);
  });

  it('downsamples by 2× to half the length', () => {
    const samples = new Float32Array([1, 2, 3, 4, 5, 6, 7, 8]);
    const out = resampleNearest(samples, 96000, 48000);
    expect(out.length).toBe(4);
  });

  it('upsamples by 2× to double the length', () => {
    const samples = new Float32Array([1, 2, 3, 4]);
    const out = resampleNearest(samples, 24000, 48000);
    expect(out.length).toBe(8);
  });
});

describe('toMono', () => {
  it('returns the single channel untouched', () => {
    const ch = new Float32Array([0.1, -0.2, 0.3]);
    expect(toMono([ch])).toBe(ch);
  });

  it('averages stereo channels', () => {
    const l = new Float32Array([1, -1, 0.5]);
    const r = new Float32Array([1, 1, -0.5]);
    const out = toMono([l, r]);
    expect(Array.from(out)).toEqual([1, 0, 0]);
  });

  it('returns an empty buffer when no channels are passed', () => {
    expect(toMono([]).length).toBe(0);
  });
});

describe('normalise', () => {
  it('scales the peak sample to ±1', () => {
    const out = normalise(new Float32Array([0.25, -0.5, 0.1]));
    expect(out[1]).toBeCloseTo(-1, 6);
    expect(out[0]).toBeCloseTo(0.5, 6);
  });

  it('leaves a silent buffer untouched', () => {
    const samples = new Float32Array([0, 0, 0]);
    const out = normalise(samples);
    expect(Array.from(out)).toEqual([0, 0, 0]);
  });
});

describe('windowSamples', () => {
  it('returns the input as-is when length already matches', () => {
    const samples = new Float32Array(10).map((_, i) => i);
    expect(windowSamples(samples, 10)).toBe(samples);
  });

  it('zero-pads symmetrically when too short', () => {
    const samples = new Float32Array([1, 1, 1]);
    const out = windowSamples(samples, 7);
    expect(Array.from(out)).toEqual([0, 0, 1, 1, 1, 0, 0]);
  });

  it('centre-crops when too long', () => {
    const samples = new Float32Array([1, 2, 3, 4, 5, 6, 7]);
    const out = windowSamples(samples, 3);
    expect(Array.from(out)).toEqual([3, 4, 5]);
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
});

describe('buildInputTensor', () => {
  it('produces exactly BIRDNET_WINDOW_SAMPLES floats', () => {
    const ch = new Float32Array(96000).fill(0.5);
    const out = buildInputTensor([ch], 48000);
    expect(out.length).toBe(BIRDNET_WINDOW_SAMPLES);
  });

  it('peak-normalises the output', () => {
    const ch = new Float32Array(48000 * 4).map((_, i) => (i % 100) / 200);
    const out = buildInputTensor([ch], 48000);
    let peak = 0;
    for (const v of out) if (Math.abs(v) > peak) peak = Math.abs(v);
    expect(peak).toBeCloseTo(1, 5);
  });

  it('zero-pads when the source is shorter than 3 seconds', () => {
    const ch = new Float32Array(48000).fill(0.5);   // 1 s
    const out = buildInputTensor([ch], 48000);
    expect(out.length).toBe(BIRDNET_WINDOW_SAMPLES);
    expect(out[0]).toBe(0);
    expect(out[BIRDNET_WINDOW_SAMPLES - 1]).toBe(0);
  });
});
