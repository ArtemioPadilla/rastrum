/**
 * Handler-level smoke contract tests for /functions/v1/export-trail-pdf.
 *
 * Pinned by issue #1031 Tier 1a — these assert the *shape* of the contract
 * (missing trail_id, CORS preflight, JSON error body) without touching the
 * real Supabase backend.
 *
 * Note: this EF intentionally does NOT gate by method — GET and POST both
 * fall through to the same rendering path. Auth is optional (public trails
 * have no auth; private trails honour Bearer JWT via RLS). The happy path
 * needs a real `trails` row and is covered by nightly smoke.
 */
import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('export-trail-pdf: OPTIONS preflight returns CORS headers', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
});

Deno.test('export-trail-pdf: missing trail_id returns 400 JSON', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 400);
  assertEquals(res.headers.get('content-type'), 'application/json');
  const body = await res.json();
  assertStringIncludes(String(body.error), 'trail_id');
});

Deno.test('export-trail-pdf: empty trail_id query param also returns 400', async () => {
  const res = await handler(new Request('http://localhost/?trail_id=', { method: 'GET' }));
  assertEquals(res.status, 400);
});

Deno.test.ignore('export-trail-pdf: GET with valid trail_id renders HTML field guide', async () => {
  // TODO: requires a seeded `trails` row + working SUPABASE_URL/ANON_KEY.
  // Covered by the e2e journey suite (journey-guides.spec.ts).
});
