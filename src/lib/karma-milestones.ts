/**
 * Hard-coded milestone ladder. Lives here as the v1 fallback while
 * #557 (`karma_milestones` table) lands. Once the DB table is seeded,
 * the breakdown tooltip will read from it and this constant will be
 * the deploy-time fallback only.
 */
export const KARMA_MILESTONES: readonly number[] = [100, 500, 1000, 5000];

/**
 * Returns the next milestone strictly greater than `total`, or `null`
 * if the user has cleared every milestone in the ladder.
 */
export function nextMilestone(total: number, ladder: readonly number[] = KARMA_MILESTONES): number | null {
  for (const t of ladder) {
    if (t > total) return t;
  }
  return null;
}

/**
 * Distance from `total` to the next milestone. Returns `null` once
 * the top of the ladder has been crossed.
 */
export function distanceToNextMilestone(total: number, ladder: readonly number[] = KARMA_MILESTONES): number | null {
  const next = nextMilestone(total, ladder);
  if (next === null) return null;
  return Math.max(0, Math.round(next - total));
}
