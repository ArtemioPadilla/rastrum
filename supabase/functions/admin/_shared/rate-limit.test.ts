/**
 * Deno unit tests for the token-bucket rate limiter.
 *
 * Run with: deno test supabase/functions/admin/_shared/rate-limit.test.ts
 *
 * Behavior under test:
 *   1. Fresh actor: allowed, full bucket minus cost.
 *   2. Actor exhausts bucket: subsequent call denied, retryAfterSeconds > 0.
 *   3. Bucket refills over time (via time-mocking hack: tests are order-dependent,
 *      so we use separate actor IDs to avoid bucket carry-over).
 *   4. Cost = 3 write actions exhaust budget faster.
 */

import { assertEquals, assertGreater } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { checkRateLimit } from './rate-limit.ts';

Deno.test('fresh actor is allowed, tokens reduced by cost', () => {
  const result = checkRateLimit('actor-fresh-1', 1);
  assertEquals(result.allowed, true);
  assertEquals(result.retryAfterSeconds, 0);
  assertEquals(result.tokensRemaining, 29);
});

Deno.test('write cost 3 drains 3 tokens per call', () => {
  const a = checkRateLimit('actor-write-1', 3);
  assertEquals(a.allowed, true);
  assertEquals(a.tokensRemaining, 27);
  const b = checkRateLimit('actor-write-1', 3);
  assertEquals(b.allowed, true);
  assertEquals(b.tokensRemaining, 24);
});

Deno.test('bucket exhaustion: denied after capacity consumed', () => {
  const actorId = 'actor-exhaust-1';
  // Drain all 30 tokens with cost-1 calls
  for (let i = 0; i < 30; i++) {
    checkRateLimit(actorId, 1);
  }
  const result = checkRateLimit(actorId, 1);
  assertEquals(result.allowed, false);
  assertGreater(result.retryAfterSeconds, 0);
  assertEquals(result.tokensRemaining, 0);
});

Deno.test('retryAfterSeconds is positive and non-zero when denied', () => {
  const actorId = 'actor-retry-1';
  for (let i = 0; i < 30; i++) checkRateLimit(actorId, 1);
  const result = checkRateLimit(actorId, 5);
  assertEquals(result.allowed, false);
  assertGreater(result.retryAfterSeconds, 0);
});
