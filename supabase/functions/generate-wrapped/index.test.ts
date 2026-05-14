/**
 * Smoke contract tests for `generate-wrapped` Edge Function (#1031 Tier 1a).
 *
 * Pinned behavior:
 *   1. Missing/non-Bearer Authorization → 401.
 *   2. Missing `year` query param → 400.
 *   3. Missing `user_id` query param → 400.
 *   4. Non-numeric year → 400.
 *   5. Year < 2020 → 400.
 *   6. Year > current UTC year → 400 (reused from PR #1051's UTC fix).
 *
 * Happy path requires live Supabase (observations + wrapped_cache);
 * skipped here.
 */

import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { handler } from './index.ts';

Deno.test('generate-wrapped: no Authorization → 401', async () => {
  const res = await handler(new Request('http://localhost/generate-wrapped?year=2024&user_id=abc'));
  assertEquals(res.status, 401);
});

Deno.test('generate-wrapped: non-Bearer Authorization → 401', async () => {
  const res = await handler(new Request('http://localhost/generate-wrapped?year=2024&user_id=abc', {
    headers: { 'Authorization': 'Basic xyz' },
  }));
  assertEquals(res.status, 401);
});

Deno.test('generate-wrapped: missing year → 400', async () => {
  const res = await handler(new Request('http://localhost/generate-wrapped?user_id=abc', {
    headers: { 'Authorization': 'Bearer test' },
  }));
  assertEquals(res.status, 400);
});

Deno.test('generate-wrapped: missing user_id → 400', async () => {
  const res = await handler(new Request('http://localhost/generate-wrapped?year=2024', {
    headers: { 'Authorization': 'Bearer test' },
  }));
  assertEquals(res.status, 400);
});

Deno.test('generate-wrapped: non-numeric year → 400', async () => {
  const res = await handler(new Request('http://localhost/generate-wrapped?year=abc&user_id=abc', {
    headers: { 'Authorization': 'Bearer test' },
  }));
  assertEquals(res.status, 400);
});

Deno.test('generate-wrapped: year < 2020 → 400', async () => {
  const res = await handler(new Request('http://localhost/generate-wrapped?year=2019&user_id=abc', {
    headers: { 'Authorization': 'Bearer test' },
  }));
  assertEquals(res.status, 400);
});

Deno.test('generate-wrapped: year > current UTC year → 400 (PR #1051)', async () => {
  const futureYear = new Date().getUTCFullYear() + 1;
  const res = await handler(new Request(`http://localhost/generate-wrapped?year=${futureYear}&user_id=abc`, {
    headers: { 'Authorization': 'Bearer test' },
  }));
  assertEquals(res.status, 400);
});

Deno.test.ignore('generate-wrapped: valid year + user → fresh payload', () => {
  // TODO: requires live Supabase (observations + wrapped_cache + user_streaks
  // + export_jobs). Out of scope for smoke contract suite.
});
