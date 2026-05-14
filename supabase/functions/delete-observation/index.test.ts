/**
 * Contract smoke tests for delete-observation Edge Function.
 *
 * Auth model: requires a Supabase JWT (Authorization: Bearer …); the
 * function validates the JWT, looks up the observation, refuses unless
 * the caller is the observer. POST-only.
 *
 * These tests assert response-shape contracts without touching Supabase
 * or R2. Happy-path (real JWT + obs lookup + R2 delete) is skipped.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

// Stub env vars so the config preflight doesn't short-circuit to 500
// before we get to the contract checks we actually care about.
const STUB_ENV: Record<string, string> = {
  R2_ENDPOINT_URL: 'https://example.r2.cloudflarestorage.com',
  R2_ACCESS_KEY_ID: 'stub',
  R2_SECRET_ACCESS_KEY: 'stub',
  R2_BUCKET_NAME: 'stub-bucket',
  SUPABASE_URL: 'https://stub.supabase.co',
  SUPABASE_ANON_KEY: 'stub-anon',
  SUPABASE_SERVICE_ROLE_KEY: 'stub-role',
};

function stubEnv(): void {
  for (const [k, v] of Object.entries(STUB_ENV)) Deno.env.set(k, v);
}

Deno.test('delete-observation: OPTIONS preflight returns 204', async () => {
  stubEnv();
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
});

Deno.test('delete-observation: rejects GET with 405', async () => {
  stubEnv();
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('delete-observation: rejects DELETE with 405', async () => {
  stubEnv();
  const res = await handler(new Request('http://localhost/', { method: 'DELETE' }));
  assertEquals(res.status, 405);
});

Deno.test('delete-observation: POST without Authorization → 401', async () => {
  stubEnv();
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ observation_id: 'x' }),
  }));
  assertEquals(res.status, 401);
});

// Happy-path delete (valid JWT + observation lookup + R2 delete) requires a
// real Supabase project and a real R2 bucket. TODO: integration test.
Deno.test.ignore('delete-observation: happy path deletes obs + R2 blobs', () => {});
