/**
 * /functions/v1/recompute-user-stats — nightly cron job (M28).
 *
 * Calls public.recompute_user_stats() — a SECURITY DEFINER function that
 * runs a single CTE+UPDATE recomputing denormalized counters
 * (species_count, obs_count_7d, obs_count_30d), the user's centroid_geog,
 * and backfills country_code from region_primary via
 * normalize_country_code() for users where country_code is currently NULL.
 *
 * The aggregate lives in SQL because supabase-js can't run multi-statement
 * CTE+UPDATE; the wrapper is GRANTed to service_role only, and this
 * function authenticates with the auto-injected SUPABASE_SERVICE_ROLE_KEY.
 *
 * Schedule via pg_cron — see docs/specs/infra/cron-schedules.sql.
 * Cron-only; deployed --no-verify-jwt like recompute-streaks/award-badges.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

serve(async () => {
  const url = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !role) return new Response('Function not configured', { status: 500 });

  const db = createClient(url, role, { auth: { persistSession: false } });

  const started = Date.now();
  const { data, error } = await db.rpc('recompute_user_stats');

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - started,
    rows_updated: typeof data === 'number' ? data : 0,
  }), {
    headers: { 'content-type': 'application/json' },
  });
});
