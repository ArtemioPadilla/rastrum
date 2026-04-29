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

  -- Console (module 24 — admin/moderator/expert)
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'user_roles')             THEN missing := array_append(missing, 'public.user_roles'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_tables WHERE schemaname = 'public' AND tablename = 'admin_audit')            THEN missing := array_append(missing, 'public.admin_audit'); END IF;

  -- Functions used by RLS predicates and Edge Functions
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'has_role')             THEN missing := array_append(missing, 'public.has_role()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'recompute_consensus')  THEN missing := array_append(missing, 'public.recompute_consensus()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'handle_new_user')      THEN missing := array_append(missing, 'public.handle_new_user()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'list_admin_cron_runs')         THEN missing := array_append(missing, 'public.list_admin_cron_runs()'); END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_proc WHERE proname = 'list_admin_cron_runs_guarded') THEN missing := array_append(missing, 'public.list_admin_cron_runs_guarded()'); END IF;

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
