/**
 * Contract smoke tests for enrich-environment Edge Function.
 *
 * Auth model: NONE at the handler layer — the function is deployed with
 * JWT verification enabled, so Supabase's gateway authenticates callers
 * before the handler is invoked. The handler itself only validates
 * method + body. We assert that public contract here.
 *
 * Happy-path (real Supabase + OpenMeteo call) is skipped.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

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

// Happy-path enrichment requires a real Supabase observation row + OpenMeteo
// network access. TODO: integration test.
Deno.test.ignore('enrich-environment: happy path writes lunar + weather', () => {});
