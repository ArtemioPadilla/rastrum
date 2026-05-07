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
  return byo || elig.has_sponsor || elig.has_pool;
}
