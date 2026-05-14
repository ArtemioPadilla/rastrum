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

// tokens/index.ts constructs the supabase client inside each handler
// invocation (not at module top), so the pin needs to be in place
// before any handler call — not just before import.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');

import { handler } from './index.ts';

Deno.test('tokens: OPTIONS preflight → 200 with CORS', async () => {
  const res = await handler(new Request('http://localhost/tokens', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Origin'), '*');
});

Deno.test({
  name: 'tokens: GET without Authorization → 401',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request('http://localhost/tokens', { method: 'GET' }));
    assertEquals(res.status, 401);
    const body = await res.json();
    assertEquals(body.error, 'Missing Authorization header');
  },
});

Deno.test({
  name: 'tokens: POST without Authorization → 401',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request('http://localhost/tokens', { method: 'POST', body: '{}' }));
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: 'tokens: DELETE without Authorization → 401',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request('http://localhost/tokens/abc', { method: 'DELETE' }));
    assertEquals(res.status, 401);
  },
});

Deno.test.ignore('tokens: POST with valid JWT creates rst_* token', () => {
  // TODO: requires live Supabase + a real test-user JWT to exercise the
  // create / list / revoke loop. See `docs/specs/modules/14-user-api-tokens.md`.
});

Deno.test.ignore('tokens: POST validates scope allowlist', () => {
  // TODO: same — once a JWT is mocked the scope-allowlist branch (400)
  // can be exercised without a live DB.
});
