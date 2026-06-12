/**
 * Contract smoke tests for enrich-environment Edge Function.
 *
 * Auth model (in-code, since the edge-layer verify_jwt flag alone only
 * proves *a* valid JWT, not ownership): either a user JWT whose user owns
 * the observation, or an X-Cron-Secret matching CRON_SECRET for
 * server-side callers. Body validation stays first so a malformed request
 * fails fast regardless of credentials.
 *
 * Happy-path (real Supabase + OpenMeteo call) is skipped.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

function withEnv(): void {
  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
  Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
}

Deno.test('enrich-environment: OPTIONS preflight returns 204', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
});

Deno.test('enrich-environment: rejects GET with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('enrich-environment: rejects PUT with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'PUT' }));
  assertEquals(res.status, 405);
});

Deno.test('enrich-environment: malformed JSON body → 400', async () => {
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{not json',
  }));
  assertEquals(res.status, 400);
});

Deno.test('enrich-environment: missing observation_id → 400', async () => {
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({}),
  }));
  assertEquals(res.status, 400);
});

Deno.test('enrich-environment: valid body without auth → 401', async () => {
  withEnv();
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ observation_id: 'a8e3f1f0-0000-4000-8000-000000000000' }),
  }));
  assertEquals(res.status, 401);
});

Deno.test('enrich-environment: wrong cron secret → 403', async () => {
  withEnv();
  Deno.env.set('CRON_SECRET', 'right-secret');
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json', 'x-cron-secret': 'wrong-secret' },
    body: JSON.stringify({ observation_id: 'a8e3f1f0-0000-4000-8000-000000000000' }),
  }));
  assertEquals(res.status, 403);
});

// Happy-path enrichment requires a real Supabase observation row + OpenMeteo
// network access. TODO: integration test.
Deno.test.ignore('enrich-environment: happy path writes lunar + weather', () => {});
