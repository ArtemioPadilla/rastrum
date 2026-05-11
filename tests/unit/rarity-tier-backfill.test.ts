/**
 * Unit tests for #932: taxa.rarity_tier backfill classification logic.
 *
 * Tests the pure `classifyRarityTier` function from
 * `scripts/backfill-rarity-tier.mjs`.
 *
 * Tiers:
 *   NULL → 0 observations (no data)
 *   4    → very rare (1–5)
 *   3    → rare (6–20)
 *   2    → uncommon (21–100)
 *   1    → common (101+)
 */
import { describe, it, expect } from 'vitest';
import { classifyRarityTier } from '../../scripts/backfill-rarity-tier.mjs';

describe('#932 — classifyRarityTier', () => {
  // ── NULL (no observations) ───────────────────────────────────────────────
  it('returns null for 0 observations', () => {
    expect(classifyRarityTier(0)).toBeNull();
  });

  // ── Tier 4: very rare (1–5) ──────────────────────────────────────────────
  it('returns 4 for 1 observation (lower bound)', () => {
    expect(classifyRarityTier(1)).toBe(4);
  });
  it('returns 4 for 3 observations (mid)', () => {
    expect(classifyRarityTier(3)).toBe(4);
  });
  it('returns 4 for 5 observations (upper bound)', () => {
    expect(classifyRarityTier(5)).toBe(4);
  });

  // ── Tier 3: rare (6–20) ──────────────────────────────────────────────────
  it('returns 3 for 6 observations (lower bound)', () => {
    expect(classifyRarityTier(6)).toBe(3);
  });
  it('returns 3 for 13 observations (mid)', () => {
    expect(classifyRarityTier(13)).toBe(3);
  });
  it('returns 3 for 20 observations (upper bound)', () => {
    expect(classifyRarityTier(20)).toBe(3);
  });

  // ── Tier 2: uncommon (21–100) ────────────────────────────────────────────
  it('returns 2 for 21 observations (lower bound)', () => {
    expect(classifyRarityTier(21)).toBe(2);
  });
  it('returns 2 for 55 observations (mid)', () => {
    expect(classifyRarityTier(55)).toBe(2);
  });
  it('returns 2 for 100 observations (upper bound)', () => {
    expect(classifyRarityTier(100)).toBe(2);
  });

  // ── Tier 1: common (101+) ────────────────────────────────────────────────
  it('returns 1 for 101 observations (lower bound)', () => {
    expect(classifyRarityTier(101)).toBe(1);
  });
  it('returns 1 for 500 observations (mid)', () => {
    expect(classifyRarityTier(500)).toBe(1);
  });
  it('returns 1 for 10000 observations (large)', () => {
    expect(classifyRarityTier(10000)).toBe(1);
  });

  // ── Boundary guards ──────────────────────────────────────────────────────
  it('boundary: 5 is still very rare (tier 4), not rare (tier 3)', () => {
    expect(classifyRarityTier(5)).toBe(4);
    expect(classifyRarityTier(6)).toBe(3);
  });
  it('boundary: 20 is still rare (tier 3), not uncommon (tier 2)', () => {
    expect(classifyRarityTier(20)).toBe(3);
    expect(classifyRarityTier(21)).toBe(2);
  });
  it('boundary: 100 is still uncommon (tier 2), not common (tier 1)', () => {
    expect(classifyRarityTier(100)).toBe(2);
    expect(classifyRarityTier(101)).toBe(1);
  });

  // ── Type safety ──────────────────────────────────────────────────────────
  it('returns a number or null, never undefined', () => {
    [0, 1, 5, 6, 20, 21, 100, 101].forEach(n => {
      const result = classifyRarityTier(n);
      expect(result === null || typeof result === 'number').toBe(true);
    });
  });
});
