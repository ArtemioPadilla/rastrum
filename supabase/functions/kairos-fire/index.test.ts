/**
 * Contract smoke tests for kairos-fire Edge Function.
 *
 * Auth model: cron-only — deployed --no-verify-jwt; access gated by the
 * X-Cron-Secret header via the shared requireCronSecret helper. Missing
 * or wrong secret → 403. Missing CRON_SECRET env on the EF side → 500.
 *
 * Happy-path (Web Push fan-out across users + weather + lunar) is skipped.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('kairos-fire: missing X-Cron-Secret → 403', async () => {
  Deno.env.set('CRON_SECRET', 'expected-cron-secret');
  const res = await handler(new Request('http://localhost/', { method: 'POST' }));
  assertEquals(res.status, 403);
});

Deno.test('kairos-fire: wrong X-Cron-Secret → 403', async () => {
  Deno.env.set('CRON_SECRET', 'expected-cron-secret');
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'x-cron-secret': 'wrong' },
  }));
  assertEquals(res.status, 403);
});

Deno.test('kairos-fire: CRON_SECRET unset on EF → 500', async () => {
  Deno.env.delete('CRON_SECRET');
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'x-cron-secret': 'anything' },
  }));
  assertEquals(res.status, 500);
});

Deno.test('kairos-fire: correct secret + missing SUPABASE_URL → 500', async () => {
  Deno.env.set('CRON_SECRET', 'expected-cron-secret');
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'x-cron-secret': 'expected-cron-secret' },
  }));
  assertEquals(res.status, 500);
});

// Happy-path push fan-out requires real Supabase rows + VAPID keys + real
// push endpoints. TODO: integration test.
Deno.test.ignore('kairos-fire: happy path sends kairos pushes', () => {});
