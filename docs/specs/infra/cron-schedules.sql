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
--   v5 (2026-04-29): added 'recompute-user-stats-nightly' (08:00 UTC) for M28.
--   v6 (2026-04-29): added 'admin-anomaly-detect-hourly' (every hour at :05)
--                    and 'admin-health-digest-weekly' (Mondays 09:00 UTC)
--                    for PR12 admin observability.
--   v7 (2026-04-29): added 'auto-revoke-expired-roles-daily' (08:15 UTC) and
--                    'expire-stale-proposals-hourly' (every hour at :25)
--                    for PR13 future-proofing.
--   v8 (2026-04-29): added 'reconcile-webhook-deliveries' (every 2 min) for
--                    PR14 — writes back async pg_net status_code into
--                    admin_webhook_deliveries and recomputes
--                    consecutive_failures.
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
      headers := ('{"Content-Type":"application/json","X-Cron-Secret":"' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret') || '"}')::jsonb,
      body    := '{}'::jsonb
    );
  $body$, v_base || '/recompute-streaks'));

  -- 2. badges-nightly — 07:30 UTC
  PERFORM cron.unschedule('badges-nightly') FROM cron.job WHERE jobname = 'badges-nightly';
  PERFORM cron.schedule('badges-nightly', '30 7 * * *', format($body$
    SELECT net.http_post(
      url     := %L,
      headers := ('{"Content-Type":"application/json","X-Cron-Secret":"' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret') || '"}')::jsonb,
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
      headers := ('{"Content-Type":"application/json","X-Cron-Secret":"' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret') || '"}')::jsonb,
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
      headers := ('{"Content-Type":"application/json","X-Cron-Secret":"' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret') || '"}')::jsonb,
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

  -- 6. recompute-user-stats-nightly — 08:00 UTC (M28)
  --    Recomputes denormalized counters (species_count, obs_count_7d,
  --    obs_count_30d), centroid_geog, and backfills country_code from
  --    region_primary via normalize_country_code(). Scheduled at 08:00
  --    UTC — after the 07:00/07:30 streaks/badges cluster so the per-user
  --    fields they read aren't being rewritten mid-run.
  PERFORM cron.unschedule('recompute-user-stats-nightly')
    FROM cron.job WHERE jobname = 'recompute-user-stats-nightly';
  PERFORM cron.schedule('recompute-user-stats-nightly', '0 8 * * *', format($body$
    SELECT net.http_post(
      url     := %L,
      headers := ('{"Content-Type":"application/json","X-Cron-Secret":"' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret') || '"}')::jsonb,
      body    := '{}'::jsonb
    );
  $body$, v_base || '/recompute-user-stats'));

  -- 7. admin-anomaly-detect-hourly — every hour at :05 (PR12)
  --    Scans the prior hour's admin_audit rows for high-rate / bulk-delete /
  --    off-hours signals and inserts into admin_anomalies. Idempotent on
  --    (kind, actor_id, window_start) so re-firing the same hour is a no-op.
  PERFORM cron.unschedule('admin-anomaly-detect-hourly')
    FROM cron.job WHERE jobname = 'admin-anomaly-detect-hourly';
  PERFORM cron.schedule(
    'admin-anomaly-detect-hourly',
    '5 * * * *',
    $$ SELECT public.detect_admin_anomalies(); $$
  );

  -- 8. admin-health-digest-weekly — Mondays at 09:00 UTC (PR12)
  --    Aggregates a 7-day platform-health snapshot into admin_health_digests.
  --    ON CONFLICT DO NOTHING on (period_start, period_end) makes manual
  --    re-runs safe.
  PERFORM cron.unschedule('admin-health-digest-weekly')
    FROM cron.job WHERE jobname = 'admin-health-digest-weekly';
  PERFORM cron.schedule(
    'admin-health-digest-weekly',
    '0 9 * * 1',
    $$ SELECT public.compute_admin_health_digest(); $$
  );

  -- 9. auto-revoke-expired-roles-daily — 08:15 UTC (PR13)
  --    Soft-revokes any user_roles row past its expires_at and writes
  --    one admin_audit row per revoke (op='role_revoke',
  --    auto_revoke_reason='expired'). Runs after the 07:30 badges and
  --    08:00 user-stats jobs so denormalised flags don't churn mid-run.
  PERFORM cron.unschedule('auto-revoke-expired-roles-daily')
    FROM cron.job WHERE jobname = 'auto-revoke-expired-roles-daily';
  PERFORM cron.schedule(
    'auto-revoke-expired-roles-daily',
    '15 8 * * *',
    $$ SELECT public.auto_revoke_expired_roles(); $$
  );

  -- 10. expire-stale-proposals-hourly — every hour at :25 (PR13)
  --     Flips admin_action_proposals rows to status='expired' once
  --     their 24-hour window lapses without an approve/reject.
  PERFORM cron.unschedule('expire-stale-proposals-hourly')
    FROM cron.job WHERE jobname = 'expire-stale-proposals-hourly';
  PERFORM cron.schedule(
    'expire-stale-proposals-hourly',
    '25 * * * *',
    $$ SELECT public.expire_stale_proposals(); $$
  );

  -- 11. reconcile-webhook-deliveries — every 2 minutes (PR14)
  --     pg_net.http_post is fire-and-forget; the response lands in
  --     net._http_response asynchronously. This cron writes the
  --     resolved status_code back into admin_webhook_deliveries and
  --     recomputes the parent webhook's consecutive_failures counter
  --     so the circuit breaker can do its job. Idempotent — rows
  --     with a non-NULL status_code are skipped.
  PERFORM cron.unschedule('reconcile-webhook-deliveries')
    FROM cron.job WHERE jobname = 'reconcile-webhook-deliveries';
  PERFORM cron.schedule(
    'reconcile-webhook-deliveries',
    '*/2 * * * *',
    $$ SELECT public.reconcile_webhook_deliveries(); $$
  );

  RAISE NOTICE '✓ Cron schedules applied';
END
$migration$;

SELECT jobid, jobname, schedule, active
FROM cron.job
WHERE jobname IN ('streaks-nightly', 'badges-nightly', 'plantnet-quota-daily',
                  'streak-push-nightly', 'refresh-taxon-rarity-nightly',
                  'recompute-user-stats-nightly',
                  'admin-anomaly-detect-hourly', 'admin-health-digest-weekly',
                  'auto-revoke-expired-roles-daily', 'expire-stale-proposals-hourly',
                  'reconcile-webhook-deliveries')
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
-- Module 27 — AI Sponsorships cron jobs
-- ============================================================

SELECT cron.unschedule('ai_rate_limits_cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai_rate_limits_cleanup');
SELECT cron.schedule('ai_rate_limits_cleanup', '17 3 * * *',
  $$DELETE FROM public.ai_rate_limits WHERE bucket < now() - interval '24 hours'$$);

SELECT cron.unschedule('ai_usage_monthly_rollup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai_usage_monthly_rollup');
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

SELECT cron.unschedule('ai_credentials_heartbeat')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai_credentials_heartbeat');
SELECT cron.schedule('ai_credentials_heartbeat', '0 4 * * 0',
  $$SELECT net.http_post(
    url := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/sponsorships/heartbeat',
    headers := jsonb_build_object('Authorization', 'Bearer ' || (SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sponsorships_cron_token' LIMIT 1))
  )$$);

SELECT cron.unschedule('ai_notifications_monthly_reset')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai_notifications_monthly_reset');
SELECT cron.schedule('ai_notifications_monthly_reset', '5 0 1 * *',
  $$DELETE FROM public.notifications_sent WHERE year_month < date_trunc('month', now())::date$$);

SELECT cron.unschedule('ai_errors_log_cleanup')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'ai_errors_log_cleanup');
SELECT cron.schedule('ai_errors_log_cleanup', '23 3 * * *',
  $$DELETE FROM public.ai_errors_log WHERE occurred_at < now() - interval '30 days'$$);

-- ─────────────────────────────────────────────────────────────────
-- M32 — sponsor_pools.monthly_reset (#153)
-- First-of-month at 00:05 UTC: reset `used` to 0 + flip exhausted →
-- active for any pool with monthly_reset = true. Idempotent —
-- pools without the flag are untouched.
-- ─────────────────────────────────────────────────────────────────
SELECT cron.unschedule('sponsor_pools_monthly_reset')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'sponsor_pools_monthly_reset');
SELECT cron.schedule('sponsor_pools_monthly_reset', '5 0 1 * *',
  $$UPDATE public.sponsor_pools
       SET used = 0,
           status = CASE WHEN status = 'exhausted' THEN 'active' ELSE status END,
           updated_at = now()
     WHERE monthly_reset = true
       AND status IN ('active','exhausted')$$);

-- ─────────────────────────────────────────────────────────────────
-- M32 — pool_consumption vacuum (#154)
-- Daily at 03:30 UTC: drop rows older than 90 days. The daily-cap
-- check in `consume_pool_slot()` only consults `day = current_date`,
-- so older rows are pure dead weight.
-- ─────────────────────────────────────────────────────────────────
SELECT cron.unschedule('pool_consumption_vacuum')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'pool_consumption_vacuum');
SELECT cron.schedule('pool_consumption_vacuum', '30 3 * * *',
  $$DELETE FROM public.pool_consumption WHERE day < current_date - 90$$);

-- ─────────────────────────────────────────────────────────────────
-- M32 — Vertex AI access-token expiry monitor (#159)
-- Every 10 min: notify the sponsor if any vertex_ai credential's
-- stored access token expires within the next 5 minutes. A no-op if
-- the credential is already covered by the auto-rotation work
-- (#155); operator should disable this cron once #155 lands.
-- ─────────────────────────────────────────────────────────────────
SELECT cron.unschedule('vertex_token_expiry_monitor')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'vertex_token_expiry_monitor');
SELECT cron.schedule('vertex_token_expiry_monitor', '*/10 * * * *',
  $$INSERT INTO public.notifications (user_id, kind, payload)
    SELECT c.user_id, 'vertex_token_expiring',
           jsonb_build_object(
             'credential_id', c.id,
             'label', c.label,
             'expires_at', c.token_expires_at,
             'minutes_left', EXTRACT(EPOCH FROM (c.token_expires_at - now())) / 60
           )
      FROM public.sponsor_credentials c
     WHERE c.kind = 'vertex_ai'
       AND c.revoked_at IS NULL
       AND c.token_expires_at IS NOT NULL
       AND c.token_expires_at < now() + interval '5 minutes'
       AND c.token_expires_at > now()
       AND NOT EXISTS (
         SELECT 1 FROM public.notifications n
          WHERE n.user_id = c.user_id
            AND n.kind = 'vertex_token_expiring'
            AND n.payload->>'credential_id' = c.id::text
            AND n.created_at > now() - interval '15 minutes'
       )$$);

-- ─────────────────────────────────────────────────────────────────
-- v9 (2026-04-30): added 'gc-orphan-media' (Sundays 04:30 UTC)
--   for #163 — R2 GC for soft-deleted media + orphan blobs.
--   Token stored in vault under 'gc_orphan_media_cron_token'.
-- ─────────────────────────────────────────────────────────────────
SELECT cron.unschedule('gc_orphan_media')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'gc_orphan_media');
SELECT cron.schedule('gc_orphan_media', '30 4 * * 0',
  $$SELECT net.http_post(
    url := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/gc-orphan-media',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || (
        SELECT decrypted_secret
          FROM vault.decrypted_secrets
         WHERE name = 'gc_orphan_media_cron_token'
         LIMIT 1
      )
    )
  )$$);

-- ─────────────────────────────────────────────────────────────────
-- v10 (2026-05-03): added 'retry-unidentified' (every 30 min)
--   Finds synced observations without any identification and
--   re-queues the identify cascade for each. Cost 0 to schedule —
--   identify itself selects cheapest available provider. Caps at
--   20 observations per run to avoid thundering herd.
--   Deployed --no-verify-jwt (cron-only).
-- ─────────────────────────────────────────────────────────────────
SELECT cron.unschedule('retry-unidentified')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'retry-unidentified');
SELECT cron.schedule('retry-unidentified', '*/30 * * * *',
  $$SELECT net.http_post(
    url     := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/retry-unidentified',
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  )$$);

-- ─────────────────────────────────────────────────────────────────
-- v11 (2026-05-03): M-Loc-1 — 'refresh-place-stats' (every hour at :45)
--   Recomputes denormalized obs_count, species_count, observer_count,
--   first_obs_at, last_obs_at on public.places from synced observations
--   that have a place_id. Runs at :45 to avoid the :05/:25 cluster.
-- ─────────────────────────────────────────────────────────────────
SELECT cron.unschedule('refresh-place-stats')
  WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'refresh-place-stats');
SELECT cron.schedule(
  'refresh-place-stats',
  '45 * * * *',
  $$
  UPDATE public.places p
     SET obs_count      = s.obs_count,
         species_count  = s.species_count,
         observer_count = s.observer_count,
         first_obs_at   = s.first_obs_at,
         last_obs_at    = s.last_obs_at,
         updated_at     = now()
    FROM (
      SELECT place_id,
             COUNT(*)                        AS obs_count,
             COUNT(DISTINCT primary_taxon_id) AS species_count,
             COUNT(DISTINCT observer_id)      AS observer_count,
             MIN(observed_at)                 AS first_obs_at,
             MAX(observed_at)                 AS last_obs_at
        FROM public.observations
       WHERE sync_status = 'synced'
         AND place_id IS NOT NULL
       GROUP BY place_id
    ) s
   WHERE p.id = s.place_id;
  $$
);
