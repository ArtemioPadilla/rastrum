/**
 * weekly-expert-lottery — Principle of Reciprocity (Fogg ch. 5, p. 108).
 *
 * Runs weekly (Sunday 18:00 UTC via pg_cron).
 * Picks 1 random active validator (≥3 accepted community validations in the
 * last 7 days) and awards them an expert_id_lottery_win karma event plus a
 * notification.
 *
 * Issue #734.
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

  const db = createClient(url, role);

  // -------------------------------------------------------------------------
  // 1. Find active validators: users with ≥3 accepted community validations
  //    in the last 7 days. An "accepted" validation = the identification they
  //    cast ended up on a research-grade observation (is_research_grade=true).
  // -------------------------------------------------------------------------
  const { data: candidates, error: candidateErr } = await db
    .from('identifications')
    .select('validated_by')
    .eq('source', 'human')
    .eq('is_research_grade', true)
    .gte('validated_at', new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString())
    .not('validated_by', 'is', null);

  if (candidateErr) {
    console.error('[expert-lottery] candidate query failed', candidateErr);
    return new Response(JSON.stringify({ error: candidateErr.message }), { status: 500 });
  }

  // Group by user_id, count, filter to ≥3
  const counts: Record<string, number> = {};
  for (const row of candidates ?? []) {
    if (!row.validated_by) continue;
    counts[row.validated_by] = (counts[row.validated_by] ?? 0) + 1;
  }
  const eligible = Object.entries(counts)
    .filter(([, c]) => c >= 3)
    .map(([uid]) => uid);

  if (eligible.length === 0) {
    return new Response(JSON.stringify({ awarded: false, reason: 'no_eligible_validators' }), {
      headers: { 'content-type': 'application/json' },
    });
  }

  // -------------------------------------------------------------------------
  // 2. Pick one at random
  // -------------------------------------------------------------------------
  const winner = eligible[Math.floor(Math.random() * eligible.length)];

  // -------------------------------------------------------------------------
  // 3. Record the lottery win as a karma event
  // -------------------------------------------------------------------------
  const { error: karmaErr } = await db
    .from('karma_events')
    .insert({
      user_id:   winner,
      delta:     0,                // karma-neutral; the prize is the expert ID credit
      reason:    'expert_id_lottery_win',
      // metadata stored in a separate weekly_validator_rewards row below
    });

  if (karmaErr) {
    console.error('[expert-lottery] karma_events insert failed', karmaErr);
    return new Response(JSON.stringify({ error: karmaErr.message }), { status: 500 });
  }

  // -------------------------------------------------------------------------
  // 3b. Record in weekly_validator_rewards ledger
  // -------------------------------------------------------------------------
  await db
    .from('weekly_validator_rewards')
    .insert({
      week_iso:   getIsoWeek(),
      user_id:    winner,
      awarded_at: new Date().toISOString(),
    });

  // -------------------------------------------------------------------------
  // 4. Send an in-app notification
  // -------------------------------------------------------------------------
  await db
    .from('notifications')
    .insert({
      user_id: winner,
      kind:    'expert_id_lottery_win',
      payload: {
        title_es: '¡Ganaste un ID experto gratis! 🎉',
        title_en: 'You won a free expert ID! 🎉',
        body_es:  'Como agradecimiento por tu labor de validación esta semana, te regalamos un ID experto gratuito. Elige una observación tuya para que sea identificada por un experto.',
        body_en:  'As a thank-you for your validation work this week, you have received one free expert ID. Choose one of your observations to have it identified by an expert.',
        cta_url:  '/es/observaciones/?filter=pending',
      },
    });

  return new Response(
    JSON.stringify({ awarded: true, winner, week: getIsoWeek() }),
    { headers: { 'content-type': 'application/json' } },
  );
});

/** Returns the current ISO week string, e.g. "2026-W20". */
function getIsoWeek(): string {
  const d = new Date();
  const thursday = new Date(d);
  thursday.setUTCDate(d.getUTCDate() - (d.getUTCDay() + 6) % 7 + 3);
  const jan4 = new Date(Date.UTC(thursday.getUTCFullYear(), 0, 4));
  const week = Math.ceil(((thursday.getTime() - jan4.getTime()) / 86_400_000 + 1) / 7);
  return `${thursday.getUTCFullYear()}-W${String(week).padStart(2, '0')}`;
}

// rastrum incident 2026-05-16: forced re-upload to recover from a
// Supabase Edge serving-layer drop (function ACTIVE in the control plane
// but 404 at the runtime; `supabase functions deploy` skipped unchanged
// bundles as a silent no-op). Behavior-neutral bundle-hash buster; safe to
// remove once Supabase confirms the platform root cause (support ticket).
;(globalThis as Record<string, unknown>).__rastrumRedeploy = "2026-05-16-serving-layer-recovery";
