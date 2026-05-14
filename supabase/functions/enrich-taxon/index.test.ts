/**
 * Contract smoke tests for enrich-taxon Edge Function.
 *
 * Auth model: cron-only — deployed --no-verify-jwt; access gated by the
 * X-Cron-Secret header. The fire-and-forget `identify` EF call also
 * supports a service-role Bearer token, but that's an internal hop.
 * Missing auth → 403.
 *
 * Happy-path (real Supabase + GBIF API) is skipped.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('enrich-taxon: missing X-Cron-Secret → 403', async () => {
  Deno.env.set('CRON_SECRET', 'expected-cron-secret');
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ batch: true }),
  }));
  assertEquals(res.status, 403);
});

Deno.test('enrich-taxon: wrong X-Cron-Secret → 403', async () => {
  Deno.env.set('CRON_SECRET', 'expected-cron-secret');
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cron-secret': 'wrong-secret',
    },
    body: JSON.stringify({ batch: true }),
  }));
  assertEquals(res.status, 403);
});

Deno.test('enrich-taxon: service-role Bearer is accepted as auth', async () => {
  Deno.env.set('CRON_SECRET', 'expected-cron-secret');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-role-key');
  // No SUPABASE_URL → handler bails at "Function not configured" (500),
  // but it gets past the 403 guard, which is what we want to assert.
  Deno.env.delete('SUPABASE_URL');
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'authorization': 'Bearer stub-role-key',
    },
    body: JSON.stringify({ batch: true }),
  }));
  assertEquals(res.status, 500);
});

Deno.test('enrich-taxon: correct cron secret + malformed JSON → 400', async () => {
  Deno.env.set('CRON_SECRET', 'expected-cron-secret');
  Deno.env.set('SUPABASE_URL', 'https://stub.supabase.co');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'stub-role');
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      'x-cron-secret': 'expected-cron-secret',
    },
    body: '{not json',
  }));
  assertEquals(res.status, 400);
});

// Happy-path enrichment requires a real Supabase + GBIF API access.
// TODO: integration test.
Deno.test.ignore('enrich-taxon: happy path enriches lineage', () => {});
