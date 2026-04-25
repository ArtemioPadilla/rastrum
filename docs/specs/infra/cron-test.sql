-- Manually fire both cron jobs once and tail the responses.
-- Apply with: make db-cron-test
--
-- Functions are deployed --no-verify-jwt so no Auth header is needed.

\echo Triggering recompute-streaks…
SELECT net.http_post(
  url     := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/recompute-streaks',
  headers := '{"Content-Type":"application/json"}'::jsonb,
  body    := '{}'::jsonb
) AS streaks_request_id;

\echo Triggering award-badges…
SELECT net.http_post(
  url     := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/award-badges',
  headers := '{"Content-Type":"application/json"}'::jsonb,
  body    := '{}'::jsonb
) AS badges_request_id;

\echo Waiting 3 seconds for responses…
SELECT pg_sleep(3);

\echo Most recent HTTP responses:
SELECT id, status_code, content::text, created
FROM net._http_response
ORDER BY created DESC
LIMIT 5;
