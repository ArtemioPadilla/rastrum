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

  RAISE NOTICE '✓ Cron schedules applied';
END
$migration$;

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('streaks-nightly', 'badges-nightly')
ORDER BY jobname;
