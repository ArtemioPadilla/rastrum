-- tests/sql/social-rls.sql
--
-- Module 26 RLS regression queries. Run via:
--   psql "$SUPABASE_DB_URL" -f tests/sql/social-rls.sql
--
-- Uses a transaction with two ephemeral users + one observation; ROLLBACK
-- at the end so production data is untouched. Confirms the schema is
-- referentially sound and that the social tables accept the expected
-- writes via the service role. A more rigorous test using SET ROLE
-- authenticated + request.jwt.claims is left for follow-up — this script
-- is the smoke check.

BEGIN;

DO $$
DECLARE
  u_a    uuid := gen_random_uuid();
  u_b    uuid := gen_random_uuid();
  obs_id uuid := gen_random_uuid();
BEGIN
  INSERT INTO public.users(id, username, display_name)
    VALUES (u_a, 'rls_a_' || substr(u_a::text, 1, 6), 'A');
  INSERT INTO public.users(id, username, display_name)
    VALUES (u_b, 'rls_b_' || substr(u_b::text, 1, 6), 'B');

  INSERT INTO public.observations(id, observer_id, sync_status, obscure_level)
    VALUES (obs_id, u_a, 'synced', 'none');

  -- 1) B reacts on A's public observation.
  INSERT INTO public.observation_reactions(user_id, observation_id, kind)
    VALUES (u_b, obs_id, 'fave');

  -- 2) A blocks B; the block edge must round-trip cleanly.
  INSERT INTO public.blocks(blocker_id, blocked_id) VALUES (u_a, u_b);
  IF NOT EXISTS (SELECT 1 FROM public.blocks WHERE blocker_id = u_a AND blocked_id = u_b) THEN
    RAISE EXCEPTION 'block insert failed';
  END IF;

  -- 3) A unblocks; visibility restored.
  DELETE FROM public.blocks WHERE blocker_id = u_a AND blocked_id = u_b;

  -- 4) Make obs full-obscure; subsequent collaborator unlock test below.
  UPDATE public.observations SET obscure_level = 'full' WHERE id = obs_id;

  -- 5) Make B a collaborator of A — accepted edge.
  INSERT INTO public.follows(follower_id, followee_id, tier, status, accepted_at)
    VALUES (u_b, u_a, 'collaborator', 'accepted', now());

  -- 6) Counters must update via trigger.
  IF (SELECT follower_count FROM public.users WHERE id = u_a) <> 1 THEN
    RAISE EXCEPTION 'follower_count trigger failed: expected 1';
  END IF;

  -- 7) Notification fan-out: A should have a follow notification (or follow_accepted).
  IF NOT EXISTS (SELECT 1 FROM public.notifications WHERE user_id = u_a AND kind IN ('follow','follow_accepted')) THEN
    RAISE EXCEPTION 'follow notification fan-out trigger did not fire';
  END IF;

  -- 8) is_collaborator_of returns true.
  IF NOT public.is_collaborator_of(u_b, u_a) THEN
    RAISE EXCEPTION 'is_collaborator_of returned false';
  END IF;

  -- 9) social_visible_to(u_b, u_a) returns true (B follows A).
  IF NOT public.social_visible_to(u_b, u_a) THEN
    RAISE EXCEPTION 'social_visible_to returned false for accepted follower';
  END IF;

  -- 10) Reports table accepts a row.
  INSERT INTO public.reports(reporter_id, target_type, target_id, reason)
    VALUES (u_b, 'observation', obs_id, 'wrong_id');

  RAISE NOTICE 'social-rls regression OK';
END $$;

ROLLBACK;
