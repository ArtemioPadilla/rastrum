import { describe, it, expect } from 'vitest';

// Pure verification of the backoff math used by processIdQueue (#588).
// Backoff formula: min(60_000 * 2^attempts, 86_400_000).

const RETRY_BACKOFF_MS_BASE = 60_000;
const RETRY_BACKOFF_MS_CAP = 86_400_000;

function backoffMs(attempts: number): number {
  return Math.min(RETRY_BACKOFF_MS_BASE * Math.pow(2, attempts), RETRY_BACKOFF_MS_CAP);
}

describe('idQueue retry backoff (#588)', () => {
  it('first retry waits 60s', () => {
    expect(backoffMs(0)).toBe(60_000);
  });
  it('second retry waits 120s', () => {
    expect(backoffMs(1)).toBe(120_000);
  });
  it('fifth retry waits 32 min', () => {
    expect(backoffMs(5)).toBe(60_000 * 32);
  });
  it('caps at 1 day', () => {
    expect(backoffMs(20)).toBe(86_400_000);
  });
  it('skip retry when last_attempt_at is within backoff window', () => {
    const now = Date.now();
    const lastAttempt = now - 30_000;
    const attempts = 0;
    const ready = now - lastAttempt >= backoffMs(attempts);
    expect(ready).toBe(false);
  });
  it('allows retry when backoff window elapsed', () => {
    const now = Date.now();
    const lastAttempt = now - 120_000;
    const attempts = 0;
    const ready = now - lastAttempt >= backoffMs(attempts);
    expect(ready).toBe(true);
  });
});
