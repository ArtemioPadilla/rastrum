/**
 * Postgres-backed token-bucket rate limiter for the admin dispatcher.
 *
 * Replaces the in-memory Map implementation from PR8. The in-memory
 * approach resets on every cold start, allowing a determined attacker
 * who can outlast the isolate lifetime to evade the limit entirely.
 * This implementation persists bucket state in `rate_limit_buckets` via
 * an atomic UPSERT + decrement RPC, so the counter is durable across
 * all concurrent isolates.
 *
 * Fail-open: if the RPC errors (table missing, network blip, etc.) the
 * call is allowed through. The JWT + role gate still applies, so a
 * degraded rate limiter does not open the admin surface to unauthenticated
 * requests — it just stops counting authenticated ones temporarily.
 *
 * Defaults: 30 tokens, refill 0.5/s (= 30 req/min sustained).
 * Write actions cost 3; read actions cost 1 (enforced in the dispatcher).
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  tokensRemaining: number;
}

const REFILL_PER_SECOND = 0.5;
const CAPACITY = 30;

export async function checkRateLimit(
  admin: SupabaseClient,
  actorId: string,
  cost = 1,
): Promise<RateLimitResult> {
  const { data, error } = await admin.rpc('consume_rate_limit_token', {
    p_actor_id: actorId,
    p_cost: cost,
    p_capacity: CAPACITY,
    p_refill_per_second: REFILL_PER_SECOND,
  });

  if (error || !data || !data[0]) {
    // Fail-open: let through when rate-limit infrastructure is unavailable.
    console.warn('rate-limit RPC failed, allowing request:', error);
    return { allowed: true, retryAfterSeconds: 0, tokensRemaining: CAPACITY };
  }

  const row = data[0] as { allowed: boolean; retry_after_seconds: number; tokens_remaining: number };
  return {
    allowed: row.allowed,
    retryAfterSeconds: row.retry_after_seconds,
    tokensRemaining: Math.floor(Number(row.tokens_remaining)),
  };
}
