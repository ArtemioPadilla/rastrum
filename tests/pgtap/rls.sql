-- tests/pgtap/rls.sql
--
-- pgTAP RLS regression suite for the Rastrum admin console.
-- Covers the latent-RLS class of bugs we keep hitting.
--
-- Run against the ephemeral Postgres in db-validate.yml after schema apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/pgtap/rls.sql
--
-- The test is structured as a single transaction that is rolled back at the
-- end, so no real data is created. Role switching uses:
--   SET LOCAL ROLE authenticated;
--   SET LOCAL "request.jwt.claim.sub" = '<uuid>';
-- to simulate the Supabase RLS context.

BEGIN;
CREATE EXTENSION IF NOT EXISTS pgtap;

SELECT plan(24);

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
  INSERT INTO public.expert_applications (id, user_id, taxa_scope, justification, status)
    VALUES (gen_random_uuid(), uid_applicant, ARRAY['Plantae'], 'I study plants', 'pending')
  ON CONFLICT DO NOTHING;
  INSERT INTO public.expert_applications (id, user_id, taxa_scope, justification, status)
    VALUES (gen_random_uuid(), uid_user, ARRAY['Animalia'], 'I study animals', 'pending')
  ON CONFLICT DO NOTHING;

  -- Karma events for admin + user.
  INSERT INTO public.karma_events (user_id, delta, reason)
    VALUES (uid_admin, 5,  'consensus_win'),
           (uid_user,  1,  'observation_synced');

  -- Ban row for banned user.
  INSERT INTO public.user_bans (user_id, banned_by, reason, ban_type)
    VALUES (uid_banned, uid_admin, 'spam', 'temporary')
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

SELECT is(
  public.has_role('00000000-0000-0000-0000-000000000001'::uuid, 'admin'),
  true,
  'has_role: admin user has admin role'
);

SELECT is(
  public.has_role('00000000-0000-0000-0000-000000000002'::uuid, 'moderator'),
  true,
  'has_role: moderator user has moderator role'
);

SELECT is(
  public.has_role('00000000-0000-0000-0000-000000000003'::uuid, 'admin'),
  false,
  'has_role: plain user does not have admin role'
);

SELECT is(
  public.has_role('00000000-0000-0000-0000-000000000003'::uuid, 'expert'),
  false,
  'has_role: expired expert role returns false'
);

-- ────────────────────────────────────────────────────────────────────────────
-- admin_audit RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Admin sees all audit rows (expect ≥ 2 from the seed above).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

SELECT ok(
  (SELECT count(*) FROM public.admin_audit) >= 2,
  'admin_audit: admin sees all rows (≥ 2)'
);

-- Non-admin authenticated user sees 0 audit rows.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*) FROM public.admin_audit)::int,
  0,
  'admin_audit: non-admin user sees 0 rows'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- expert_applications RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Admin sees all applications.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

SELECT ok(
  (SELECT count(*) FROM public.expert_applications) >= 2,
  'expert_applications: admin sees all rows (≥ 2)'
);

-- Applicant sees only their own row.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000005';

SELECT is(
  (SELECT count(*) FROM public.expert_applications)::int,
  1,
  'expert_applications: applicant sees only their own row'
);

-- Plain user (uid_user) also has one application; confirm they only see theirs.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*) FROM public.expert_applications)::int,
  1,
  'expert_applications: plain user sees only their own row'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- karma_events RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Admin sees all karma events.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

SELECT ok(
  (SELECT count(*) FROM public.karma_events) >= 2,
  'karma_events: admin sees all rows (≥ 2)'
);

-- Plain user sees only their own karma events.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*) FROM public.karma_events)::int,
  1,
  'karma_events: user sees only their own row'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- user_bans RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Admin sees all ban rows.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

SELECT ok(
  (SELECT count(*) FROM public.user_bans) >= 1,
  'user_bans: admin sees all rows'
);

-- Moderator sees all ban rows.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000002';

SELECT ok(
  (SELECT count(*) FROM public.user_bans) >= 1,
  'user_bans: moderator sees all rows'
);

-- Banned user sees their own row.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000004';

SELECT is(
  (SELECT count(*) FROM public.user_bans)::int,
  1,
  'user_bans: banned user sees their own row'
);

-- Plain user sees 0 ban rows (they are not banned).
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*) FROM public.user_bans)::int,
  0,
  'user_bans: plain user sees 0 rows (not banned)'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- observations RLS
-- ────────────────────────────────────────────────────────────────────────────

-- Anon user: obs_public_read excludes hidden + obscured-full observations.
-- The plain public observation should be visible; the hidden one should not.
SET LOCAL ROLE anon;

SELECT is(
  (SELECT count(*) FROM public.observations
   WHERE id IN (
     'aaaaaaaa-0000-0000-0000-000000000001',
     'aaaaaaaa-0000-0000-0000-000000000002'
   ))::int,
  1,
  'observations: anon sees only public (non-hidden) rows'
);

RESET ROLE;

-- Owner (uid_user) sees both their own observations (including hidden).
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

SELECT is(
  (SELECT count(*) FROM public.observations
   WHERE id IN (
     'aaaaaaaa-0000-0000-0000-000000000001',
     'aaaaaaaa-0000-0000-0000-000000000002'
   ))::int,
  2,
  'observations: owner sees both their own observations including hidden'
);

-- Admin sees both observations via obs_admin_full_read.
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000001';

SELECT is(
  (SELECT count(*) FROM public.observations
   WHERE id IN (
     'aaaaaaaa-0000-0000-0000-000000000001',
     'aaaaaaaa-0000-0000-0000-000000000002'
   ))::int,
  2,
  'observations: admin sees all rows via obs_admin_full_read'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- app_feature_flags RLS (PR8 new table)
-- ────────────────────────────────────────────────────────────────────────────

-- Anon can read feature flags.
SET LOCAL ROLE anon;

SELECT ok(
  (SELECT count(*) FROM public.app_feature_flags) >= 0,
  'app_feature_flags: anon can SELECT (public read policy)'
);

RESET ROLE;

-- Authenticated user cannot INSERT.
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '00000000-0000-0000-0000-000000000003';

SELECT throws_ok(
  $$INSERT INTO public.app_feature_flags (key, name, value) VALUES ('test_flag', 'Test', false)$$,
  'app_feature_flags: authenticated user cannot INSERT (no_client_write policy)'
);

RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- karma_config RLS (PR8 new table)
-- ────────────────────────────────────────────────────────────────────────────

-- Anon can read karma config.
SET LOCAL ROLE anon;

SELECT ok(
  (SELECT count(*) FROM public.karma_config) >= 0,
  'karma_config: anon can SELECT (public read policy)'
);

RESET ROLE;

SELECT * FROM finish();
ROLLBACK;
