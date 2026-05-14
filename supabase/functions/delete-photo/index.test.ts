import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// delete-photo checks env vars before auth and returns 500 if any are
// missing — pin all three to local fixtures before import so the
// auth/validation paths are reachable.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-key');

const { handler } = await import('./index.ts');

const URL = 'http://localhost/functions/v1/delete-photo';

Deno.test('delete-photo: GET → 405 (POST-only)', async () => {
  const res = await handler(new Request(URL, { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('delete-photo: OPTIONS → 204 (CORS preflight)', async () => {
  const res = await handler(new Request(URL, { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
});

Deno.test('delete-photo: POST missing Authorization → 401', async () => {
  const res = await handler(new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ observation_id: 'x', media_id: 'y' }),
  }));
  assertEquals(res.status, 401);
});

// TODO: malformed-JSON + missing-fields paths require a valid JWT
// (the handler runs supaUser.auth.getUser() before validation). Without
// a real Supabase to verify against, the getUser() call will reject. A
// proper fixture test belongs in Tier 2; smoke contract here covers the
// pre-auth method + header gates.
Deno.test.ignore('delete-photo: POST with JWT but malformed body → 400', () => {});
