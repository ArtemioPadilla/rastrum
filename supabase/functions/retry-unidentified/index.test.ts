/**
 * Contract smoke tests for retry-unidentified Edge Function.
 *
 * Auth model: cron-only — the function is deployed with JWT verification
 * enabled and called from pg_cron via a service-role bearer. The handler
 * itself only checks method + env config; the auth burden is delegated to
 * the gateway. We assert the public method/env contract.
 *
 * Happy-path (real Supabase scan + identify EF fan-out) is skipped.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('retry-unidentified: rejects GET with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('retry-unidentified: rejects DELETE with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'DELETE' }));
  assertEquals(res.status, 405);
});

Deno.test('retry-unidentified: rejects OPTIONS with 405 (no CORS preflight)', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 405);
});

Deno.test('retry-unidentified: POST with missing env → 500', async () => {
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  const res = await handler(new Request('http://localhost/', { method: 'POST' }));
  assertEquals(res.status, 500);
});

// Happy-path scan + identify fan-out requires a real Supabase project with
// unidentified observations. TODO: integration test.
Deno.test.ignore('retry-unidentified: happy path queues identify calls', () => {});
