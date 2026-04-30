/**
 * Pure helpers for the /console/health/ digest UI.
 *
 * computeMetricDelta — given current + previous values for a metric, returns
 * the absolute delta, the percent delta (rounded to whole number, NaN-safe),
 * and a "trend" string describing whether the move is good, bad, or neutral
 * for that metric. Trend is metric-specific: bans_issued going DOWN is good
 * (less moderation noise), but admin_actions going DOWN is just neutral
 * (volume signal, not health).
 *
 * Used by ConsoleHealthView to color the delta pills.
 */

export type Trend = 'up_good' | 'up_bad' | 'down_good' | 'down_bad' | 'flat';

export interface MetricDelta {
  absolute: number;
  percent: number;
  trend: Trend;
}

const LOWER_IS_BETTER = new Set([
  'bans_issued',
  'reports_open',
  'appeals_open',
  'anomalies_unack',
  'function_errors_7d',
  'mod_queue_depth',
  'expert_queue_depth',
]);

const HIGHER_IS_BETTER = new Set([
  'bans_lifted',
]);

export function computeMetricDelta(
  current: number,
  previous: number,
  metric: string,
): MetricDelta {
  const absolute = current - previous;
  const percent = previous === 0
    ? (current === 0 ? 0 : 100)
    : Math.round((absolute / previous) * 100);
  if (absolute === 0) return { absolute, percent, trend: 'flat' };

  const lowerBetter = LOWER_IS_BETTER.has(metric);
  const higherBetter = HIGHER_IS_BETTER.has(metric);

  if (absolute > 0) {
    if (lowerBetter) return { absolute, percent, trend: 'up_bad' };
    if (higherBetter) return { absolute, percent, trend: 'up_good' };
    return { absolute, percent, trend: 'flat' };
  }
  // absolute < 0
  if (lowerBetter) return { absolute, percent, trend: 'down_good' };
  if (higherBetter) return { absolute, percent, trend: 'down_bad' };
  return { absolute, percent, trend: 'flat' };
}

export function trendColorClass(trend: Trend): string {
  switch (trend) {
    case 'up_good':
    case 'down_good':
      return 'bg-emerald-100 dark:bg-emerald-900/30 text-emerald-800 dark:text-emerald-300';
    case 'up_bad':
    case 'down_bad':
      return 'bg-red-100 dark:bg-red-900/30 text-red-800 dark:text-red-300';
    case 'flat':
    default:
      return 'bg-zinc-100 dark:bg-zinc-800 text-zinc-700 dark:text-zinc-300';
  }
}

export function trendArrow(trend: Trend): string {
  if (trend === 'up_good' || trend === 'up_bad') return '▲';
  if (trend === 'down_good' || trend === 'down_bad') return '▼';
  return '—';
}
