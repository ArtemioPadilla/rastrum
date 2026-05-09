/**
 * /functions/v1/refresh-taxon-ranges — weekly cron job (#742, M22-range).
 *
 * Calls public.refresh_taxon_ranges() — a SECURITY DEFINER function that
 * rebuilds per-taxon convex-hull range polygons from research-grade
 * observations in the last 5 years (≥10 obs threshold). The submit-time
 * outlier alert in ObservationForm.astro reads from this index via
 * public.taxon_range_distance_km() to flag observations that land far
 * outside their species' known range.
 *
 * v1 source = 'rastrum_proxy' (Rastrum's own data — same Option-A choice
 * as falta-dex). v1.1 will replace this with a curated GBIF ETL that
 * blends authoritative regional ranges in.
 *
 * The aggregate lives in SQL because it's a single CTE+UPSERT — no
 * supabase-js can run it as a multi-statement query. The wrapper is
 * REVOKED FROM PUBLIC and only GRANTed to service_role; this function
 * authenticates with the auto-injected SUPABASE_SERVICE_ROLE_KEY.
 *
 * Schedule via pg_cron (Sundays 04:00 UTC) — see
 * docs/specs/infra/cron-schedules.sql. Cron-only; deployed
 * --no-verify-jwt like recompute-user-stats / award-badges.
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
  const { data, error } = await db.rpc('refresh_taxon_ranges');

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - started,
    taxa_updated: typeof data === 'number' ? data : 0,
  }), {
    headers: { 'content-type': 'application/json' },
  });
});
