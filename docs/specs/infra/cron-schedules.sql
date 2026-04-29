-- ════════════════════════════════════════════════════════════════════════
-- Rastrum cron schedules
-- ════════════════════════════════════════════════════════════════════════
-- Apply with:  make db-cron-schedule  (idempotent)
--
-- Calls the recompute-streaks and award-badges Edge Functions, which are
-- deployed with `--no-verify-jwt` so cron doesn't need to pass an Auth
-- header. Internal access control happens inside each function via the
-- auto-injected SUPABASE_SERVICE_ROLE_KEY.
--
-- Both functions are cron-only and not user-facing — there's nothing for
-- an external caller to gain by hitting the URL. If we ever expose them
-- to users, flip them back to verify_jwt = true and re-add the Bearer
-- header in this file.
--
-- ── Schedule registry ──────────────────────────────────────────────────
--   v1 (2026-04-25): initial 'streaks-nightly' (07:00 UTC) and
--                    'badges-nightly' (07:30 UTC). Bearer header.
--   v2 (2026-04-25): functions redeployed --no-verify-jwt; header dropped.
--   v3 (2026-04-27): added 'plantnet-quota-daily' (23:55 UTC) and
--                    'streak-push-nightly' (01:55 UTC ≈ 19:55 America/Mexico_City).
--   v4 (2026-04-27): added 'refresh-taxon-rarity-nightly' (03:00 UTC).
-- ════════════════════════════════════════════════════════════════════════

CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

DO $migration$
DECLARE
  v_base text := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1';
BEGIN
  -- 1. streaks-nightly — 07:00 UTC
  PERFORM cron.unschedule('streaks-nightly') FROM cron.job WHERE jobname = 'streaks-nightly';
  PERFORM cron.schedule('streaks-nightly', '0 7 * * *', format($body$
    SELECT net.http_post(
      url     := %L,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $body$, v_base || '/recompute-streaks'));

  -- 2. badges-nightly — 07:30 UTC
  PERFORM cron.unschedule('badges-nightly') FROM cron.job WHERE jobname = 'badges-nightly';
  PERFORM cron.schedule('badges-nightly', '30 7 * * *', format($body$
    SELECT net.http_post(
      url     := %L,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $body$, v_base || '/award-badges'));

  -- 3. plantnet-quota-daily — 23:55 UTC
  --    Probes PlantNet's /v2/usage endpoint and upserts api_usage. Optional
  --    Slack/Discord webhook fires inside the function when usage > 80%.
  PERFORM cron.unschedule('plantnet-quota-daily') FROM cron.job WHERE jobname = 'plantnet-quota-daily';
  PERFORM cron.schedule('plantnet-quota-daily', '55 23 * * *', format($body$
    SELECT net.http_post(
      url     := %L,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $body$, v_base || '/plantnet-monitor'));

  -- 4. streak-push-nightly — 01:55 UTC (≈ 19:55 America/Mexico_City UTC-6)
  --    v1.0.x scope: single timezone fixed to America/Mexico_City. When
  --    we add a per-user `tz` column the EF will branch off it instead;
  --    keep the cron at 01:55 UTC so it fires once before the 8 PM bell.
  PERFORM cron.unschedule('streak-push-nightly') FROM cron.job WHERE jobname = 'streak-push-nightly';
  PERFORM cron.schedule('streak-push-nightly', '55 1 * * *', format($body$
    SELECT net.http_post(
      url     := %L,
      headers := '{"Content-Type":"application/json"}'::jsonb,
      body    := '{}'::jsonb
    );
  $body$, v_base || '/streak-push'));

  -- 5. refresh-taxon-rarity-nightly — 03:00 UTC
  --    Calls public.refresh_taxon_rarity() to recompute rarity scores from
  --    current observation counts. Runs before streak jobs so badges that
  --    depend on rarity thresholds see fresh values.
  PERFORM cron.unschedule('refresh-taxon-rarity-nightly') FROM cron.job WHERE jobname = 'refresh-taxon-rarity-nightly';
  PERFORM cron.schedule(
    'refresh-taxon-rarity-nightly',
    '0 3 * * *',
    $$ SELECT public.refresh_taxon_rarity(); $$
  );

  RAISE NOTICE '✓ Cron schedules applied';
END
$migration$;

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('streaks-nightly', 'badges-nightly', 'plantnet-quota-daily', 'streak-push-nightly', 'refresh-taxon-rarity-nightly')
ORDER BY jobname;

-- m26: prune read notifications older than 90 days, daily at 04:30 UTC.
SELECT cron.unschedule('prune_old_notifications')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'prune_old_notifications');
SELECT cron.schedule(
  'prune_old_notifications',
  '30 4 * * *',
  $$ SELECT public.prune_old_notifications(); $$
);

-- ============================================================
-- Module 20 — AI Sponsorships cron jobs
-- ============================================================

SELECT cron.unschedule('ai_rate_limits_cleanup');
SELECT cron.schedule('ai_rate_limits_cleanup', '17 3 * * *',
  $$DELETE FROM public.ai_rate_limits WHERE bucket < now() - interval '24 hours'$$);

SELECT cron.unschedule('ai_usage_monthly_rollup');
SELECT cron.schedule('ai_usage_monthly_rollup', '23 0 * * *',
  $$INSERT INTO public.ai_usage_monthly (sponsorship_id, year_month, calls, tokens_in, tokens_out)
    SELECT sponsorship_id, date_trunc('month', occurred_at)::date,
           count(*), sum(tokens_in), sum(tokens_out)
    FROM   public.ai_usage
    WHERE  occurred_at >= date_trunc('day', now() - interval '1 day')
      AND  occurred_at <  date_trunc('day', now())
    GROUP  BY 1, 2
    ON CONFLICT (sponsorship_id, year_month) DO UPDATE
      SET calls      = ai_usage_monthly.calls      + EXCLUDED.calls,
          tokens_in  = COALESCE(ai_usage_monthly.tokens_in,  0) + COALESCE(EXCLUDED.tokens_in,  0),
          tokens_out = COALESCE(ai_usage_monthly.tokens_out, 0) + COALESCE(EXCLUDED.tokens_out, 0)$$);

SELECT cron.unschedule('ai_credentials_heartbeat');
SELECT cron.schedule('ai_credentials_heartbeat', '0 4 * * 0',
  $$SELECT net.http_post(
    url := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/sponsorships/heartbeat',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_token'))
  )$$);

SELECT cron.unschedule('ai_notifications_monthly_reset');
SELECT cron.schedule('ai_notifications_monthly_reset', '5 0 1 * *',
  $$DELETE FROM public.notifications_sent WHERE year_month < date_trunc('month', now())::date$$);

SELECT cron.unschedule('ai_errors_log_cleanup');
SELECT cron.schedule('ai_errors_log_cleanup', '23 3 * * *',
  $$DELETE FROM public.ai_errors_log WHERE occurred_at < now() - interval '30 days'$$);
