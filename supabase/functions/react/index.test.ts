import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('react: rejects GET with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error, 'method_not_allowed');
});

Deno.test('react: OPTIONS returns CORS preflight ok', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});

Deno.test('react: missing Authorization returns 401', async () => {
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    body: JSON.stringify({ target: 'observation', kind: 'fave', target_id: 'x' }),
  }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'no_jwt');
});

Deno.test('react: non-Bearer Authorization returns 401', async () => {
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { Authorization: 'Token abc' },
    body: JSON.stringify({ target: 'observation', kind: 'fave', target_id: 'x' }),
  }));
  assertEquals(res.status, 401);
});

Deno.test.ignore('react: happy-path requires supabase reachability', async () => {
  // TODO: cover target/kind validation, idempotent toggle, and rate-limit
  // once we have a supabase-js test double.
});
