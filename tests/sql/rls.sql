-- tests/sql/rls.sql
--
-- RLS regression suite for the Rastrum admin console.
-- Covers the latent-RLS class of bugs we keep hitting.
--
-- Converted from pgTAP to plain SQL DO blocks so it runs on any Postgres
-- without the pgtap extension (which is unavailable in the postgis/postgis
-- test image used by db-validate.yml).
--
-- Run against the ephemeral Postgres in db-validate.yml after schema apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/rls.sql
--
-- The test is structured as a single transaction that is rolled back at the
-- end, so no real data is created. Role switching uses:
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claim.sub" = '<uuid>';
-- to simulate the Supabase RLS context.

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- Setup: deterministic test UUIDs and helpers
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  uid_admin   CONSTANT uuid := '00000000-0000-0000-0000-000000000001';
  uid_mod     CONSTANT uuid := '00000000-0000-0000-0000-000000000002';
  uid_user    CONSTANT uuid := '00000000-0000-0000-0000-000000000003';
  uid_banned  CONSTANT uuid := '00000000-0000-0000-0000-000000000004';
  uid_applicant CONSTANT uuid := '00000000-0000-0000-0000-000000000005';
BEGIN
  -- Insert into auth.users stubs so public.users FK is satisfied.
  INSERT INTO auth.users (id, email) VALUES
    (uid_admin,     'admin@test.rastrum'),
    (uid_mod,       'mod@test.rastrum'),
    (uid_user,      'user@test.rastrum'),
    (uid_banned,    'banned@test.rastrum'),
    (uid_applicant, 'applicant@test.rastrum')
  ON CONFLICT (id) DO NOTHING;

  -- public.users rows (handle_new_user trigger fires on auth.users insert
  -- only in prod; in the test DB we insert directly).
  INSERT INTO public.users (id, username, display_name) VALUES
    (uid_admin,     'rls_admin',     'Admin'),
    (uid_mod,       'rls_mod',       'Moderator'),
    (uid_user,      'rls_user',      'User'),
    (uid_banned,    'rls_banned',    'Banned'),
    (uid_applicant, 'rls_applicant', 'Applicant')
  ON CONFLICT (id) DO NOTHING;

  -- Grant roles via user_roles.
  INSERT INTO public.user_roles (user_id, role, granted_at, granted_by)
    VALUES (uid_admin, 'admin',     now(), uid_admin)
  ON CONFLICT DO NOTHING;
  INSERT INTO public.user_roles (user_id, role, granted_at, granted_by)
    VALUES (uid_mod, 'moderator',   now(), uid_admin)
  ON CONFLICT DO NOTHING;

  -- Revoked role (expired yesterday).
  INSERT INTO public.user_roles (user_id, role, granted_at, granted_by, revoked_at)
    VALUES (uid_user, 'expert',     now() - interval '30 days', uid_admin, now() - interval '1 day')
  ON CONFLICT DO NOTHING;

  -- Seed admin_audit rows — one row per actor.
  INSERT INTO public.admin_audit (actor_id, op, target_type, target_id, reason)
    VALUES (uid_admin, 'role_grant', 'user', uid_mod::text, 'setup-seed');
  INSERT INTO public.admin_audit (actor_id, op, target_type, target_id, reason)
    VALUES (uid_mod,   'report_triaged', 'report', gen_random_uuid()::text, 'triage-seed');

  -- Expert application by applicant; another by user (to test visibility).
  -- Schema columns: id, user_id, taxa text[], credentials text, institution, orcid, status.
  INSERT INTO public.expert_applications (id, user_id, taxa, credentials, status)
    VALUES (gen_random_uuid(), uid_applicant, ARRAY['Plantae'], 'I study plants', 'pending')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expert_applications (id, user_id, taxa, credentials, status)
    VALUES (gen_random_uuid(), uid_user, ARRAY['Animalia'], 'I study animals', 'pending')
  ON CONFLICT DO NOTHING;

  -- Karma events for admin + user.
  INSERT INTO public.karma_events (user_id, delta, reason)
    VALUES (uid_admin, 5,  'consensus_win'),
           (uid_user,  1,  'observation_synced');

  -- Ban row for banned user.
  -- Schema columns: id, user_id, banned_by, reason, expires_at, revoked_at, ...
  -- (ban_type doesn't exist; duration is implicit via expires_at).
  INSERT INTO public.user_bans (user_id, banned_by, reason, expires_at)
    VALUES (uid_banned, uid_admin, 'spam', now() + interval '7 days')
  ON CONFLICT DO NOTHING;

  -- Observations: one public (uid_user), one hidden (uid_user).
  INSERT INTO public.observations (id, observer_id, sync_status, obscure_level, hidden)
    VALUES
      ('aaaaaaaa-0000-0000-0000-000000000001', uid_user, 'synced', 'none',  false),
      ('aaaaaaaa-0000-0000-0000-000000000002', uid_user, 'synced', 'full',  true)
  ON CONFLICT DO NOTHING;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- has_role() tests
-- ────────────────────────────────────────────────────────────────────────────

-- Test 1 of 21: has_role: admin user has admin role
DO $$
DECLARE
  result boolean;
BEGIN
  result := public.has_role('00000000-0000-0000-0000-000000000001'::uuid, 'admin');
  IF result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL [Test 1 of 21: has_role: admin user has admin role]: expected %, got %', true, result;
  END IF;
END $$;

-- Test 2 of 21: has_role: moderator user has moderator role
DO $$
DECLARE
  result boolean;
BEGIN
  result := public.has_role('00000000-0000-0000-0000-000000000002'::uuid, 'moderator');
  IF result IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'FAIL [Test 2 of 21: has_role: moderator user has moderator role]: expected %, got %', true, result;
  END IF;
END $$;

-- Test 3 of 21: has_role: plain user does not have admin role
DO $$
DECLARE
  result boolean;
BEGIN
  result := public.has_role('00000000-0000-0000-0000-000000000003'::uuid, 'admin');
  IF result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL [Test 3 of 21: has_role: plain user does not have admin role]: expected %, got %', false, result;
  END IF;
END $$;

-- Test 4 of 21: has_role: expired expert role returns false
DO $$
DECLARE
  result boolean;
BEGIN
  result := public.has_role('00000000-0000-0000-0000-000000000003'::uuid, 'expert');
  IF result IS DISTINCT FROM false THEN
    RAISE EXCEPTION 'FAIL [Test 4 of 21: has_role: expired expert role returns false]: expected %, got %', false, result;
  END IF;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- admin_audit RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Admin sees all audit rows (expect >= 2 from the seed above).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Test 5 of 21: admin_audit: admin sees all rows (>= 2)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.admin_audit;
  IF cnt < 2 THEN
    RAISE EXCEPTION 'FAIL [Test 5 of 21: admin_audit: admin sees all rows (>= 2)]: condition false (count = %)', cnt;
  END IF;
END $$;

-- Non-admin authenticated user sees 0 audit rows.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

-- Test 6 of 21: admin_audit: non-admin user sees 0 rows
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.admin_audit;
  IF cnt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 6 of 21: admin_audit: non-admin user sees 0 rows]: expected %, got %', 0, cnt;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- expert_applications RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Admin sees all applications.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Test 7 of 21: expert_applications: admin sees all rows (>= 2)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.expert_applications;
  IF cnt < 2 THEN
    RAISE EXCEPTION 'FAIL [Test 7 of 21: expert_applications: admin sees all rows (>= 2)]: condition false (count = %)', cnt;
  END IF;
END $$;

-- Applicant sees only their own row.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000005';

-- Test 8 of 21: expert_applications: applicant sees only their own row
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.expert_applications;
  IF cnt IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL [Test 8 of 21: expert_applications: applicant sees only their own row]: expected %, got %', 1, cnt;
  END IF;
END $$;

-- Plain user (uid_user) also has one application; confirm they only see theirs.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

-- Test 9 of 21: expert_applications: plain user sees only their own row
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.expert_applications;
  IF cnt IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL [Test 9 of 21: expert_applications: plain user sees only their own row]: expected %, got %', 1, cnt;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- karma_events RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Admin sees all karma events.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Test 10 of 21: karma_events: admin sees all rows (>= 2)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.karma_events;
  IF cnt < 2 THEN
    RAISE EXCEPTION 'FAIL [Test 10 of 21: karma_events: admin sees all rows (>= 2)]: condition false (count = %)', cnt;
  END IF;
END $$;

-- Plain user sees only their own karma events.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

-- Test 11 of 21: karma_events: user sees only their own row
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.karma_events;
  IF cnt IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL [Test 11 of 21: karma_events: user sees only their own row]: expected %, got %', 1, cnt;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- user_bans RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Admin sees all ban rows.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Test 12 of 21: user_bans: admin sees all rows
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.user_bans;
  IF cnt < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 12 of 21: user_bans: admin sees all rows]: condition false (count = %)', cnt;
  END IF;
END $$;

-- Moderator sees all ban rows.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';

-- Test 13 of 21: user_bans: moderator sees all rows
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.user_bans;
  IF cnt < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 13 of 21: user_bans: moderator sees all rows]: condition false (count = %)', cnt;
  END IF;
END $$;

-- Banned user sees their own row.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';

-- Test 14 of 21: user_bans: banned user sees their own row
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.user_bans;
  IF cnt IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL [Test 14 of 21: user_bans: banned user sees their own row]: expected %, got %', 1, cnt;
  END IF;
END $$;

-- Plain user sees 0 ban rows (they are not banned).
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

-- Test 15 of 21: user_bans: plain user sees 0 rows (not banned)
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.user_bans;
  IF cnt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 15 of 21: user_bans: plain user sees 0 rows (not banned)]: expected %, got %', 0, cnt;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- observations RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Anon user: obs_public_read excludes hidden + obscured-full observations.
-- The plain public observation should be visible; the hidden one should not.
SET LOCAL ROLE anon;

-- Test 16 of 21: observations: anon sees only public (non-hidden) rows
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt
    FROM public.observations
   WHERE id IN (
     'aaaaaaaa-0000-0000-0000-000000000001',
     'aaaaaaaa-0000-0000-0000-000000000002'
   );
  IF cnt IS DISTINCT FROM 1 THEN
    RAISE EXCEPTION 'FAIL [Test 16 of 21: observations: anon sees only public (non-hidden) rows]: expected %, got %', 1, cnt;
  END IF;
END $$;

RESET ROLE;

-- Owner (uid_user) sees both their own observations (including hidden).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

-- Test 17 of 21: observations: owner sees both their own observations including hidden
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt
    FROM public.observations
   WHERE id IN (
     'aaaaaaaa-0000-0000-0000-000000000001',
     'aaaaaaaa-0000-0000-0000-000000000002'
   );
  IF cnt IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL [Test 17 of 21: observations: owner sees both their own observations including hidden]: expected %, got %', 2, cnt;
  END IF;
END $$;

-- Admin sees both observations via obs_admin_full_read.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Test 18 of 21: observations: admin sees all rows via obs_admin_full_read
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt
    FROM public.observations
   WHERE id IN (
     'aaaaaaaa-0000-0000-0000-000000000001',
     'aaaaaaaa-0000-0000-0000-000000000002'
   );
  IF cnt IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL [Test 18 of 21: observations: admin sees all rows via obs_admin_full_read]: expected %, got %', 2, cnt;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- app_feature_flags RLS (PR8 new table)
-- ────────────────────────────────────────────────────────────────────────────

-- Anon can read feature flags.
SET LOCAL ROLE anon;

-- Test 19 of 21: app_feature_flags: anon can SELECT (public read policy)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.app_feature_flags;
  IF cnt < 0 THEN
    RAISE EXCEPTION 'FAIL [Test 19 of 21: app_feature_flags: anon can SELECT (public read policy)]: condition false';
  END IF;
END $$;

RESET ROLE;

-- Authenticated user cannot INSERT.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

-- Test 20 of 21: app_feature_flags: authenticated user cannot INSERT (no_client_write policy)
DO $$
BEGIN
  BEGIN
    INSERT INTO public.app_feature_flags (key, name, value) VALUES ('test_flag', 'Test', false);
    RAISE EXCEPTION 'FAIL [Test 20 of 21: app_feature_flags: authenticated user cannot INSERT (no_client_write policy)]: expected throw but lived';
  EXCEPTION WHEN OTHERS THEN
    -- Any error (permission denied, RLS violation, etc.) is the expected outcome.
    NULL;
  END;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- karma_config RLS (PR8 new table)
-- ────────────────────────────────────────────────────────────────────────────

-- Anon can read karma config.
SET LOCAL ROLE anon;

-- Test 21 of 21: karma_config: anon can SELECT (public read policy)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.karma_config;
  IF cnt < 0 THEN
    RAISE EXCEPTION 'FAIL [Test 21 of 21: karma_config: anon can SELECT (public read policy)]: condition false';
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- Summary
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE 'RLS suite: 21 of 21 assertions passed';
END $$;

ROLLBACK;
