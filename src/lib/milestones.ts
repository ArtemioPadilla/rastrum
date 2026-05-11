/**
 * milestones.ts
 *
 * Pure helper for honest progress display. Returns the next round-number
 * milestone above a given count. Used by ObservationSuccess to render
 * "Observations: 43 / 50" instead of the prior fabricated "/100" denominator.
 *
 * Honest-norms invariant (v1.1.5): denominators must be either user-chosen
 * goals or universal landmarks. The MILESTONES array is the latter.
 */

export const MILESTONES = [10, 25, 50, 100, 250, 500, 1000, 2500, 5000, 10000] as const;

/** Smallest milestone strictly greater than `count`. Above 10000, rounds up to next 10k. */
export function nextMilestone(count: number): number {
  for (const m of MILESTONES) if (count < m) return m;
  return Math.ceil((count + 1) / 10000) * 10000;
}
