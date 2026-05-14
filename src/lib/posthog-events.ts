/**
 * PostHog onboarding event helpers.
 *
 * Provides typed cohort helpers used by every onboarding:* capture call
 * so properties are consistent across all event sites.
 *
 * Usage:
 *   import { cohortWeek, daysSince } from './posthog-events';
 *   window.posthog?.capture('onboarding:signed_up', {
 *     days_since_signup: 0,
 *     cohort_week: cohortWeek(),
 *   });
 */

/**
 * Returns the ISO 8601 week string for a given date, e.g. "2026-W19".
 * Used as a segmentation dimension in PostHog funnels.
 */
export function cohortWeek(date: Date = new Date()): string {
  // ISO week: Monday=1 … Sunday=7
  const d = new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth(), date.getUTCDate()));
  const dayNum = d.getUTCDay() || 7; // 0 (Sun) → 7
  d.setUTCDate(d.getUTCDate() + 4 - dayNum); // shift to Thursday of same week
  const yearStart = new Date(Date.UTC(d.getUTCFullYear(), 0, 1));
  const weekNo = Math.ceil((((d.getTime() - yearStart.getTime()) / 86400000) + 1) / 7);
  return `${d.getUTCFullYear()}-W${String(weekNo).padStart(2, '0')}`;
}

/**
 * Returns the number of whole days since `createdAt` (ISO string).
 * Always >= 0. Returns 0 on parse error.
 */
export function daysSince(createdAt: string): number {
  const created = new Date(createdAt).getTime();
  if (!Number.isFinite(created)) return 0;
  return Math.max(0, Math.floor((Date.now() - created) / (1000 * 60 * 60 * 24)));
}
