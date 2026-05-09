/**
 * Tests for src/lib/percentile.ts — the M08 percentile-card pure helpers
 * for issue #744 ("tú vs. observador MX promedio").
 *
 * Why these are unit-tested:
 *   - The "datos insuficientes" honest fallback must fire whenever the
 *     cohort drops below MIN_COHORT_N. Regressions here would let us
 *     ship noisy norms (the Fogg-ethical anti-pattern this whole feature
 *     was designed to avoid).
 *   - The bar-render math has clamping rules (no hairline at p=10, no
 *     overflow at p>=100, no NaN propagating to inline `style="width:…"`).
 *     Centralising those rules in a helper means we can pin them here
 *     instead of relying on visual review.
 *
 * The SQL side (the materialized view + recompute_user_metrics_percentile
 * wrapper) is not exercised by this file — it's covered by db-validate.yml
 * (Postgres 17 + PostGIS 3.4) which applies the schema twice and asserts
 * idempotency.
 */

import { describe, it, expect } from 'vitest';
import {
  MIN_COHORT_N,
  MIN_BAR_WIDTH_PCT,
  MAX_BAR_WIDTH_PCT,
  hasSufficientCohort,
  percentileToBarWidth,
  formatPercentile,
  formatMetricValue,
  buildCards,
  type PercentilePayload,
} from '../../src/lib/percentile';

describe('hasSufficientCohort', () => {
  it('returns false for null / undefined / NaN', () => {
    expect(hasSufficientCohort(null)).toBe(false);
    expect(hasSufficientCohort(undefined)).toBe(false);
    expect(hasSufficientCohort(NaN)).toBe(false);
  });

  it('returns false below the threshold', () => {
    expect(hasSufficientCohort(0)).toBe(false);
    expect(hasSufficientCohort(MIN_COHORT_N - 1)).toBe(false);
  });

  it('returns true at or above the threshold', () => {
    expect(hasSufficientCohort(MIN_COHORT_N)).toBe(true);
    expect(hasSufficientCohort(MIN_COHORT_N + 100)).toBe(true);
  });
});

describe('percentileToBarWidth', () => {
  it('clamps non-finite input to a safe minimum', () => {
    // Non-finite values fall through to the MIN floor — never NaN in CSS.
    expect(percentileToBarWidth(NaN)).toBe(MIN_BAR_WIDTH_PCT);
    expect(percentileToBarWidth(Infinity)).toBe(MIN_BAR_WIDTH_PCT);
    expect(percentileToBarWidth(-Infinity)).toBe(MIN_BAR_WIDTH_PCT);
  });

  it('floors at MIN_BAR_WIDTH_PCT for very low percentiles', () => {
    expect(percentileToBarWidth(0)).toBe(MIN_BAR_WIDTH_PCT);
    expect(percentileToBarWidth(-5)).toBe(MIN_BAR_WIDTH_PCT);
    expect(percentileToBarWidth(1)).toBeGreaterThanOrEqual(MIN_BAR_WIDTH_PCT);
  });

  it('caps at MAX_BAR_WIDTH_PCT for high percentiles', () => {
    expect(percentileToBarWidth(100)).toBe(MAX_BAR_WIDTH_PCT);
    expect(percentileToBarWidth(150)).toBe(MAX_BAR_WIDTH_PCT);
  });

  it('rounds mid-range percentiles to the nearest integer', () => {
    expect(percentileToBarWidth(60.4)).toBe(60);
    expect(percentileToBarWidth(60.6)).toBe(61);
    expect(percentileToBarWidth(50)).toBe(50);
  });
});

describe('formatPercentile', () => {
  it('returns dash for non-finite input', () => {
    expect(formatPercentile(NaN)).toBe('—');
    expect(formatPercentile(Infinity)).toBe('—');
    expect(formatPercentile(-Infinity)).toBe('—');
  });

  it('clamps and rounds to a 0-100 integer string', () => {
    expect(formatPercentile(-3)).toBe('0');
    expect(formatPercentile(0)).toBe('0');
    expect(formatPercentile(60.4)).toBe('60');
    expect(formatPercentile(60.6)).toBe('61');
    expect(formatPercentile(100)).toBe('100');
    expect(formatPercentile(120)).toBe('100');
  });
});

describe('formatMetricValue', () => {
  it('shows 2 decimals for diversity (Shannon H prime is small)', () => {
    expect(formatMetricValue('diversity', 1.234)).toBe('1.23');
    expect(formatMetricValue('diversity', 0)).toBe('0.00');
  });

  it('shows integers for habitat / validation counts', () => {
    expect(formatMetricValue('habitats', 7.4)).toBe('7');
    expect(formatMetricValue('validations', 19.6)).toBe('20');
  });

  it('shows rounded km^2 (locale-formatted) for spread', () => {
    expect(formatMetricValue('spread', 1234.7)).toBe((1235).toLocaleString());
    expect(formatMetricValue('spread', 0.4)).toBe('0');
  });

  it('returns dash for non-finite values', () => {
    expect(formatMetricValue('diversity', NaN)).toBe('—');
    expect(formatMetricValue('spread',    Infinity)).toBe('—');
  });
});

describe('buildCards', () => {
  const fixture: PercentilePayload = {
    user_id: 'u1',
    cohort_country: 'MX',
    cohort_n: 120,
    computed_at: '2026-05-01T00:00:00Z',
    diversity_pctl: 73.6,
    habitats_pctl: 0,
    validations_pctl: 100,
    spread_pctl: 42.4,
    diversity_value: 2.183,
    habitats_value: 4,
    validations_value: 17,
    spread_value: 1234.5,
  };

  it('emits exactly 4 cards in the spec order', () => {
    const cards = buildCards(fixture);
    expect(cards).toHaveLength(4);
    expect(cards.map((c) => c.metric)).toEqual([
      'diversity', 'habitats', 'validations', 'spread',
    ]);
  });

  it('respects bar-width clamping at the boundaries', () => {
    const cards = buildCards(fixture);
    const byMetric = Object.fromEntries(cards.map((c) => [c.metric, c]));
    expect(byMetric.habitats.barWidthPct).toBe(MIN_BAR_WIDTH_PCT);
    expect(byMetric.validations.barWidthPct).toBe(MAX_BAR_WIDTH_PCT);
    expect(byMetric.diversity.barWidthPct).toBe(74);
    expect(byMetric.spread.barWidthPct).toBe(42);
  });

  it('formats per-metric value labels per metric type', () => {
    const cards = buildCards(fixture);
    const byMetric = Object.fromEntries(cards.map((c) => [c.metric, c]));
    expect(byMetric.diversity.valueLabel).toBe('2.18');
    expect(byMetric.habitats.valueLabel).toBe('4');
    expect(byMetric.validations.valueLabel).toBe('17');
    expect(byMetric.spread.valueLabel).toBe((1235).toLocaleString());
  });

  it('formats percentile labels as integers', () => {
    const cards = buildCards(fixture);
    const byMetric = Object.fromEntries(cards.map((c) => [c.metric, c]));
    expect(byMetric.diversity.pctlLabel).toBe('74');
    expect(byMetric.habitats.pctlLabel).toBe('0');
    expect(byMetric.validations.pctlLabel).toBe('100');
    expect(byMetric.spread.pctlLabel).toBe('42');
  });
});
