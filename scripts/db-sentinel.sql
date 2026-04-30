-- ════════════════════════════════════════════════════════════════════════
-- Sentinel verify — single source of truth for both db-apply.yml (production
-- post-apply check) and db-validate.yml (per-PR pre-merge check).
--
-- Asserts that critical tables and functions exist after a schema apply.
-- If any are missing the script raises an exception, which fails the calling
-- workflow step. Catches partial-apply states (e.g. when an apply errored
-- mid-stream and only some objects landed).
--
-- When you add a new module, register its load-bearing tables/functions
-- here so a regression in that module's schema gets caught.
-- ════════════════════════════════════════════════════════════════════════

DO $$
DECLARE
  missing text[] := ARRAY[]::text[];
BEGIN
  -- array_append() instead of `missing || 'literal'` because Postgres
  -- can't disambiguate text[] || text vs text[] || text[] when the LHS
  -- is empty, and tries to parse the literal as an array literal,
  -- failing with "malformed array literal".

  -- Auth + core (every module depends on these)
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'users')              THEN missing := array_append(missing, 'public.users'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'observations')       THEN missing := array_append(missing, 'public.observations'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'taxa')               THEN missing := array_append(missing, 'public.taxa'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'identifications')    THEN missing := array_append(missing, 'public.identifications'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'media_files')        THEN missing := array_append(missing, 'public.media_files'); END IF;

  -- Gamification (module 08)
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'badges')             THEN missing := array_append(missing, 'public.badges'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_badges')        THEN missing := array_append(missing, 'public.user_badges'); END IF;

  -- Social graph (module 26 — follows/reactions/blocks/reports). The
  -- `comments` table is planned in PR #63 (m26 v2) — add to this list
  -- once that PR lands.
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'follows')                THEN missing := array_append(missing, 'public.follows'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'watchlists')             THEN missing := array_append(missing, 'public.watchlists'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'observation_reactions')  THEN missing := array_append(missing, 'public.observation_reactions'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'identification_reactions') THEN missing := array_append(missing, 'public.identification_reactions'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'blocks')                 THEN missing := array_append(missing, 'public.blocks'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'reports')                THEN missing := array_append(missing, 'public.reports'); END IF;

  -- Expert track (module 22 + 23)
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'expert_applications')    THEN missing := array_append(missing, 'public.expert_applications'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'karma_events')          THEN missing := array_append(missing, 'public.karma_events'); END IF;

  -- Console (module 24 — admin/moderator/expert)
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_roles')             THEN missing := array_append(missing, 'public.user_roles'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_audit')            THEN missing := array_append(missing, 'public.admin_audit'); END IF;

  -- Console PR5 — moderator surface
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_bans')              THEN missing := array_append(missing, 'public.user_bans'); END IF;

  -- PR10 — subject UX: ban appeals
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'ban_appeals')            THEN missing := array_append(missing, 'public.ban_appeals'); END IF;

  -- PR11 — durable admin rate limit buckets (admin Edge Function dispatcher)
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'rate_limit_buckets')     THEN missing := array_append(missing, 'public.rate_limit_buckets'); END IF;

  -- PR12 — admin observability (anomalies, weekly health digest, function-error sink)
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_anomalies')        THEN missing := array_append(missing, 'public.admin_anomalies'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_health_digests')   THEN missing := array_append(missing, 'public.admin_health_digests'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'function_errors')        THEN missing := array_append(missing, 'public.function_errors'); END IF;

  -- PR13 — future-proofing (expiring roles, two-person rule, webhooks, trust scores)
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_action_proposals')    THEN missing := array_append(missing, 'public.admin_action_proposals'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_webhooks')            THEN missing := array_append(missing, 'public.admin_webhooks'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_webhook_deliveries')  THEN missing := array_append(missing, 'public.admin_webhook_deliveries'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'user_roles'
      AND column_name  = 'expires_at'
  ) THEN missing := array_append(missing, 'public.user_roles.expires_at'); END IF;

  -- PR14 — deferred cleanups (per-admin tz, webhook replay protection)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'users'
      AND column_name  = 'timezone'
  ) THEN missing := array_append(missing, 'public.users.timezone'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'admin_webhook_deliveries'
      AND column_name  = 'nonce'
  ) THEN missing := array_append(missing, 'public.admin_webhook_deliveries.nonce'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'admin_webhook_deliveries'
      AND column_name  = 'request_id'
  ) THEN missing := array_append(missing, 'public.admin_webhook_deliveries.request_id'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'reconcile_webhook_deliveries')
    THEN missing := array_append(missing, 'public.reconcile_webhook_deliveries()'); END IF;

  -- PR15 — observability UI (function_errors ack columns drive the Errors tab)
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'function_errors'
      AND column_name  = 'acknowledged_at'
  ) THEN missing := array_append(missing, 'public.function_errors.acknowledged_at'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'function_errors'
      AND column_name  = 'acknowledged_by'
  ) THEN missing := array_append(missing, 'public.function_errors.acknowledged_by'); END IF;
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name   = 'function_errors'
      AND column_name  = 'ack_notes'
  ) THEN missing := array_append(missing, 'public.function_errors.ack_notes'); END IF;

  -- Console PR8 — feature flags + karma config DB tables
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'app_feature_flags')      THEN missing := array_append(missing, 'public.app_feature_flags'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'karma_config')           THEN missing := array_append(missing, 'public.karma_config'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'karma_rarity_multipliers') THEN missing := array_append(missing, 'public.karma_rarity_multipliers'); END IF;

  -- Module 26 — observation_comments.locked column added in PR #77
  IF NOT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public'
      AND table_name = 'observation_comments'
      AND column_name = 'locked'
  ) THEN
    missing := array_append(missing, 'public.observation_comments.locked');
  END IF;

  -- Functions used by RLS predicates and Edge Functions
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role')             THEN missing := array_append(missing, 'public.has_role()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'recompute_consensus')  THEN missing := array_append(missing, 'public.recompute_consensus()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user')      THEN missing := array_append(missing, 'public.handle_new_user()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'list_admin_cron_runs')         THEN missing := array_append(missing, 'public.list_admin_cron_runs()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'list_admin_cron_runs_guarded') THEN missing := array_append(missing, 'public.list_admin_cron_runs_guarded()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'is_user_banned')               THEN missing := array_append(missing, 'public.is_user_banned()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'consume_rate_limit_token')    THEN missing := array_append(missing, 'public.consume_rate_limit_token()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'detect_admin_anomalies')      THEN missing := array_append(missing, 'public.detect_admin_anomalies()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'compute_admin_health_digest') THEN missing := array_append(missing, 'public.compute_admin_health_digest()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'auto_revoke_expired_roles')   THEN missing := array_append(missing, 'public.auto_revoke_expired_roles()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'expire_stale_proposals')      THEN missing := array_append(missing, 'public.expire_stale_proposals()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'dispatch_admin_webhooks')     THEN missing := array_append(missing, 'public.dispatch_admin_webhooks()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'compute_moderator_trust_score') THEN missing := array_append(missing, 'public.compute_moderator_trust_score()'); END IF;

  -- Module 28 — Community discovery (Nearby RPCs, both centroid- and GPS-based)
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'community_observers_nearby')    THEN missing := array_append(missing, 'public.community_observers_nearby()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'community_observers_nearby_at') THEN missing := array_append(missing, 'public.community_observers_nearby_at()'); END IF;

  -- PR16 — admin entity browser hot-path indexes. If a future schema
  -- change drops one of these the corresponding admin browser tab silently
  -- regresses to a sequential scan. Sentinel keeps that observable.
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_id_created_desc')              THEN missing := array_append(missing, 'public.idx_id_created_desc'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_notifications_kind_created')   THEN missing := array_append(missing, 'public.idx_notifications_kind_created'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_media_active_created')         THEN missing := array_append(missing, 'public.idx_media_active_created'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_follows_created_desc')         THEN missing := array_append(missing, 'public.idx_follows_created_desc'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_projects_created_desc')        THEN missing := array_append(missing, 'public.idx_projects_created_desc'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_indexes WHERE schemaname = 'public' AND indexname = 'idx_comments_author_created')      THEN missing := array_append(missing, 'public.idx_comments_author_created'); END IF;

  IF array_length(missing, 1) IS NOT NULL THEN
    RAISE EXCEPTION 'Sentinel verify failed — missing objects: %', missing;
  END IF;
END $$;

-- RLS coverage summary (informational; spots tables that lost RLS).
SELECT
  count(*) FILTER (WHERE rowsecurity)     AS tables_with_rls,
  count(*) FILTER (WHERE NOT rowsecurity) AS tables_without_rls,
  count(*)                                AS public_tables_total
FROM pg_tables
WHERE schemaname = 'public';

SELECT 'sentinel ok' AS status;
