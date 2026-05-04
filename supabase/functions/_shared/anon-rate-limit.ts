/**
 * Persistent anonymous rate-limit (#581).
 *
 * Replaces the V8 globalThis.__identifyRateMap which reset on every cold
 * start, after every deploy, and was per-isolate (so multiple concurrent
 * isolates each had their own counter). Persisted in Postgres via
 * `public.anon_rate_limit` table; cleanup runs via pg_cron.
 *
 * Usage in an EF:
 *
 *   import { checkAnonRateLimit } from '../_shared/anon-rate-limit.ts';
 *   const ok = await checkAnonRateLimit(db(), ip, 'identify', 10, 3600);
 *   if (!ok) return rateLimited();
 */

/**
 * Minimal structural type so this file doesn't pull the supabase-js URL
 * import into the tsc graph (vitest tests in tests/unit/ import this
 * helper directly, and tsc would fail to resolve the URL specifier).
 * The full SupabaseClient passes structurally.
 */
interface RateLimitQuery {
  eq(col: string, val: string): RateLimitQuery;
  gte(col: string, val: string): RateLimitQuery;
  then<T>(cb: (v: { count?: number | null; error: { message: string } | null }) => T): Promise<T>;
}
interface MinimalSupabaseClient {
  from(table: string): {
    select(cols: string, opts?: { count?: string; head?: boolean }): RateLimitQuery;
    insert(row: { ip: string; endpoint: string }): Promise<{ error: { message: string } | null }>;
  };
}
export type SupabaseClient = MinimalSupabaseClient;

/**
 * Check whether the given IP is within its window quota for the endpoint.
 * Atomic read+insert pattern (two round-trips) — acceptable on the unauth
 * path where traffic is small. Returns true when the call is allowed and
 * inserts a row; returns false to deny.
 *
 * @param db          Service-role Supabase client (bypasses RLS).
 * @param ip          Caller IP (cf-connecting-ip / x-forwarded-for).
 * @param endpoint    Endpoint identifier (e.g. 'identify'). Allows the
 *                    table to be reused for other rate-limited surfaces.
 * @param limit       Max calls allowed within the window.
 * @param windowSec   Window size in seconds (e.g. 3600 = 1 hour).
 */
export async function checkAnonRateLimit(
  db: SupabaseClient,
  ip: string,
  endpoint: string,
  limit: number,
  windowSec: number,
): Promise<boolean> {
  const since = new Date(Date.now() - windowSec * 1000).toISOString();
  const { count, error } = await db
    .from('anon_rate_limit')
    .select('ip', { count: 'exact', head: true })
    .eq('ip', ip)
    .eq('endpoint', endpoint)
    .gte('ts', since);
  if (error) {
    console.warn('[anon-rate-limit] read failed, failing open:', error.message);
    return true;
  }
  if ((count ?? 0) >= limit) return false;
  const { error: insErr } = await db.from('anon_rate_limit').insert({ ip, endpoint });
  if (insErr) {
    console.warn('[anon-rate-limit] insert failed:', insErr.message);
  }
  return true;
}
