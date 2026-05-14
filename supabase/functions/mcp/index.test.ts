import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

// The JSON-RPC dispatcher constructs a service-role supabase client at
// the top of every POST request; pin env before import so the client
// can instantiate.
Deno.env.set('SUPABASE_URL', 'http://localhost:54321');
Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-anon-key');

const { handler } = await import('./index.ts');

const URL = 'http://localhost/functions/v1/mcp';

Deno.test('mcp: OPTIONS → 200', async () => {
  const res = await handler(new Request(URL, { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
});

Deno.test('mcp: PUT → 405 (POST or GET only)', async () => {
  const res = await handler(new Request(URL, { method: 'PUT' }));
  assertEquals(res.status, 405);
});

Deno.test({
  name: 'mcp: POST malformed JSON → -32700 parse error',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: '{not json',
    }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.jsonrpc, '2.0');
    assertEquals(body.error?.code, -32700);
  },
});

Deno.test({
  name: 'mcp: POST initialize (no auth) → 200 with result',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 1, method: 'initialize' }),
    }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.jsonrpc, '2.0');
    assertEquals(body.id, 1);
    assertEquals(typeof body.result?.protocolVersion, 'string');
  },
});

Deno.test({
  name: 'mcp: POST tools/list without token → -32001 auth error',
  sanitizeOps: false,
  sanitizeResources: false,
  async fn() {
    const res = await handler(new Request(URL, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ jsonrpc: '2.0', id: 2, method: 'tools/list' }),
    }));
    assertEquals(res.status, 200);
    const body = await res.json();
    assertEquals(body.error?.code, -32001);
  },
});

// TODO: tools/call happy-path requires a valid rst_ token row in
// user_api_tokens — covered by mcp e2e probes once a real fixture
// exists. Out of scope for Tier 1a.
Deno.test.ignore('mcp: POST tools/call identify_species → 200', () => {});
