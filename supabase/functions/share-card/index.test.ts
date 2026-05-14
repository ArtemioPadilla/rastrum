/**
 * Handler-level smoke contract tests for /functions/v1/share-card.
 *
 * Pinned by issue #1031 Tier 1a — these assert the *shape* of the contract
 * (missing obs_id, OPTIONS preflight, config-required) without touching the
 * real Supabase backend.
 *
 * share-card is a GET-only OG/Twitter-card renderer for public observation
 * sharing — no Bearer JWT required. It returns:
 *   • `text/html`        (default) with OG/Twitter <meta>
 *   • `image/svg+xml`    when ?format=svg
 *   • 404                when the observation is fully obscured (obscure_level='full')
 *
 * The DB-backed rendering paths are skipped here; covered by the e2e
 * locale-neutral share-obs smoke test in tests/e2e/smoke.spec.ts.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

function withEnv(): void {
  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
}

function clearEnv(): void {
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
}

Deno.test('share-card: OPTIONS preflight returns 204 with CORS', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
});

Deno.test('share-card: GET without obs_id returns 400', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 400);
});

Deno.test('share-card: legacy ?id= alias is accepted as obs_id (no 400)', async () => {
  // Both `?obs_id=` and `?id=` are valid; with an id present the 400 branch
  // is skipped and the handler proceeds to env/config validation.
  clearEnv();
  const res = await handler(new Request('http://localhost/?id=00000000-0000-0000-0000-000000000000', { method: 'GET' }));
  assertEquals(res.status, 500);
});

Deno.test('share-card: GET with obs_id but missing env returns 500', async () => {
  clearEnv();
  const res = await handler(new Request('http://localhost/?obs_id=00000000-0000-0000-0000-000000000000', { method: 'GET' }));
  assertEquals(res.status, 500);
});

Deno.test.ignore('share-card: GET with obs_id renders text/html with OG meta', async () => {
  // TODO: requires a seeded observation row. Covered by e2e smoke test
  // tests/e2e/smoke.spec.ts ("share/obs/ is locale-neutral").
  withEnv();
});

Deno.test.ignore('share-card: ?format=svg renders image/svg+xml', async () => {
  // TODO: requires a seeded observation row + working DB.
});
