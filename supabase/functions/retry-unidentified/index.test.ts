/**
 * Contract smoke tests for retry-unidentified Edge Function.
 *
 * Auth model: cron-only — deployed --no-verify-jwt (in CRON_ONLY), so the
 * gateway does NOT gate it. The handler self-gates on X-Cron-Secret via
 * requireCronSecret. We assert the method + auth + env contract.
 *
 * Happy-path (real Supabase scan + identify EF fan-out) is skipped.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

const CRON = 'test-cron-secret';
const authedPost = () =>
  new Request('http://localhost/', {
    method: 'POST',
    headers: { 'x-cron-secret': CRON },
  });

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

Deno.test('retry-unidentified: POST without X-Cron-Secret → 403', async () => {
  Deno.env.set('CRON_SECRET', CRON);
  const res = await handler(new Request('http://localhost/', { method: 'POST' }));
  assertEquals(res.status, 403);
});

Deno.test('retry-unidentified: authed POST with missing env → 500', async () => {
  Deno.env.set('CRON_SECRET', CRON);
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  const res = await handler(authedPost());
  assertEquals(res.status, 500);
});

// Happy-path scan + identify fan-out requires a real Supabase project with
// unidentified observations. TODO: integration test.
Deno.test.ignore('retry-unidentified: happy path queues identify calls', () => {});
