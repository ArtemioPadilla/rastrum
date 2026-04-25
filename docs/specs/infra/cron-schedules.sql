-- Rastrum cron schedules.
--
-- Apply with: make db-cron-schedule  (after editing the placeholder below)
-- Idempotent: drops the existing schedule by name before re-creating.
--
-- IMPORTANT: replace <YOUR_PUBLISHABLE_KEY> below with your project's
-- publishable / anon API key (Settings → API Keys → 'publishable' /
-- legacy 'anon public'). NOT the service_role key.

-- Required extensions (already on every Supabase project, but make it explicit)
CREATE EXTENSION IF NOT EXISTS pg_cron;
CREATE EXTENSION IF NOT EXISTS pg_net;

-- Drop any existing schedule first (lets us re-run idempotently)
SELECT cron.unschedule('streaks-nightly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'streaks-nightly'
);
SELECT cron.unschedule('badges-nightly') WHERE EXISTS (
  SELECT 1 FROM cron.job WHERE jobname = 'badges-nightly'
);

-- 1. Streaks: recompute every night at 07:00 UTC (~01:00 Mexico City)
SELECT cron.schedule(
  'streaks-nightly',
  '0 7 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/recompute-streaks',
    headers := '{
      "Authorization": "Bearer <YOUR_PUBLISHABLE_KEY>",
      "Content-Type": "application/json"
    }'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- 2. Badges: evaluate every night at 07:30 UTC
SELECT cron.schedule(
  'badges-nightly',
  '30 7 * * *',
  $$
  SELECT net.http_post(
    url     := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/award-badges',
    headers := '{
      "Authorization": "Bearer <YOUR_PUBLISHABLE_KEY>",
      "Content-Type": "application/json"
    }'::jsonb,
    body    := '{}'::jsonb
  );
  $$
);

-- Verify
SELECT jobid, jobname, schedule, active FROM cron.job
WHERE jobname IN ('streaks-nightly', 'badges-nightly');
