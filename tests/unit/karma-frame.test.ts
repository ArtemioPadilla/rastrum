import { describe, it, expect } from 'vitest';
import { tierForKarma, allKarmaTiers } from '../../src/lib/karma-frame';

describe('tierForKarma', () => {
  it('returns seedling for 0', () => {
    expect(tierForKarma(0).id).toBe('seedling');
  });

  it('returns seedling just below 100', () => {
    expect(tierForKarma(99).id).toBe('seedling');
  });

  it('returns observer at 100 (boundary)', () => {
    expect(tierForKarma(100).id).toBe('observer');
  });

  it('returns naturalist at 500', () => {
    expect(tierForKarma(500).id).toBe('naturalist');
  });

  it('returns expert at 1000 with glow', () => {
    const t = tierForKarma(1000);
    expect(t.id).toBe('expert');
    expect(t.glow).toBe(true);
  });

  it('returns master at 5000', () => {
    expect(tierForKarma(5000).id).toBe('master');
  });

  it('returns legend at 10000', () => {
    const t = tierForKarma(10000);
    expect(t.id).toBe('legend');
    expect(t.glow).toBe(true);
  });

  it('returns legend for very large values', () => {
    expect(tierForKarma(1_000_000).id).toBe('legend');
  });

  it('clamps negative karma to seedling', () => {
    expect(tierForKarma(-50).id).toBe('seedling');
  });

  it('coerces NaN to seedling', () => {
    expect(tierForKarma(Number.NaN).id).toBe('seedling');
  });

  it('every tier has a non-empty ringClass', () => {
    for (const tier of allKarmaTiers()) {
      expect(tier.ringClass.trim().length).toBeGreaterThan(0);
    }
  });

  it('tiers are ordered by ascending min', () => {
    const tiers = allKarmaTiers();
    for (let i = 1; i < tiers.length; i++) {
      expect(tiers[i].min).toBeGreaterThan(tiers[i - 1].min);
    }
  });
});
