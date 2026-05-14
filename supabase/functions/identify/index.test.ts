import { assertEquals, assert } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

const URL = 'http://localhost/functions/v1/identify';

Deno.test('identify: GET → 405 (POST-only)', async () => {
  const res = await handler(new Request(URL, { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('identify: OPTIONS → 204 (CORS preflight)', async () => {
  const res = await handler(new Request(URL, { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
  assert(res.headers.get('access-control-allow-methods')?.includes('POST'));
});

Deno.test('identify: POST with malformed JSON → 400', async () => {
  const res = await handler(new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer fake' },
    body: '{not json',
  }));
  assertEquals(res.status, 400);
});

Deno.test('identify: POST missing observation_id/image → 400', async () => {
  const res = await handler(new Request(URL, {
    method: 'POST',
    headers: { 'content-type': 'application/json', authorization: 'Bearer fake' },
    body: JSON.stringify({}),
  }));
  assertEquals(res.status, 400);
});

// TODO: happy-path (cascade success) requires a real PlantNet/Claude/supabase
// stub — out of scope for Tier 1a smoke. Covered by vision-providers-smoke
// nightly probe + the existing _shared/vision-provider.test.ts unit tests.
Deno.test.ignore('identify: happy path → 200 with cascade_attempts', () => {});
