import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('report: rejects GET with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error, 'method_not_allowed');
});

Deno.test('report: OPTIONS returns CORS preflight ok', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});

Deno.test('report: missing Authorization returns 401', async () => {
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    body: JSON.stringify({ target: 'user', reason: 'spam', target_id: 'x' }),
  }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'no_jwt');
});

Deno.test('report: non-Bearer Authorization returns 401', async () => {
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { Authorization: 'Basic xyz' },
    body: JSON.stringify({ target: 'user', reason: 'spam', target_id: 'x' }),
  }));
  assertEquals(res.status, 401);
});

Deno.test.ignore('report: happy-path requires supabase reachability', async () => {
  // TODO: cover target/reason validation, rate-limit, and Resend operator email
  // once we have a supabase-js test double.
});
