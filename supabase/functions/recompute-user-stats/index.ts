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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireCronSecret } from '../_shared/cron-auth.ts';

serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

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

  // #713 — Refresh materialized views after the user-stats recompute so
  // profile pages can query pre-computed aggregates instead of live COUNTs.
  // REFRESH MATERIALIZED VIEW CONCURRENTLY requires the unique indexes on
  // each MV (created in supabase-schema.sql under #713).
  const mvResults: Record<string, string> = {};
  for (const mv of ['mv_user_observation_counts', 'mv_recent_species'] as const) {
    const { error: mvErr } = await db.rpc('refresh_materialized_view_safely', { view_name: mv })
      // Fallback: execute raw SQL if the helper RPC isn't available yet
      .catch(() => db.from('_dummy_nonexistent').select());
    if (mvErr) {
      // Non-fatal: log but continue. Next cron run will retry.
      console.warn(`[recompute-user-stats] REFRESH MV ${mv} failed:`, mvErr.message);
      mvResults[mv] = `error: ${mvErr.message}`;
    } else {
      mvResults[mv] = 'ok';
    }
  }

  return new Response(JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - started,
    rows_updated: typeof data === 'number' ? data : 0,
    materialized_views: mvResults,
  }), {
    headers: { 'content-type': 'application/json' },
  });
});

// rastrum incident 2026-05-16: forced re-upload to recover from a
// Supabase Edge serving-layer drop (function ACTIVE in the control plane
// but 404 at the runtime; `supabase functions deploy` skipped unchanged
// bundles as a silent no-op). Behavior-neutral bundle-hash buster; safe to
// remove once Supabase confirms the platform root cause (support ticket).
;(globalThis as Record<string, unknown>).__rastrumRedeploy = "2026-05-16-serving-layer-recovery";
