import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('follow: rejects GET with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
  const body = await res.json();
  assertEquals(body.error, 'method_not_allowed');
});

Deno.test('follow: OPTIONS returns CORS preflight ok', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('Access-Control-Allow-Methods'), 'POST, OPTIONS');
});

Deno.test('follow: missing Authorization returns 401', async () => {
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    body: JSON.stringify({ action: 'follow', target_user_id: 'x' }),
  }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'no_jwt');
});

Deno.test('follow: non-Bearer Authorization returns 401', async () => {
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { Authorization: 'Basic foo' },
    body: JSON.stringify({ action: 'follow' }),
  }));
  assertEquals(res.status, 401);
  const body = await res.json();
  assertEquals(body.error, 'no_jwt');
});

Deno.test.ignore('follow: happy-path requires supabase reachability', async () => {
  // TODO: cover follow/unfollow/accept/reject + rate-limit + profile-privacy gating
  // once we have a supabase-js test double.
});
