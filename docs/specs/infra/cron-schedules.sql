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
