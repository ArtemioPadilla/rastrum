import { hasAnthropicKey } from './anthropic-key';
import { getClaudeEligibility } from './sponsorships';

/**
 * True when Claude Vision is reachable for the current user.
 *
 * Resolves the same chain the `identify` Edge Function does:
 *   1. Browser-side BYO key (localStorage / runtime / build-env)
 *   2. Active beneficiary sponsorship (server-side)
 *   3. Active platform pool with capacity (server-side)
 *
 * The previous gate only checked (1), which silently hid the EF's
 * sponsor/pool resolution from the client cascade — users who donated
 * to the pool or had a sponsor would still see ❌ in the capability
 * banner and the cascade would skip Claude before ever reaching the EF.
 */
export async function claudeAvailable(): Promise<boolean> {
  const [byo, elig] = await Promise.all([
    hasAnthropicKey().catch(() => false),
    getClaudeEligibility().catch(() => ({ has_sponsor: false, has_pool: false, pool_used_today: 0, pool_cap_today: 0 })),
  ]);
  // Reviewer note on PR #652: the RPC's `has_pool` returns true purely on global pool
  // capacity, so a caller who has already exhausted today's daily_user_cap would still
  // see ✅ in the banner. The EF is the source of truth (returns "cap exhausted") but
  // reflecting it here avoids the UI/backend skew. cap_today === 0 means "no eligible
  // pool to draw from at all."
  const poolUsable = elig.has_pool && elig.pool_cap_today > 0 && elig.pool_used_today < elig.pool_cap_today;
  return byo || elig.has_sponsor || poolUsable;
}
