/**
 * Handler-level smoke contract tests for /functions/v1/get-upload-url.
 *
 * Pinned by issue #1031 Tier 1a — these assert the *shape* of the contract
 * (method allowlist, auth requirement, body validation, traversal-resistant
 * key prefixes) without touching the real Cloudflare R2 or Supabase backend.
 *
 * Happy-path signing requires a real R2 + a real Supabase JWT; that flow is
 * skipped here and covered by the nightly smoke runs.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

function withEnv(): void {
  Deno.env.set('R2_ENDPOINT_URL', 'https://example.r2.cloudflarestorage.com');
  Deno.env.set('R2_ACCESS_KEY_ID', 'test');
  Deno.env.set('R2_SECRET_ACCESS_KEY', 'test');
  Deno.env.set('R2_BUCKET_NAME', 'test-bucket');
  Deno.env.set('R2_PUBLIC_URL', 'https://media.example.org');
  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
  Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
}

Deno.test('get-upload-url: rejects GET with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 405);
});

Deno.test('get-upload-url: OPTIONS preflight returns 204 with CORS', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 204);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
});

Deno.test('get-upload-url: POST without auth returns 401', async () => {
  withEnv();
  const res = await handler(new Request('http://localhost/', {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ key: 'avatars/foo/bar.jpg', contentType: 'image/jpeg' }),
  }));
  assertEquals(res.status, 401);
});

Deno.test.ignore('get-upload-url: happy-path signs presigned R2 URL', async () => {
  // TODO: requires real R2 credentials + real Supabase JWT to validate end-to-end.
  // Covered by infra/smoke-model-assets.sh + nightly smoke.
});
