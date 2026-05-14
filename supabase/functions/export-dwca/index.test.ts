/**
 * Handler-level smoke contract tests for /functions/v1/export-dwca.
 *
 * Pinned by issue #1031 Tier 1a — these assert the *shape* of the contract
 * (allowed methods, auth requirement, config requirement) without touching
 * the real Supabase backend or invoking the DwC-A builder.
 *
 * The pure DwC builders (buildMetaXml / buildEmlXml / buildOccurrenceTsv)
 * are exercised by the Vitest suite in src/lib/dwca.test.ts; this file
 * only covers the HTTP shell.
 */
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

function withEnv(): void {
  Deno.env.set('SUPABASE_URL', 'https://example.supabase.co');
  Deno.env.set('SUPABASE_ANON_KEY', 'test-anon-key');
  Deno.env.set('SUPABASE_SERVICE_ROLE_KEY', 'test-service-role-key');
}

function clearEnv(): void {
  Deno.env.delete('SUPABASE_URL');
  Deno.env.delete('SUPABASE_ANON_KEY');
  Deno.env.delete('SUPABASE_SERVICE_ROLE_KEY');
}

Deno.test('export-dwca: rejects PUT with 405', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'PUT' }));
  assertEquals(res.status, 405);
});

Deno.test('export-dwca: OPTIONS preflight returns 200 with CORS', async () => {
  const res = await handler(new Request('http://localhost/', { method: 'OPTIONS' }));
  assertEquals(res.status, 200);
  assertEquals(res.headers.get('access-control-allow-origin'), '*');
});

Deno.test('export-dwca: GET without env returns 500', async () => {
  clearEnv();
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 500);
});

Deno.test('export-dwca: GET without auth returns 401', async () => {
  withEnv();
  const res = await handler(new Request('http://localhost/', { method: 'GET' }));
  assertEquals(res.status, 401);
});

Deno.test.ignore('export-dwca: happy-path returns ZIP with valid eml.xml', async () => {
  // TODO: requires real service-role key + at least one synced observation.
  // Covered by nightly smoke runs against the staging project.
});
