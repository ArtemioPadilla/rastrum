/**
 * Smoke contract tests for the `sponsorships` Edge Function (#1031 Tier 1a).
 *
 * Pinned behavior (no live Supabase required):
 *   1. OPTIONS preflight returns 204 with CORS headers.
 *   2. Requests with no Bearer auth header → 401 `no_auth`.
 *   3. Heartbeat without the cron token → 401.
 *   4. Unknown method on a known shape stays user-gated (401 without auth).
 *
 * Happy-path tests (real user / cron writes) are out of scope here —
 * they need a real Supabase project + Vault. See `Deno.test.ignore` below.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('sponsorships: OPTIONS preflight returns 204 with CORS', async () => {
  const res = await handler(new Request('http://localhost/sponsorships/credentials', { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('sponsorships: GET /credentials without auth → 401', async () => {
  const res = await handler(new Request('http://localhost/sponsorships/credentials', { method: 'GET' }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'no_auth');
});

Deno.test('sponsorships: POST /heartbeat without cron token → 401', async () => {
  const res = await handler(new Request('http://localhost/sponsorships/heartbeat', { method: 'POST' }));
  assertEquals(res.status, 401);
  const body = await res.json();
  // Either no_cron_token (env-configured) or no_auth (env-unset fallback through user gate)
  // — both indicate the cron gate refused the call.
  assertEquals(['no_cron_token', 'no_auth'].includes(body.error), true);
});

Deno.test('sponsorships: PATCH without auth → 401', async () => {
  const res = await handler(new Request('http://localhost/sponsorships/credentials', { method: 'PATCH' }));
  assertEquals(res.status, 401);
});

Deno.test.ignore('sponsorships: POST /credentials happy path', () => {
  // TODO: requires live Supabase + Vault + a test user JWT. Out of scope
  // for the smoke contract suite; see integration tests in CI.
});
