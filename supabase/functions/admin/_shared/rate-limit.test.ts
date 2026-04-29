/**
 * Deno unit tests for the Postgres-backed token-bucket rate limiter.
 *
 * Run with: deno test supabase/functions/admin/_shared/rate-limit.test.ts
 *
 * The implementation delegates to a Supabase RPC. These tests exercise
 * the fail-open path (RPC error → allowed) and the response-mapping
 * for allowed / denied rows, using a stub admin client rather than a
 * live Postgres connection.
 *
 * Behavior under test:
 *   1. RPC error → fail-open (allowed=true, full capacity, retryAfter=0).
 *   2. RPC returns allowed=true → result maps correctly.
 *   3. RPC returns allowed=false → result maps correctly with retryAfter.
 *   4. tokensRemaining is floored to an integer.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { checkRateLimit } from './rate-limit.ts';
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

function makeAdmin(
  rpcResult: { data: unknown; error: unknown },
): SupabaseClient {
  return {
    rpc: (_fn: string, _args: unknown) => Promise.resolve(rpcResult),
  } as unknown as SupabaseClient;
}

Deno.test('fail-open when RPC errors', async () => {
  const admin = makeAdmin({ data: null, error: new Error('db down') });
  const result = await checkRateLimit(admin, 'actor-1', 1);
  assertEquals(result.allowed, true);
  assertEquals(result.retryAfterSeconds, 0);
  assertEquals(result.tokensRemaining, 30);
});

Deno.test('fail-open when RPC returns empty data', async () => {
  const admin = makeAdmin({ data: [], error: null });
  const result = await checkRateLimit(admin, 'actor-2', 1);
  assertEquals(result.allowed, true);
  assertEquals(result.retryAfterSeconds, 0);
  assertEquals(result.tokensRemaining, 30);
});

Deno.test('allowed row maps correctly', async () => {
  const row = { allowed: true, retry_after_seconds: 0, tokens_remaining: 27.0 };
  const admin = makeAdmin({ data: [row], error: null });
  const result = await checkRateLimit(admin, 'actor-3', 3);
  assertEquals(result.allowed, true);
  assertEquals(result.retryAfterSeconds, 0);
  assertEquals(result.tokensRemaining, 27);
});

Deno.test('denied row maps correctly', async () => {
  const row = { allowed: false, retry_after_seconds: 4, tokens_remaining: 0.0 };
  const admin = makeAdmin({ data: [row], error: null });
  const result = await checkRateLimit(admin, 'actor-4', 3);
  assertEquals(result.allowed, false);
  assertEquals(result.retryAfterSeconds, 4);
  assertEquals(result.tokensRemaining, 0);
});

Deno.test('tokensRemaining is floored to integer', async () => {
  const row = { allowed: true, retry_after_seconds: 0, tokens_remaining: 28.9 };
  const admin = makeAdmin({ data: [row], error: null });
  const result = await checkRateLimit(admin, 'actor-5', 1);
  assertEquals(result.tokensRemaining, 28);
});
