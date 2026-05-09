/**
 * Unit tests for src/lib/impact.ts — the pure formatters consumed by
 * ImpactView.astro. Heuristic precision is locked here so a future tweak
 * can't silently inflate or deflate the displayed number.
 */

import { describe, it, expect } from 'vitest';
import { formatTransectKm, formatCount, isUserImpact } from '../../src/lib/impact';

describe('formatTransectKm', () => {
  it('renders zero as "0 km"', () => {
    expect(formatTransectKm(0)).toBe('0 km');
  });

  it('clamps negative / NaN to zero', () => {
    expect(formatTransectKm(-3)).toBe('0 km');
    expect(formatTransectKm(Number.NaN)).toBe('0 km');
    expect(formatTransectKm(Number.POSITIVE_INFINITY)).toBe('0 km');
  });

  it('renders sub-km values with one decimal', () => {
    expect(formatTransectKm(0.4)).toBe('0.4 km');
    expect(formatTransectKm(0.05)).toBe('0.1 km');
  });

  it('renders single-digit km with one decimal', () => {
    expect(formatTransectKm(3.74)).toBe('3.7 km');
  });

  it('rounds to integer at ≥10 km', () => {
    expect(formatTransectKm(12.4)).toBe('12 km');
    expect(formatTransectKm(99.7)).toBe('100 km');
  });
});

describe('formatCount', () => {
  it('handles zero', () => {
    expect(formatCount(0)).toBe('0');
  });

  it('clamps negative to zero', () => {
    expect(formatCount(-1)).toBe('0');
  });

  it('floors fractional values', () => {
    expect(formatCount(3.7)).toBe('3');
  });

  it('uses thousands separator (en)', () => {
    expect(formatCount(1234, 'en')).toBe('1,234');
  });

  it('uses thousands separator (es)', () => {
    // es-MX uses comma for thousands and period for decimals (NOT the
    // dot-thousands of es-ES). Pin the locale we picked, not the user's
    // browser default.
    const out = formatCount(1234, 'es');
    expect(out).toMatch(/1[ ,]234/);
  });
});

describe('isUserImpact', () => {
  it('accepts a well-formed envelope', () => {
    expect(
      isUserImpact({
        transect_km: 1.2,
        research_grade: 3,
        expert_confirmed: 0,
        in_research: 0,
        sensitive_seen: 1,
        computed_at: '2026-05-08T00:00:00Z',
      }),
    ).toBe(true);
  });

  it('rejects null / undefined / non-objects', () => {
    expect(isUserImpact(null)).toBe(false);
    expect(isUserImpact(undefined)).toBe(false);
    expect(isUserImpact('hello')).toBe(false);
    expect(isUserImpact(42)).toBe(false);
  });

  it('rejects partially-formed envelopes', () => {
    expect(isUserImpact({ transect_km: 1 })).toBe(false);
    expect(
      isUserImpact({
        transect_km: '1', // string not number
        research_grade: 0,
        expert_confirmed: 0,
        in_research: 0,
        sensitive_seen: 0,
      }),
    ).toBe(false);
  });
});
