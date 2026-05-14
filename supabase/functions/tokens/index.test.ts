/**
 * Smoke contract tests for the `tokens` Edge Function (#1031 Tier 1a).
 *
 * Pinned behavior:
 *   1. OPTIONS preflight returns 200 with CORS headers.
 *   2. No Authorization header → 401 (Missing Authorization header).
 *   3. Authorization header without "Bearer " prefix yields a JWT-less path
 *      that still 401s once Supabase rejects the empty token.
 *
 * Token CRUD (rst_* generation, scope validation, revocation) needs a real
 * Supabase project + a valid JWT — those paths are integration-only.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('tokens: OPTIONS preflight → 200 with CORS', async () => {
  const res = await handler(new Request('http://localhost/tokens', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test('tokens: GET without Authorization → 401', async () => {
  const res = await handler(new Request('http://localhost/tokens', { method: 'GET' }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'Missing Authorization header');
});

Deno.test('tokens: POST without Authorization → 401', async () => {
  const res = await handler(new Request('http://localhost/tokens', { method: 'POST', body: '{}' }));
  assertEquals(res.status, 401);
});

Deno.test('tokens: DELETE without Authorization → 401', async () => {
  const res = await handler(new Request('http://localhost/tokens/abc', { method: 'DELETE' }));
  assertEquals(res.status, 401);
});

Deno.test.ignore('tokens: POST with valid JWT creates rst_* token', () => {
  // TODO: requires live Supabase + a real test-user JWT to exercise the
  // create / list / revoke loop. See `docs/specs/modules/14-user-api-tokens.md`.
});

Deno.test.ignore('tokens: POST validates scope allowlist', () => {
  // TODO: same — once a JWT is mocked the scope-allowlist branch (400)
  // can be exercised without a live DB.
});
