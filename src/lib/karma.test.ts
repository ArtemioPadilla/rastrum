import { describe, it, expect } from 'vitest';
import {
  rarityTier,
  microcopyForVote,
  formatDelta,
  RARITY_BUCKETS,
} from './karma';

describe('rarityTier', () => {
  it('returns 1 star for bucket 1 (most common)', () => {
    expect(rarityTier(1)).toBe('★');
  });
  it('returns 5 stars for bucket 5 (ultra-rare)', () => {
    expect(rarityTier(5)).toBe('★★★★★');
  });
});

describe('formatDelta', () => {
  it('prepends + on positive', () => {
    expect(formatDelta(5)).toBe('+5');
  });
  it('shows negative as-is', () => {
    expect(formatDelta(-2)).toBe('-2');
  });
  it('rounds to nearest int', () => {
    expect(formatDelta(4.6)).toBe('+5');
  });
});

describe('microcopyForVote', () => {
  it('renders standard line for non-grace user', () => {
    const txt = microcopyForVote({
      lang: 'en',
      bucket: 3,
      multiplier: 2.5,
      expertiseLevel: 'Plantae',
      expertiseWeight: 1.0,
      streakMultiplier: 1.0,
      confidence: 0.9,
      inGrace: false,
    });
    expect(txt).toContain('★★★');
    expect(txt).toContain('1.0×');
    expect(txt).toContain('+13');
    expect(txt).toContain('-4');
  });

  it('renders grace copy when in grace period', () => {
    const txt = microcopyForVote({
      lang: 'es',
      bucket: 1,
      multiplier: 1.0,
      expertiseLevel: null,
      expertiseWeight: 1.0,
      streakMultiplier: 1.0,
      confidence: 0.9,
      inGrace: true,
      graceDaysLeft: 24,
    });
    expect(txt).toMatch(/aprendizaje/i);
    expect(txt).toContain('24');
    expect(txt).not.toMatch(/-/);
  });

  it('exposes RARITY_BUCKETS as a stable array of 5', () => {
    expect(RARITY_BUCKETS).toHaveLength(5);
    expect(RARITY_BUCKETS[0].multiplier).toBe(1.0);
    expect(RARITY_BUCKETS[4].multiplier).toBe(5.0);
  });
});
