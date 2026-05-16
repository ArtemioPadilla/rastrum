/**
 * /functions/v1/recompute-streaks — nightly cron job.
 *
 * Calls the public.recompute_streak() SQL function for every user who's
 * opted into gamification. Cheap on small populations; switch to a paged
 * scan when MAU > 100K.
 *
 * Schedule via Supabase pg_cron:
 *   SELECT cron.schedule('streaks-nightly', '5 7 * * *',
 *     $$ SELECT net.http_post(
 *          url := 'https://<project>.supabase.co/functions/v1/recompute-streaks',
 *          headers := '{"Authorization":"Bearer <anon>"}'::jsonb
 *        ) $$);
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

  const db = createClient(url, role);
  const { data: users } = await db
    .from('users')
    .select('id')
    .eq('gamification_opt_in', true);

  let processed = 0;
  for (const u of users ?? []) {
    const { error } = await db.rpc('recompute_streak', { p_user_id: u.id });
    if (!error) processed++;
  }
  return new Response(JSON.stringify({ processed, total: users?.length ?? 0 }), {
    headers: { 'content-type': 'application/json' },
  });
});

// rastrum incident 2026-05-16: forced re-upload to recover from a
// Supabase Edge serving-layer drop (function ACTIVE in the control plane
// but 404 at the runtime; `supabase functions deploy` skipped unchanged
// bundles as a silent no-op). Behavior-neutral bundle-hash buster; safe to
// remove once Supabase confirms the platform root cause (support ticket).
;(globalThis as Record<string, unknown>).__rastrumRedeploy = "2026-05-16-serving-layer-recovery";
