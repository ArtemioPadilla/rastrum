import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

const URL = 'http://localhost/functions/v1/admin';

Deno.test('admin: GET → 405 (POST-only)', async () => {
  const res = await handler(new Request(URL, { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('admin: OPTIONS → 200 (CORS preflight)', async () => {
  const res = await handler(new Request(URL, { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
});

Deno.test('admin: malformed JSON → 400', async () => {
  const res = await handler(new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: '{bad',
  }));
  assertEquals(res.status, 400);
  const body = await res.json();
  assertEquals(body.error, 'invalid json');
});

Deno.test('admin: missing action → 400', async () => {
  const res = await handler(new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ reason: 'because tests are good' }),
  }));
  assertEquals(res.status, 400);
});

Deno.test('admin: missing reason → 400', async () => {
  const res = await handler(new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'role.grant' }),
  }));
  assertEquals(res.status, 400);
});

Deno.test('admin: unknown action → 400', async () => {
  const res = await handler(new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ action: 'nope.fake', reason: 'because tests are good' }),
  }));
  assertEquals(res.status, 400);
});

// TODO: missing-auth + role-gate tests require supabase env + a JWT —
// dispatcher constructs a real client before auth check. Covered by
// admin/_shared/rate-limit.test.ts (existing) and the e2e admin runbook.
Deno.test.ignore('admin: missing Authorization → 401', () => {});
