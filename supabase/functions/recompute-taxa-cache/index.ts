/**
 * /functions/v1/recompute-taxa-cache — nightly cron (issue #803).
 *
 * Pre-computes probable_taxa suggestions for all geohash5 cells that have
 * at least one observation, writing results to public.probable_taxa_cache.
 * The RPC `recompute_probable_taxa_cache()` does the heavy lifting in SQL
 * (SECURITY DEFINER, service_role only).
 *
 * Schedule: daily at 03:00 UTC — after recompute-user-stats (02:00 UTC).
 * Deployed with --no-verify-jwt (cron-only, no user auth needed).
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { requireCronSecret } from '../_shared/cron-auth.ts';

serve(async (req) => {
  const denied = requireCronSecret(req);
  if (denied) return denied;

  const url  = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !role) return new Response('Function not configured', { status: 500 });

  const db = createClient(url, role, { auth: { persistSession: false } });

  const started = Date.now();
  const { data, error } = await db.rpc('recompute_probable_taxa_cache');

  if (error) {
    return new Response(JSON.stringify({ ok: false, error: error.message }), {
      status: 500,
      headers: { 'content-type': 'application/json' },
    });
  }

  return new Response(JSON.stringify({
    ok: true,
    elapsed_ms: Date.now() - started,
    rows_upserted: typeof data === 'number' ? data : 0,
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
