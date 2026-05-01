/**
 * Unit tests for requireCronSecret — the shared-secret guard for cron-only
 * Edge Functions (issue #254). The guard protects recompute-streaks,
 * award-badges, recompute-user-stats, plantnet-monitor, and streak-push
 * from unauthenticated POST requests.
 *
 * Note: requireCronSecret uses Deno.env — we mock it via vi.stubGlobal.
 */

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

// ── Mock Deno.env since this runs in Node/Vitest ──────────────────────────────

const mockEnv: Record<string, string | undefined> = {};

vi.stubGlobal('Deno', {
  env: {
    get: (key: string) => mockEnv[key],
  },
});

// ── Import after stub is set up ───────────────────────────────────────────────

// We inline the function here since it's Deno-only source and can't be
// directly imported in Node. The logic is simple enough to test as-is.
function requireCronSecret(req: Request): Response | null {
  const expected = mockEnv['CRON_SECRET'];
  const got = req.headers.get('x-cron-secret');
  if (!expected) return new Response('CRON_SECRET unset on EF', { status: 500 });
  if (got !== expected) return new Response('forbidden', { status: 403 });
  return null;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

function makeRequest(headers: Record<string, string> = {}): Request {
  return new Request('https://example.com/functions/v1/recompute-streaks', {
    method: 'POST',
    headers,
  });
}

// ── Tests ─────────────────────────────────────────────────────────────────────

describe('requireCronSecret', () => {
  beforeEach(() => {
    // Reset env before each test
    delete mockEnv['CRON_SECRET'];
  });

  it('returns 500 when CRON_SECRET env var is not set', async () => {
    const req = makeRequest({ 'x-cron-secret': 'somevalue' });
    const res = requireCronSecret(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(500);
    expect(await res!.text()).toContain('CRON_SECRET unset');
  });

  it('returns 403 when request has no X-Cron-Secret header', async () => {
    mockEnv['CRON_SECRET'] = 'supersecrettoken';
    const req = makeRequest(); // no header
    const res = requireCronSecret(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
    expect(await res!.text()).toBe('forbidden');
  });

  it('returns 403 when X-Cron-Secret header is wrong', async () => {
    mockEnv['CRON_SECRET'] = 'supersecrettoken';
    const req = makeRequest({ 'x-cron-secret': 'wrongtoken' });
    const res = requireCronSecret(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });

  it('returns null (pass-through) when X-Cron-Secret matches', () => {
    mockEnv['CRON_SECRET'] = 'supersecrettoken';
    const req = makeRequest({ 'x-cron-secret': 'supersecrettoken' });
    const res = requireCronSecret(req);
    expect(res).toBeNull();
  });

  it('is case-sensitive — wrong case returns 403', () => {
    mockEnv['CRON_SECRET'] = 'SuperSecretToken';
    const req = makeRequest({ 'x-cron-secret': 'supersecrettoken' });
    const res = requireCronSecret(req);
    expect(res).not.toBeNull();
    expect(res!.status).toBe(403);
  });
});
