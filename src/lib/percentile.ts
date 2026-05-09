/**
 * Pure helpers for the M08 "tú vs. observador MX promedio" widget (#744).
 *
 * Two responsibilities:
 *   1. Decide whether a user's percentile row is statistically meaningful
 *      enough to surface (cohort_n >= MIN_COHORT_N). Below the threshold,
 *      the UI renders a "datos insuficientes" honest fallback instead of
 *      a noisy norm.
 *   2. Convert a 0-100 percentile into a CSS bar width clamped to a
 *      readable visual range — 0 % is invisible and 100 % overflows the
 *      track on rounding edge cases. Keeping this in a pure helper makes
 *      the rendering testable without DOM.
 *
 * NEVER returns or formats raw rank — only percentiles. This is a
 * deliberate Fogg-ethical framing constraint (Persuasive Tech ch. 8 vs
 * ch. 9): normative comparison without leaderboard toxicity.
 */

export const MIN_COHORT_N = 50;
export const MIN_BAR_WIDTH_PCT = 2;
export const MAX_BAR_WIDTH_PCT = 100;

export type PercentileMetric =
  | 'diversity'
  | 'habitats'
  | 'validations'
  | 'spread';

export interface PercentilePayload {
  user_id: string;
  cohort_country: string | null;
  cohort_n: number;
  computed_at: string;
  diversity_pctl: number;
  habitats_pctl: number;
  validations_pctl: number;
  spread_pctl: number;
  diversity_value: number;
  habitats_value: number;
  validations_value: number;
  spread_value: number;
}

export function hasSufficientCohort(cohortN: number | null | undefined): boolean {
  return typeof cohortN === 'number' && cohortN >= MIN_COHORT_N;
}

/**
 * Map a 0-100 percentile to a CSS width percentage. We clamp the lower
 * bound so that "10th percentile" still renders as a visible nub instead
 * of a hairline, and we floor below 0 / cap above 100 to defend against
 * stale or malformed payloads.
 */
export function percentileToBarWidth(pctl: number): number {
  if (!Number.isFinite(pctl)) return MIN_BAR_WIDTH_PCT;
  if (pctl <= 0) return MIN_BAR_WIDTH_PCT;
  if (pctl >= 100) return MAX_BAR_WIDTH_PCT;
  return Math.max(MIN_BAR_WIDTH_PCT, Math.min(MAX_BAR_WIDTH_PCT, Math.round(pctl)));
}

/**
 * Round a percentile for display. Centralised so the EN and ES UI never
 * disagree on whether to show "60" or "60.4".
 */
export function formatPercentile(pctl: number): string {
  if (!Number.isFinite(pctl)) return '—';
  const clamped = Math.max(0, Math.min(100, pctl));
  return String(Math.round(clamped));
}

/**
 * Format the user-facing metric value for the four cards. The display
 * resolution is metric-specific:
 *   - diversity   → 2 decimals (Shannon H' is a small float)
 *   - habitats    → integer count
 *   - validations → integer count
 *   - spread      → integer km^2 (rounded; 0.5 km^2 is not interesting
 *                    at the cohort scale).
 */
export function formatMetricValue(metric: PercentileMetric, value: number): string {
  if (!Number.isFinite(value)) return '—';
  switch (metric) {
    case 'diversity':
      return value.toFixed(2);
    case 'habitats':
    case 'validations':
      return String(Math.round(value));
    case 'spread':
      return Math.round(value).toLocaleString();
  }
}

/**
 * Project the four cards from the percentile payload. Each card carries
 * the percentile (0-100), the computed bar width, and the formatted
 * metric value — everything the Astro template needs to render without
 * any further math in the DOM script.
 */
export interface PercentileCard {
  metric: PercentileMetric;
  pctl: number;
  barWidthPct: number;
  pctlLabel: string;
  valueLabel: string;
}

export function buildCards(p: PercentilePayload): PercentileCard[] {
  return [
    {
      metric: 'diversity',
      pctl: p.diversity_pctl,
      barWidthPct: percentileToBarWidth(p.diversity_pctl),
      pctlLabel: formatPercentile(p.diversity_pctl),
      valueLabel: formatMetricValue('diversity', p.diversity_value),
    },
    {
      metric: 'habitats',
      pctl: p.habitats_pctl,
      barWidthPct: percentileToBarWidth(p.habitats_pctl),
      pctlLabel: formatPercentile(p.habitats_pctl),
      valueLabel: formatMetricValue('habitats', p.habitats_value),
    },
    {
      metric: 'validations',
      pctl: p.validations_pctl,
      barWidthPct: percentileToBarWidth(p.validations_pctl),
      pctlLabel: formatPercentile(p.validations_pctl),
      valueLabel: formatMetricValue('validations', p.validations_value),
    },
    {
      metric: 'spread',
      pctl: p.spread_pctl,
      barWidthPct: percentileToBarWidth(p.spread_pctl),
      pctlLabel: formatPercentile(p.spread_pctl),
      valueLabel: formatMetricValue('spread', p.spread_value),
    },
  ];
}
