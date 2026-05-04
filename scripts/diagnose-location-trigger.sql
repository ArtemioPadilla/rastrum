-- diagnose-location-trigger.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Diagnoses the assign_observation_to_project trigger and related RLS setup
-- to identify why PATCH /observations?id=eq.* → 500 on location update.
--
-- Run with: psql "$SUPABASE_DB_URL" -f scripts/diagnose-location-trigger.sql
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Check trigger exists and is SECURITY DEFINER ───────────────────────
DO $$
DECLARE
  v_security text;
  v_trigger_exists boolean;
BEGIN
  SELECT EXISTS(
    SELECT 1 FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public'
      AND c.relname = 'observations'
      AND t.tgname = 'assign_observation_to_project_trigger'
  ) INTO v_trigger_exists;
  RAISE NOTICE 'assign_observation_to_project_trigger exists: %', v_trigger_exists;

  SELECT CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
  INTO v_security
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'assign_observation_to_project';
  RAISE NOTICE 'assign_observation_to_project security: %', COALESCE(v_security, 'NOT FOUND');
END $$;

-- ── 2. Check is_project_owner / is_project_member exist and are SECURITY DEFINER ──
DO $$
DECLARE
  v_owner_sec text;
  v_member_sec text;
BEGIN
  SELECT CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
  INTO v_owner_sec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_project_owner';
  RAISE NOTICE 'is_project_owner security: %', COALESCE(v_owner_sec, 'NOT FOUND');

  SELECT CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'SECURITY INVOKER' END
  INTO v_member_sec
  FROM pg_proc p
  JOIN pg_namespace n ON n.oid = p.pronamespace
  WHERE n.nspname = 'public' AND p.proname = 'is_project_member';
  RAISE NOTICE 'is_project_member security: %', COALESCE(v_member_sec, 'NOT FOUND');
END $$;

-- ── 3. Check RLS policies on projects reference is_project_member inline ──
-- If any policy still uses inline EXISTS on project_members, it can recurse.
DO $$
DECLARE
  r record;
  v_count int := 0;
BEGIN
  FOR r IN
    SELECT polname, pg_get_expr(polqual, polrelid) AS using_expr
    FROM pg_policy pol
    JOIN pg_class c ON c.oid = pol.polrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    WHERE n.nspname = 'public' AND c.relname IN ('projects', 'project_members')
  LOOP
    v_count := v_count + 1;
    RAISE NOTICE 'Policy % USING: %', r.polname, r.using_expr;
  END LOOP;
  RAISE NOTICE 'Total policies on projects/project_members: %', v_count;
END $$;

-- ── 4. Dry-run the trigger logic as service role (bypasses RLS) ───────────
-- Simulates what the trigger does: find a project covering the observation's location
DO $$
DECLARE
  v_obs_id uuid := '1db35875-e7b8-4aab-b1c9-c0fb4b164d29';
  v_location geography;
  v_project_id uuid;
BEGIN
  SELECT location INTO v_location FROM public.observations WHERE id = v_obs_id;
  RAISE NOTICE 'Observation location: %', v_location;

  IF v_location IS NOT NULL THEN
    SELECT id INTO v_project_id
    FROM public.projects
    WHERE ST_Covers(polygon, v_location)
    ORDER BY created_at ASC
    LIMIT 1;
    RAISE NOTICE 'Matching project_id: %', COALESCE(v_project_id::text, 'none');
  ELSE
    RAISE NOTICE 'Location is NULL — trigger would early-return, no ST_Covers call';
  END IF;
END $$;

-- ── 5. Check for any OTHER triggers on observations.location ──────────────
DO $$
DECLARE
  r record;
BEGIN
  FOR r IN
    SELECT t.tgname,
           p.proname AS func_name,
           CASE p.prosecdef WHEN true THEN 'SECURITY DEFINER' ELSE 'INVOKER' END AS security,
           CASE t.tgtype & 2 WHEN 2 THEN 'BEFORE' ELSE 'AFTER' END AS timing
    FROM pg_trigger t
    JOIN pg_class c ON c.oid = t.tgrelid
    JOIN pg_namespace n ON n.oid = c.relnamespace
    JOIN pg_proc p ON p.oid = t.tgfoid
    WHERE n.nspname = 'public'
      AND c.relname = 'observations'
      AND NOT t.tgisinternal
    ORDER BY t.tgname
  LOOP
    RAISE NOTICE 'Trigger: % → %() [% %]', r.tgname, r.func_name, r.timing, r.security;
  END LOOP;
END $$;
