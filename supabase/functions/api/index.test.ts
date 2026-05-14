import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// supabase-js refuses to instantiate with undefined URL/key; the
// dispatcher constructs the client at the top of every request, so
// fixtures here pin both before the import.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-anon-key');

const { handler } = await import('./index.ts');

const URL = 'http://localhost/functions/v1/api/observe';

Deno.test('api: OPTIONS → 200 (CORS preflight)', async () => {
  const res = await handler(new Request(URL, { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
});

Deno.test({
  name: 'api: missing Authorization → 401',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ lat: 0, lng: 0 }),
    }));
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: 'api: non-rst_ token → 401',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request(URL, {
      method: 'POST',
      headers: { authorization: 'Bearer not-an-rst-token', 'content-type': 'application/json' },
      body: JSON.stringify({}),
    }));
    assertEquals(res.status, 401);
  },
});

Deno.test({
  name: 'api: GET without token → 401',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request('http://localhost/functions/v1/api/observations', {
      method: 'GET',
    }));
    assertEquals(res.status, 401);
  },
});

// TODO: happy-path POST /api/observe requires a real supabase fixture
// (valid token row + RLS-passing insert). Out of scope for Tier 1a.
Deno.test.ignore('api: POST /api/observe with valid token → 201', () => {});
