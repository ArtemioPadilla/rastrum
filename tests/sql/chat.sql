-- tests/sql/chat.sql
--
-- Chat function regression tests (M01 chat improvements).
-- Mirrors the style of tests/sql/rls.sql — plain DO blocks with ASSERT.
--
-- Run against the ephemeral Postgres in db-validate.yml after schema apply:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 -f tests/sql/chat.sql
--
-- All work happens inside a transaction that is rolled back at the end,
-- so the schema and any seed rows are scoped to this run.

\set ON_ERROR_STOP on
\timing off

BEGIN;

-- ────────────────────────────────────────────────────────────────────────────
-- Setup: deterministic UUIDs + minimal seed (one observer, one obscured taxon,
-- one obscured observation). Mirrors the rls.sql pattern.
-- ────────────────────────────────────────────────────────────────────────────

DO $$
DECLARE
  uid_owner     CONSTANT uuid := '11111111-1111-1111-1111-000000000001';
  uid_other     CONSTANT uuid := '22222222-2222-2222-2222-000000000002';
  taxon_id      CONSTANT uuid := '33333333-3333-3333-3333-000000000003';
  obs_id        CONSTANT uuid := '44444444-4444-4444-4444-000000000004';
BEGIN
  INSERT INTO auth.users (id, email) VALUES
    (uid_owner, 'owner@test.rastrum'),
    (uid_other, 'other@test.rastrum')
  ON CONFLICT (id) DO NOTHING;

  INSERT INTO public.users (id, username, display_name)
  VALUES
    (uid_owner, 'chat_test_owner', 'Owner'),
    (uid_other, 'chat_test_other', 'Other')
  ON CONFLICT (id) DO UPDATE SET username = EXCLUDED.username;

  INSERT INTO public.taxa (id, scientific_name, canonical_name, kingdom, family, obscure_level)
  VALUES (taxon_id, 'Test sensitivus', 'Test sensitivus', 'Animalia', 'Testidae', '5km')
  ON CONFLICT (id) DO UPDATE SET obscure_level = EXCLUDED.obscure_level;

  INSERT INTO public.observations (
    id, observer_id, primary_taxon_id, observed_at,
    location, location_obscured, obscure_level,
    state_province, sync_status
  )
  VALUES (
    obs_id, uid_owner, taxon_id, '2026-05-01T12:00:00Z',
    ST_SetSRID(ST_MakePoint(-99.13, 19.43), 4326),
    ST_SetSRID(ST_MakePoint(-99.10, 19.40), 4326),
    '5km', 'CDMX', 'synced'
  )
  ON CONFLICT (id) DO NOTHING;
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 1. chat_obs_card returns NULL for unknown id.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT public.chat_obs_card('00000000-0000-0000-0000-000000000000'::uuid) IS NULL,
    'chat_obs_card returned non-NULL for unknown id';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 2. chat_obs_card returns precise coords when caller is the observer.
-- ────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-000000000001';
DO $$
DECLARE
  card jsonb := public.chat_obs_card('44444444-4444-4444-4444-000000000004'::uuid);
BEGIN
  ASSERT card IS NOT NULL, 'card should not be NULL for owner';
  ASSERT (card -> 'fields' ->> 'coords_obscured')::boolean = false,
    'owner-self should see coords_obscured=false';
  ASSERT abs((card -> 'fields' ->> 'lat')::numeric - 19.43) < 0.01,
    'owner-self should see precise lat ~19.43, got '
      || coalesce((card -> 'fields' ->> 'lat'), 'NULL');
END $$;
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- 3. chat_obs_card returns obscured coords for non-observer.
-- ────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-000000000002';
DO $$
DECLARE
  card jsonb := public.chat_obs_card('44444444-4444-4444-4444-000000000004'::uuid);
BEGIN
  ASSERT card IS NOT NULL, 'card should not be NULL for non-observer (RLS allows public read)';
  ASSERT (card -> 'fields' ->> 'coords_obscured')::boolean = true,
    'non-owner should see coords_obscured=true';
  ASSERT abs((card -> 'fields' ->> 'lat')::numeric - 19.40) < 0.01,
    'non-owner should see obscured lat ~19.40, got '
      || coalesce((card -> 'fields' ->> 'lat'), 'NULL');
END $$;
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- 4. chat_self_profile_card refuses other-user lookup.
-- ────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '22222222-2222-2222-2222-000000000002';
DO $$
DECLARE
  card jsonb := public.chat_self_profile_card('11111111-1111-1111-1111-000000000001'::uuid);
BEGIN
  ASSERT card IS NULL,
    'chat_self_profile_card should return NULL when auth.uid() != p_id';
END $$;
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- 5. chat_self_profile_card returns the row when caller IS p_id.
-- ────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-000000000001';
DO $$
DECLARE
  card jsonb := public.chat_self_profile_card('11111111-1111-1111-1111-000000000001'::uuid);
BEGIN
  ASSERT card IS NOT NULL, 'chat_self_profile_card should return a row for self';
  ASSERT (card ->> 'kind') = 'self_profile', 'card.kind must be self_profile';
END $$;
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- 6. Dispatcher routes to the right per-kind function.
-- ────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-000000000001';
DO $$
DECLARE
  card jsonb := public.chat_entity_card('observation', '44444444-4444-4444-4444-000000000004');
BEGIN
  ASSERT (card ->> 'kind') = 'observation', 'dispatcher should route observation';
END $$;
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- 7. Dispatcher returns NULL for unknown kind.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT public.chat_entity_card('not_a_kind', 'anything') IS NULL,
    'dispatcher must return NULL for unknown kind';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 8. Dispatcher swallows invalid uuid for uuid-typed kinds.
-- ────────────────────────────────────────────────────────────────────────────
DO $$
BEGIN
  ASSERT public.chat_entity_card('observation', 'not-a-uuid') IS NULL,
    'dispatcher must return NULL on invalid_text_representation';
END $$;

-- ────────────────────────────────────────────────────────────────────────────
-- 9. chat_find_observations respects owner=me filter.
-- ────────────────────────────────────────────────────────────────────────────
SET LOCAL ROLE authenticated;
SET LOCAL "request.jwt.claim.sub" = '11111111-1111-1111-1111-000000000001';
DO $$
DECLARE
  rows jsonb := public.chat_find_observations('{"owner":"me"}'::jsonb, 10);
BEGIN
  ASSERT jsonb_array_length(rows) >= 1,
    'find_observations(owner=me) should return at least the seeded row';
END $$;
RESET ROLE;

-- ────────────────────────────────────────────────────────────────────────────
-- 10. chat_find_observers returns from community_observers view (no centroid).
-- ────────────────────────────────────────────────────────────────────────────
DO $$
DECLARE
  rows jsonb := public.chat_find_observers('chat_test_owner', 10);
  row jsonb;
BEGIN
  ASSERT rows IS NOT NULL, 'find_observers must return at least an empty array';
  IF jsonb_array_length(rows) > 0 THEN
    row := rows -> 0;
    ASSERT row -> 'centroid' IS NULL, 'find_observers must not leak centroid';
  END IF;
END $$;

ROLLBACK;

\echo 'tests/sql/chat.sql passed'
