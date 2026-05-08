/**
 * Pure helpers for the triage SLA dashboard. Extracted from
 * `scripts/fetch-gh-issue-stats.ts` so the math can be unit-tested
 * without standing up the gh CLI.
 */

export interface TriageStats {
  generated_at: string;
  repo: string;
  window_days: number;
  open_count: number;
  resolved_30d: number;
  median_first_comment_h: number | null;
  sample_size: number;
}

/**
 * Returns the median of `values` in their original units, or `null`
 * for an empty input. Even-length arrays return the average of the
 * two middle values; odd-length arrays return the middle value.
 */
export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

/**
 * Hours between two ISO-8601 timestamps. Returns `null` if either
 * is unparseable or if `replied` is before `created` (clock skew or
 * malformed data).
 */
export function hoursBetween(createdIso: string, repliedIso: string): number | null {
  const created = new Date(createdIso).getTime();
  const replied = new Date(repliedIso).getTime();
  if (Number.isNaN(created) || Number.isNaN(replied) || replied < created) {
    return null;
  }
  return (replied - created) / (1000 * 60 * 60);
}

/**
 * Round a float to 1 decimal place. Used so median values render
 * cleanly in the public dashboard (`38.4 h` rather than `38.39999…`).
 */
export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}
