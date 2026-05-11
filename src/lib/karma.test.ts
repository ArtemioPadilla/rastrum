import { describe, it, expect } from 'vitest';
import {
  rarityTier,
  microcopyForVote,
  formatDelta,
  escAttr,
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

  it('does not include conservation bonus suffix when no conservation status provided', () => {
    const txt = microcopyForVote({
      lang: 'en',
      bucket: 3,
      multiplier: 2.5,
      expertiseLevel: 'Plantae',
      expertiseWeight: 1.0,
      streakMultiplier: 1.0,
      confidence: 0.9,
      inGrace: false,
      // iucnCategory and nom059Category not provided → no bonus
    });
    expect(txt).not.toMatch(/conservation bonus/i);
    expect(txt).not.toMatch(/IUCN|NOM-059/);
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

describe('escAttr', () => {
  it('escapes the five HTML metacharacters', () => {
    expect(escAttr(`&<>"'`)).toBe('&amp;&lt;&gt;&quot;&#39;');
  });
  it('passes through non-meta characters', () => {
    expect(escAttr('Quercus oleoides')).toBe('Quercus oleoides');
  });
  it('escapes & first to avoid double-escaping', () => {
    expect(escAttr('A & B')).toBe('A &amp; B');
  });
});

// ── #551: Conservation bonus in microcopy ────────────────────────────────────

describe('microcopyForVote — conservation bonus (#551)', () => {
  it('appends IUCN conservation bonus suffix for EN species', () => {
    const txt = microcopyForVote({
      lang: 'en',
      bucket: 3,
      multiplier: 2.5,
      expertiseLevel: 'Aves',
      expertiseWeight: 1.0,
      streakMultiplier: 1.0,
      confidence: 0.9,
      inGrace: false,
      iucnCategory: 'EN',
      nom059Category: null,
    });
    expect(txt).toMatch(/conservation bonus/i);
    expect(txt).toContain('IUCN EN');
    // win = round(5 * 2.5 * 1.0 * 1.0 * 2.0) = +25
    expect(txt).toContain('+25');
  });

  it('appends NOM-059 bonus suffix when NOM-059 wins over IUCN', () => {
    const txt = microcopyForVote({
      lang: 'es',
      bucket: 2,
      multiplier: 1.5,
      expertiseLevel: 'Mammalia',
      expertiseWeight: 1.0,
      streakMultiplier: 1.0,
      confidence: 0.9,
      inGrace: false,
      iucnCategory: 'LC',   // mult=1.0 — NOM-059 P (2.5) wins
      nom059Category: 'P',
    });
    expect(txt).toMatch(/bono conservaci\u00f3n/i);
    expect(txt).toContain('NOM-059 P');
  });

  it('does not append bonus suffix for LC species with no NOM-059 status', () => {
    const txt = microcopyForVote({
      lang: 'en',
      bucket: 1,
      multiplier: 1.0,
      expertiseLevel: null,
      expertiseWeight: 1.0,
      streakMultiplier: 1.0,
      confidence: 0.7,
      inGrace: false,
      iucnCategory: 'LC',
      nom059Category: null,
    });
    expect(txt).not.toMatch(/conservation bonus/i);
    expect(txt).not.toMatch(/IUCN|NOM-059/);
  });
});
