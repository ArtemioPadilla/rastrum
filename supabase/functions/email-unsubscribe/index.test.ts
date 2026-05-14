import { assertEquals, assertStringIncludes } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('email-unsubscribe: missing token + uid returns 400 HTML', async () => {
  const res = await handler(new Request('http://localhost/'));
  assertEquals(res.status, 400);
  assertEquals(res.headers.get('content-type'), 'text/html; charset=utf-8');
  const body = await res.text();
  assertStringIncludes(body, 'Invalid');
});

Deno.test('email-unsubscribe: only uid (missing token) returns 400 HTML', async () => {
  const res = await handler(new Request('http://localhost/?uid=00000000-0000-0000-0000-000000000000'));
  assertEquals(res.status, 400);
  const body = await res.text();
  assertStringIncludes(body, 'Invalid');
});

Deno.test('email-unsubscribe: only token (missing uid) returns 400 HTML', async () => {
  const res = await handler(new Request('http://localhost/?token=deadbeef'));
  assertEquals(res.status, 400);
});

Deno.test('email-unsubscribe: lang=es renders Spanish error page', async () => {
  const res = await handler(new Request('http://localhost/?lang=es'));
  assertEquals(res.status, 400);
  const body = await res.text();
  assertStringIncludes(body, 'inválido');
});

Deno.test.ignore('email-unsubscribe: valid HMAC flow requires supabase reachability', async () => {
  // TODO: cover valid-token success (302 redirect), invalid-HMAC (403),
  // and DB-error (500) once we have a supabase-js test double + secret injection.
});
