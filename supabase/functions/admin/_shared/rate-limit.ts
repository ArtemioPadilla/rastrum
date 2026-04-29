/**
 * Token-bucket rate limiter, in-memory per actor.
 *
 * Costless on the free tier (no Redis dependency). Persists across
 * invocations within a single Edge Function isolate but resets on cold
 * start — that's an acceptable trade-off for an admin surface where
 * a determined attacker who can outlast cold starts is already inside.
 *
 * Defaults: 30 requests / minute / actor. Overridable per-handler via
 * the dispatcher; tighten for write actions (cost = 3) and relax for
 * sensitive_read.* (cost = 1).
 */
type Bucket = { tokens: number; lastRefill: number };

const buckets = new Map<string, Bucket>();

const REFILL_RATE_PER_SECOND = 0.5; // 30 tokens / 60 seconds
const BUCKET_CAPACITY = 30;

export interface RateLimitResult {
  allowed: boolean;
  retryAfterSeconds: number;
  tokensRemaining: number;
}

export function checkRateLimit(actorId: string, cost = 1): RateLimitResult {
  const now = Date.now();
  let bucket = buckets.get(actorId);
  if (!bucket) {
    bucket = { tokens: BUCKET_CAPACITY, lastRefill: now };
    buckets.set(actorId, bucket);
  } else {
    const elapsedSec = (now - bucket.lastRefill) / 1000;
    bucket.tokens = Math.min(BUCKET_CAPACITY, bucket.tokens + elapsedSec * REFILL_RATE_PER_SECOND);
    bucket.lastRefill = now;
  }
  if (bucket.tokens >= cost) {
    bucket.tokens -= cost;
    return { allowed: true, retryAfterSeconds: 0, tokensRemaining: Math.floor(bucket.tokens) };
  }
  const tokensNeeded = cost - bucket.tokens;
  const retryAfter = Math.ceil(tokensNeeded / REFILL_RATE_PER_SECOND);
  return { allowed: false, retryAfterSeconds: retryAfter, tokensRemaining: Math.floor(bucket.tokens) };
}
