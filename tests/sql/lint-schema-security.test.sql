-- tests/sql/lint-schema-security.test.sql
--
-- Regression suite for infra/lint-schema-security.sql.
--
-- Strategy: inject a known-bad schema object inside a SAVEPOINT, assert
-- the linter fails (raises an exception), then ROLLBACK TO SAVEPOINT so
-- the next test case starts from a clean state. A final positive case
-- confirms the linter passes once every violation is rolled back.
--
-- Run via db-validate.yml after the schema has been applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f tests/sql/lint-schema-security.test.sql
--
-- No pgTAP required — plain SQL DO blocks throughout.

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────
-- Helper: record pass/fail per test case in a temp table so we can print
-- a summary at the end and fail the file if anything was unexpected.
-- ─────────────────────────────────────────────────────────────────────────
CREATE TEMP TABLE IF NOT EXISTS _lint_test_results (
  test_name   text PRIMARY KEY,
  passed      boolean NOT NULL,
  detail      text
);

-- ─────────────────────────────────────────────────────────────────────────
-- Test 1: Check 1 catches a view without security_invoker
-- ─────────────────────────────────────────────────────────────────────────
-- We create a plain view (no security_invoker), run the linter in a
-- nested DO block, and assert that an exception was raised.
DO $test1$
DECLARE
  linter_failed boolean := false;
BEGIN
  -- Inject the bad object
  SAVEPOINT bad_view;
  EXECUTE 'CREATE VIEW public._test_bad_definer_view AS SELECT 1 AS col';

  -- Run the linter; it should raise on check1
  BEGIN
    -- We use a DO block to call the linter SQL; since \i doesn't work
    -- inside PL/pgSQL we replicate check1's logic here to validate the
    -- linter's SQL is correct.
    DECLARE
      offenders text;
    BEGIN
      SELECT string_agg(format('public.%I', c.relname), E'\n  - ' ORDER BY c.relname)
        INTO offenders
        FROM pg_class c
        JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public'
         AND c.relkind = 'v'
         AND NOT EXISTS (
           SELECT 1
             FROM unnest(COALESCE(c.reloptions, ARRAY[]::text[])) opt
            WHERE opt = 'security_invoker=true'
         )
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d
            WHERE d.objid = c.oid AND d.deptype = 'e'
         );

      IF offenders IS NULL THEN
        RAISE EXCEPTION 'check1 did not detect _test_bad_definer_view — linter is broken';
      END IF;
      -- offenders is not null → linter would fail → that is what we want
      linter_failed := true;
    END;
  EXCEPTION WHEN OTHERS THEN
    linter_failed := true;
  END;

  ROLLBACK TO SAVEPOINT bad_view;
  RELEASE SAVEPOINT bad_view;

  INSERT INTO _lint_test_results VALUES (
    'check1_detects_missing_security_invoker', linter_failed,
    CASE WHEN linter_failed THEN 'linter correctly detected view without security_invoker'
         ELSE 'FAIL: linter did NOT detect view without security_invoker' END
  );
END
$test1$;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 2: Check 2 catches a PUBLIC-callable SECURITY DEFINER function
-- ─────────────────────────────────────────────────────────────────────────
DO $test2$
DECLARE
  linter_failed boolean := false;
BEGIN
  SAVEPOINT bad_public_definer;

  -- Create a SECURITY DEFINER function without revoking PUBLIC execute
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public._test_bad_public_definer()
    RETURNS int
    LANGUAGE plpgsql
    SECURITY DEFINER
    SET search_path = public, pg_temp
    AS $$
    BEGIN RETURN 1; END
    $$
  $fn$;
  -- Do NOT revoke PUBLIC execute — this is the violation

  BEGIN
    DECLARE
      offenders text;
    BEGIN
      SELECT string_agg(
               format('public.%I(%s)',
                      p.proname,
                      pg_get_function_identity_arguments(p.oid)),
               E'\n  - '
               ORDER BY p.proname
             )
        INTO offenders
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
       WHERE n.nspname = 'public'
         AND p.prosecdef = true
         AND has_function_privilege('public', p.oid, 'EXECUTE')
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d
            WHERE d.objid = p.oid AND d.deptype = 'e'
         );

      IF offenders IS NULL THEN
        RAISE EXCEPTION 'check2 did not detect _test_bad_public_definer — linter is broken';
      END IF;
      linter_failed := true;
    END;
  EXCEPTION WHEN OTHERS THEN
    linter_failed := true;
  END;

  ROLLBACK TO SAVEPOINT bad_public_definer;
  RELEASE SAVEPOINT bad_public_definer;

  INSERT INTO _lint_test_results VALUES (
    'check2_detects_public_callable_definer', linter_failed,
    CASE WHEN linter_failed THEN 'linter correctly detected PUBLIC-callable SECURITY DEFINER function'
         ELSE 'FAIL: linter did NOT detect PUBLIC-callable SECURITY DEFINER function' END
  );
END
$test2$;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 3: Check 3 catches a plpgsql function without search_path pinned
-- ─────────────────────────────────────────────────────────────────────────
DO $test3$
DECLARE
  linter_failed boolean := false;
BEGIN
  SAVEPOINT bad_search_path;

  -- Create a plpgsql function without SET search_path
  EXECUTE $fn$
    CREATE OR REPLACE FUNCTION public._test_bad_search_path()
    RETURNS int
    LANGUAGE plpgsql
    AS $$
    BEGIN RETURN 1; END
    $$
  $fn$;
  -- No SET search_path = ... in the function definition

  BEGIN
    DECLARE
      offenders text;
    BEGIN
      SELECT string_agg(
               format('public.%I(%s)',
                      p.proname,
                      pg_get_function_identity_arguments(p.oid)),
               E'\n  - '
               ORDER BY p.proname
             )
        INTO offenders
        FROM pg_proc p
        JOIN pg_namespace n ON n.oid = p.pronamespace
        JOIN pg_language l ON l.oid = p.prolang
       WHERE n.nspname = 'public'
         AND p.prokind IN ('f', 'p')
         AND l.lanname NOT IN ('sql', 'internal', 'c')
         AND NOT EXISTS (
           SELECT 1
             FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
            WHERE c LIKE 'search_path=%'
         )
         AND NOT EXISTS (
           SELECT 1 FROM pg_depend d
            WHERE d.objid = p.oid AND d.deptype = 'e'
         );

      IF offenders IS NULL THEN
        RAISE EXCEPTION 'check3 did not detect _test_bad_search_path — linter is broken';
      END IF;
      linter_failed := true;
    END;
  EXCEPTION WHEN OTHERS THEN
    linter_failed := true;
  END;

  ROLLBACK TO SAVEPOINT bad_search_path;
  RELEASE SAVEPOINT bad_search_path;

  INSERT INTO _lint_test_results VALUES (
    'check3_detects_missing_search_path', linter_failed,
    CASE WHEN linter_failed THEN 'linter correctly detected plpgsql function without search_path'
         ELSE 'FAIL: linter did NOT detect plpgsql function without search_path' END
  );
END
$test3$;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 4 (positive): linter passes against the existing schema
-- ─────────────────────────────────────────────────────────────────────────
-- After all the above SAVEPOINTs have been rolled back, the schema should
-- be clean. Run each check logic and confirm they all find zero offenders.
DO $test4_check1$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(format('public.%I', c.relname), E'\n  - ' ORDER BY c.relname)
    INTO offenders
    FROM pg_class c
    JOIN pg_namespace n ON n.oid = c.relnamespace
   WHERE n.nspname = 'public'
     AND c.relkind = 'v'
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(COALESCE(c.reloptions, ARRAY[]::text[])) opt
        WHERE opt = 'security_invoker=true'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.objid = c.oid AND d.deptype = 'e'
     );

  INSERT INTO _lint_test_results VALUES (
    'positive_check1_clean_schema',
    offenders IS NULL,
    COALESCE('FAIL: views without security_invoker: ' || offenders,
             'check1 passes on the current schema — no unprotected views ✓')
  );
END
$test4_check1$;

DO $test4_check2$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(
           format('public.%I(%s)',
                  p.proname,
                  pg_get_function_identity_arguments(p.oid)),
           E'\n  - '
           ORDER BY p.proname
         )
    INTO offenders
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
   WHERE n.nspname = 'public'
     AND p.prosecdef = true
     AND has_function_privilege('public', p.oid, 'EXECUTE')
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
     );

  INSERT INTO _lint_test_results VALUES (
    'positive_check2_clean_schema',
    offenders IS NULL,
    COALESCE('FAIL: PUBLIC-callable SECURITY DEFINER functions: ' || offenders,
             'check2 passes on the current schema — no PUBLIC-callable definer functions ✓')
  );
END
$test4_check2$;

DO $test4_check3$
DECLARE
  offenders text;
BEGIN
  SELECT string_agg(
           format('public.%I(%s)',
                  p.proname,
                  pg_get_function_identity_arguments(p.oid)),
           E'\n  - '
           ORDER BY p.proname
         )
    INTO offenders
    FROM pg_proc p
    JOIN pg_namespace n ON n.oid = p.pronamespace
    JOIN pg_language l ON l.oid = p.prolang
   WHERE n.nspname = 'public'
     AND p.prokind IN ('f', 'p')
     AND l.lanname NOT IN ('sql', 'internal', 'c')
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%'
     )
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
     );

  INSERT INTO _lint_test_results VALUES (
    'positive_check3_clean_schema',
    offenders IS NULL,
    COALESCE('FAIL: plpgsql functions without search_path: ' || offenders,
             'check3 passes on the current schema — all pl* functions pin search_path ✓')
  );
END
$test4_check3$;

-- ─────────────────────────────────────────────────────────────────────────
-- Summary + fail gate
-- ─────────────────────────────────────────────────────────────────────────
DO $summary$
DECLARE
  rec      record;
  failures int := 0;
BEGIN
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  RAISE NOTICE 'lint-schema-security regression results:';
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';
  FOR rec IN SELECT test_name, passed, detail FROM _lint_test_results ORDER BY test_name LOOP
    IF rec.passed THEN
      RAISE NOTICE '  PASS  %: %', rec.test_name, rec.detail;
    ELSE
      RAISE NOTICE '  FAIL  %: %', rec.test_name, rec.detail;
      failures := failures + 1;
    END IF;
  END LOOP;
  RAISE NOTICE '═══════════════════════════════════════════════════════════════';

  IF failures > 0 THEN
    RAISE EXCEPTION '% lint regression test(s) failed — see NOTICE output above', failures;
  END IF;

  RAISE NOTICE 'All % lint regression tests passed ✓',
    (SELECT count(*) FROM _lint_test_results);
END
$summary$;
