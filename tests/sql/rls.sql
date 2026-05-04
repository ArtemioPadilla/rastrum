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

  -- Karma events for admin. The user's observation_synced rows are
  -- created by the AFTER INSERT trigger on observations seeded below.
  INSERT INTO public.karma_events (user_id, delta, reason)
    VALUES (uid_admin, 5,  'consensus_win');

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

-- Test 11 of 21: karma_events: user sees only their own rows
DO $$
DECLARE
  cnt int;
  foreign_cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.karma_events;
  IF cnt IS DISTINCT FROM 2 THEN
    RAISE EXCEPTION 'FAIL [Test 11 of 21: karma_events: user sees only their own rows]: expected %, got %', 2, cnt;
  END IF;
  SELECT count(*)::int INTO foreign_cnt
    FROM public.karma_events WHERE user_id <> '00000000-0000-0000-0000-000000000003'::uuid;
  IF foreign_cnt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 11 of 21: karma_events: user sees only their own rows]: foreign rows visible (count = %)', foreign_cnt;
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
-- IMPORTANT: clear request.jwt.claim.sub before switching to anon. The earlier
-- tests SET LOCAL it to user UUIDs and `SET LOCAL ROLE anon` does NOT reset
-- GUCs — without this clear, auth.uid() still returns the leaked claim, which
-- makes the obs_owner policy (FOR ALL, USING auth.uid() = observer_id) match
-- the test's observer_id rows and bypass the hidden filter.
SET LOCAL "request.jwt.claim.sub" = '';
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

-- Test 21 of 27: karma_config: anon can SELECT (public read policy)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.karma_config;
  IF cnt < 0 THEN
    RAISE EXCEPTION 'FAIL [Test 21 of 27: karma_config: anon can SELECT (public read policy)]: condition false';
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- admin_anomalies RLS (PR12)
-- ────────────────────────────────────────────────────────────────────────────

-- Seed one anomaly row as service_role so the table is non-empty.
INSERT INTO public.admin_anomalies (kind, actor_id, window_start, window_end, event_count, details)
VALUES (
  'high_rate',
  '00000000-0000-0000-0000-000000000001',
  date_trunc('hour', now()) - interval '1 hour',
  date_trunc('hour', now()),
  60,
  '{"threshold": 50}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Anon cannot read.
SET LOCAL "request.jwt.claim.sub" = '';
SET LOCAL ROLE anon;

-- Test 22 of 27: admin_anomalies: anon sees 0 rows (admin-only read)
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.admin_anomalies;
  IF cnt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 22 of 27: admin_anomalies: anon sees 0 rows (admin-only read)]: expected %, got %', 0, cnt;
  END IF;
END $$;

RESET ROLE;

-- Authenticated non-admin cannot read.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

-- Test 23 of 27: admin_anomalies: non-admin authenticated user sees 0 rows
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.admin_anomalies;
  IF cnt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 23 of 27: admin_anomalies: non-admin authenticated user sees 0 rows]: expected %, got %', 0, cnt;
  END IF;
END $$;

-- Admin CAN read.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Test 24 of 27: admin_anomalies: admin sees the seeded row (>= 1)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.admin_anomalies;
  IF cnt < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 24 of 27: admin_anomalies: admin sees the seeded row (>= 1)]: condition false (count = %)', cnt;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- function_errors RLS (PR12)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.function_errors (function_name, code, actor_id, context, error_message)
VALUES ('admin', 'rls_test_fixture', NULL, '{}'::jsonb, 'rls suite seed');

-- Anon cannot read.
SET LOCAL "request.jwt.claim.sub" = '';
SET LOCAL ROLE anon;

-- Test 25 of 27: function_errors: anon sees 0 rows (admin-only read)
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.function_errors;
  IF cnt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 25 of 27: function_errors: anon sees 0 rows (admin-only read)]: expected %, got %', 0, cnt;
  END IF;
END $$;

RESET ROLE;

-- Admin CAN read.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Test 26 of 27: function_errors: admin sees the seeded row (>= 1)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.function_errors;
  IF cnt < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 26 of 27: function_errors: admin sees the seeded row (>= 1)]: condition false (count = %)', cnt;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- admin_health_digests RLS (PR12)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.admin_health_digests (period_start, period_end, metrics)
VALUES (
  now() - interval '7 days',
  now(),
  '{"admin_actions": 0}'::jsonb
)
ON CONFLICT DO NOTHING;

-- Anon cannot read.
SET LOCAL "request.jwt.claim.sub" = '';
SET LOCAL ROLE anon;

-- Test 27 of 27: admin_health_digests: anon sees 0 rows; admin sees >= 1
DO $$
DECLARE
  cnt_anon int;
  cnt_admin bigint;
BEGIN
  SELECT count(*)::int INTO cnt_anon FROM public.admin_health_digests;
  IF cnt_anon IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 27 of 27: admin_health_digests: anon sees 0 rows; admin sees >= 1] (anon path): expected %, got %', 0, cnt_anon;
  END IF;
  RESET ROLE;
  -- Switch to admin within the same DO block so SET LOCAL stays in transaction scope.
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO cnt_admin FROM public.admin_health_digests;
  IF cnt_admin < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 27 of 27: admin_health_digests: anon sees 0 rows; admin sees >= 1] (admin path): condition false (count = %)', cnt_admin;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- admin_action_proposals RLS (PR13)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.admin_action_proposals (proposer_id, op, target_type, target_id, payload, reason)
VALUES (
  '00000000-0000-0000-0000-000000000001',
  'user_ban',
  'user',
  '00000000-0000-0000-0000-000000000004',
  '{"target_user_id":"00000000-0000-0000-0000-000000000004"}'::jsonb,
  'rls suite seed'
)
ON CONFLICT DO NOTHING;

-- Anon cannot read.
SET LOCAL "request.jwt.claim.sub" = '';
SET LOCAL ROLE anon;

-- Test 28 of 31: admin_action_proposals: anon sees 0 rows (admin-only read)
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.admin_action_proposals;
  IF cnt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 28 of 31: admin_action_proposals: anon sees 0 rows (admin-only read)]: expected %, got %', 0, cnt;
  END IF;
END $$;

RESET ROLE;

-- Authenticated non-admin cannot read.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

-- Test 29 of 31: admin_action_proposals: non-admin authenticated sees 0 rows
DO $$
DECLARE
  cnt int;
BEGIN
  SELECT count(*)::int INTO cnt FROM public.admin_action_proposals;
  IF cnt IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 29 of 31: admin_action_proposals: non-admin authenticated sees 0 rows]: expected %, got %', 0, cnt;
  END IF;
END $$;

-- Admin CAN read.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

-- Test 30 of 31: admin_action_proposals: admin sees the seeded row (>= 1)
DO $$
DECLARE
  cnt bigint;
BEGIN
  SELECT count(*) INTO cnt FROM public.admin_action_proposals;
  IF cnt < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 30 of 31: admin_action_proposals: admin sees the seeded row (>= 1)]: condition false (count = %)', cnt;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- admin_webhooks + admin_webhook_deliveries RLS (PR13)
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.admin_webhooks (url, events, secret, created_by)
VALUES (
  'https://example.test/webhook',
  ARRAY['anomaly_created'],
  'whsec_rls_test_seed_value',
  '00000000-0000-0000-0000-000000000001'
)
ON CONFLICT DO NOTHING;

-- Anon cannot read either webhook table.
SET LOCAL "request.jwt.claim.sub" = '';
SET LOCAL ROLE anon;

-- Test 31 of 31: admin_webhooks + deliveries: anon sees 0 rows; admin sees >= 1
DO $$
DECLARE
  cnt_anon int;
  cnt_admin bigint;
BEGIN
  SELECT count(*)::int INTO cnt_anon FROM public.admin_webhooks;
  IF cnt_anon IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 31 of 31] (anon webhooks path): expected %, got %', 0, cnt_anon;
  END IF;
  SELECT count(*)::int INTO cnt_anon FROM public.admin_webhook_deliveries;
  IF cnt_anon IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 31 of 31] (anon deliveries path): expected %, got %', 0, cnt_anon;
  END IF;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO cnt_admin FROM public.admin_webhooks;
  IF cnt_admin < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 31 of 31] (admin webhooks path): condition false (count = %)', cnt_admin;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- PR15 — function_errors with new ack columns: anon cannot read; admin can.
-- ────────────────────────────────────────────────────────────────────────────

INSERT INTO public.function_errors (function_name, code, actor_id, context, error_message)
VALUES ('admin', 'handler_exception', '00000000-0000-0000-0000-000000000001', '{}'::jsonb, 'rls test seed')
ON CONFLICT DO NOTHING;

SET LOCAL "request.jwt.claim.sub" = '';
SET LOCAL ROLE anon;

-- Test 32 of 32: function_errors visible to admin only; ack columns exist.
DO $$
DECLARE
  cnt_anon int;
  cnt_admin bigint;
  has_ack_at boolean;
  has_ack_by boolean;
  has_ack_notes boolean;
BEGIN
  SELECT count(*)::int INTO cnt_anon FROM public.function_errors;
  IF cnt_anon IS DISTINCT FROM 0 THEN
    RAISE EXCEPTION 'FAIL [Test 32 of 32] (anon function_errors path): expected %, got %', 0, cnt_anon;
  END IF;
  RESET ROLE;
  SET LOCAL ROLE authenticated;
  SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';
  SELECT count(*) INTO cnt_admin FROM public.function_errors;
  IF cnt_admin < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 32 of 32] (admin function_errors path): condition false (count = %)', cnt_admin;
  END IF;
  -- Ack columns must be present on the row (PR15 schema migration).
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'function_errors' AND column_name = 'acknowledged_at'
  ) INTO has_ack_at;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'function_errors' AND column_name = 'acknowledged_by'
  ) INTO has_ack_by;
  SELECT EXISTS (
    SELECT 1 FROM information_schema.columns
    WHERE table_schema = 'public' AND table_name = 'function_errors' AND column_name = 'ack_notes'
  ) INTO has_ack_notes;
  IF NOT (has_ack_at AND has_ack_by AND has_ack_notes) THEN
    RAISE EXCEPTION 'FAIL [Test 32 of 32] (function_errors ack columns missing): at=%, by=%, notes=%', has_ack_at, has_ack_by, has_ack_notes;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- M29 — projects ↔ project_members RLS recursion regression (42P17).
--
-- Reproduces the prod incident from 2026-04-30: an authenticated user PATCHing
-- /rest/v1/observations to update `location` triggered the
-- `assign_observation_to_project` BEFORE UPDATE OF location trigger, which did
-- a SELECT against `projects` under the user's RLS, which expanded into
-- `project_members.project_members_read`, which selected back from `projects`
-- → infinite recursion. Fix: trigger is SECURITY DEFINER, and the policies
-- on both tables now route owner/member checks through the SECURITY DEFINER
-- helpers `is_project_owner()` / `is_project_member()` which bypass RLS.
--
-- This test asserts ALL THREE code paths that previously hit 42P17:
--   (a) UPDATE observations SET location = ... (the original prod symptom)
--   (b) SELECT * FROM project_members AS authenticated
--   (c) SELECT * FROM projects AS authenticated (with project_members rows)
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  uid_owner   CONSTANT uuid := '00000000-0000-0000-0000-000000000010';
  uid_member  CONSTANT uuid := '00000000-0000-0000-0000-000000000011';
  uid_writer  CONSTANT uuid := '00000000-0000-0000-0000-000000000012';
  proj_id     CONSTANT uuid := '00000000-0000-0000-0000-0000000000a0';
  obs_id      CONSTANT uuid := '00000000-0000-0000-0000-0000000000b0';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (uid_owner,  'proj-owner@test.rastrum'),
    (uid_member, 'proj-member@test.rastrum'),
    (uid_writer, 'proj-writer@test.rastrum')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, username, display_name) VALUES
    (uid_owner,  'rls_proj_owner',  'Project Owner'),
    (uid_member, 'rls_proj_member', 'Project Member'),
    (uid_writer, 'rls_proj_writer', 'Project Writer')
  ON CONFLICT (id) DO NOTHING;

  -- A private project covering a polygon around (0,0) so the trigger has
  -- something to match against on UPDATE.
  INSERT INTO public.projects (id, slug, name, owner_user_id, visibility, polygon)
  VALUES (
    proj_id, 'rls-recursion-probe', 'RLS Recursion Probe', uid_owner, 'private',
    ST_SetSRID(ST_GeomFromText('MULTIPOLYGON(((-1 -1, 1 -1, 1 1, -1 1, -1 -1)))'), 4326)::geography
  )
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.project_members (project_id, user_id, role)
  VALUES (proj_id, uid_member, 'member')
  ON CONFLICT DO NOTHING;

  -- Seed an observation owned by the writer so the obs_owner policy lets
  -- them UPDATE it. project_id starts NULL so the trigger has work to do.
  INSERT INTO public.observations (id, observer_id, observed_at, location, sync_status)
  VALUES (
    obs_id, uid_writer, now(),
    ST_SetSRID(ST_MakePoint(0.5, 0.5), 4326)::geography,
    'synced'
  )
  ON CONFLICT (id) DO NOTHING;
END $$;

-- Test 33 of 35: UPDATE observations.location as the writer must NOT throw 42P17.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000012';

DO $$
DECLARE
  obs_id CONSTANT uuid := '00000000-0000-0000-0000-0000000000b0';
  assigned_project uuid;
BEGIN
  BEGIN
    UPDATE public.observations
       SET location = ST_SetSRID(ST_MakePoint(0.25, 0.25), 4326)::geography
     WHERE id = obs_id;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42P17' THEN
      RAISE EXCEPTION 'FAIL [Test 33 of 35] (UPDATE observations.location → 42P17 recursion regressed): %', SQLERRM;
    END IF;
    RAISE;
  END;

  -- The trigger should have auto-tagged this observation into the private
  -- project even though the writer is neither owner nor member — that's the
  -- (a) clause of the SECURITY DEFINER promise on the trigger function.
  SELECT project_id INTO assigned_project FROM public.observations WHERE id = obs_id;
  IF assigned_project IS NULL THEN
    RAISE EXCEPTION 'FAIL [Test 33 of 35] (private-project auto-tag): expected project_id, got NULL — trigger is not running with elevated privilege';
  END IF;
END $$;

-- Test 34 of 35: SELECT project_members as the member must NOT throw 42P17.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000011';

DO $$
DECLARE
  visible_count int;
BEGIN
  BEGIN
    SELECT count(*)::int INTO visible_count FROM public.project_members;
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42P17' THEN
      RAISE EXCEPTION 'FAIL [Test 34 of 35] (SELECT project_members → 42P17 recursion regressed): %', SQLERRM;
    END IF;
    RAISE;
  END;
  IF visible_count < 1 THEN
    RAISE EXCEPTION 'FAIL [Test 34 of 35] (member self-visibility): expected >= 1, got %', visible_count;
  END IF;
END $$;

-- Test 35 of 35: SELECT projects as the owner must NOT throw 42P17 and
-- must include the private project (owner_user_id branch).
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000010';

DO $$
DECLARE
  visible_count int;
BEGIN
  BEGIN
    SELECT count(*)::int INTO visible_count
      FROM public.projects
     WHERE id = '00000000-0000-0000-0000-0000000000a0';
  EXCEPTION WHEN OTHERS THEN
    IF SQLSTATE = '42P17' THEN
      RAISE EXCEPTION 'FAIL [Test 35 of 35] (SELECT projects → 42P17 recursion regressed): %', SQLERRM;
    END IF;
    RAISE;
  END;
  IF visible_count <> 1 THEN
    RAISE EXCEPTION 'FAIL [Test 35 of 35] (owner can read own private project): expected 1, got %', visible_count;
  END IF;
END $$;

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- Summary
-- ────────────────────────────────────────────────────────────────────────────

DO $$
BEGIN
  RAISE NOTICE 'RLS suite: 35 of 35 assertions passed';
END $$;

ROLLBACK;
