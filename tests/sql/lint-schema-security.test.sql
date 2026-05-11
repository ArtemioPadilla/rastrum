-- tests/sql/lint-schema-security.test.sql
--
-- Regression suite for infra/lint-schema-security.sql.
--
-- MAINTENANCE NOTE: these tests duplicate the invariants from
-- infra/lint-schema-security.sql. If you change the linter (add/remove
-- a check, change error message text), update these tests too. The
-- tests do NOT \i the linter file directly — they independently
-- re-run each check's offender query and assert that a known-bad
-- object would have been caught.
--
-- Strategy: inject a known-bad schema object inside a SAVEPOINT,
-- re-run the linter's offender query, RAISE EXCEPTION if the query
-- returns nothing (meaning the linter is broken), then ROLLBACK TO
-- SAVEPOINT so the next test case starts from a clean state. A final
-- positive case confirms the linter passes once every injected
-- violation is rolled back. psql -v ON_ERROR_STOP=1 fails the whole
-- file the moment any RAISE EXCEPTION fires.
--
-- SAVEPOINT / ROLLBACK TO SAVEPOINT must live at the TOP LEVEL —
-- Postgres rejects transaction control inside anonymous DO blocks
-- (only CREATE PROCEDURE bodies allow it, PG 11+). The DO block
-- contents are limited to the linter-replicating offender query +
-- the IF / RAISE.
--
-- Run via db-validate.yml after the schema has been applied:
--   psql "$DATABASE_URL" -v ON_ERROR_STOP=1 \
--        -f tests/sql/lint-schema-security.test.sql

\set ON_ERROR_STOP on

BEGIN;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 1: check1 catches a view without security_invoker
-- ─────────────────────────────────────────────────────────────────────────
SAVEPOINT t1;

CREATE VIEW public._test_bad_definer_view AS SELECT 1 AS col;

DO $test1$
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

  IF offenders IS NULL OR offenders NOT LIKE '%_test_bad_definer_view%' THEN
    RAISE EXCEPTION 'check1 did not detect _test_bad_definer_view — linter is broken';
  END IF;
  RAISE NOTICE 'check1: correctly detected view without security_invoker (%)', offenders;
END
$test1$;

ROLLBACK TO SAVEPOINT t1;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 2: check2 catches a PUBLIC-callable SECURITY DEFINER function
-- ─────────────────────────────────────────────────────────────────────────
SAVEPOINT t2;

CREATE OR REPLACE FUNCTION public._test_bad_public_definer()
RETURNS int
LANGUAGE plpgsql
SECURITY DEFINER
SET search_path = public, pg_temp
AS $fn$
BEGIN RETURN 1; END
$fn$;
-- Intentionally do NOT REVOKE EXECUTE FROM PUBLIC — that is the violation.

DO $test2$
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

  IF offenders IS NULL OR offenders NOT LIKE '%_test_bad_public_definer%' THEN
    RAISE EXCEPTION 'check2 did not detect _test_bad_public_definer — linter is broken';
  END IF;
  RAISE NOTICE 'check2: correctly detected PUBLIC-callable SECURITY DEFINER function (%)', offenders;
END
$test2$;

ROLLBACK TO SAVEPOINT t2;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 3: check3 catches a plpgsql function without search_path pinned
-- ─────────────────────────────────────────────────────────────────────────
SAVEPOINT t3;

CREATE OR REPLACE FUNCTION public._test_bad_search_path()
RETURNS int
LANGUAGE plpgsql
AS $fn$
BEGIN RETURN 1; END
$fn$;
-- No SET search_path = ... — that is the violation.

DO $test3$
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

  IF offenders IS NULL OR offenders NOT LIKE '%_test_bad_search_path%' THEN
    RAISE EXCEPTION 'check3 did not detect _test_bad_search_path — linter is broken';
  END IF;
  RAISE NOTICE 'check3: correctly detected plpgsql function without search_path (%)', offenders;
END
$test3$;

ROLLBACK TO SAVEPOINT t3;

-- ─────────────────────────────────────────────────────────────────────────
-- Test 4 (positive): linter passes against the already-applied schema
-- ─────────────────────────────────────────────────────────────────────────
-- After all injected SAVEPOINTs have been rolled back, the schema is clean
-- again. Re-run each check's offender query and assert each returns NULL.

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

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'positive check1: schema has views without security_invoker:\n  - %', offenders;
  END IF;
  RAISE NOTICE 'positive check1: schema clean — no views missing security_invoker ✓';
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

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'positive check2: schema has PUBLIC-callable SECURITY DEFINER functions:\n  - %', offenders;
  END IF;
  RAISE NOTICE 'positive check2: schema clean — no PUBLIC-callable definer functions ✓';
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

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'positive check3: schema has pl* functions without search_path:\n  - %', offenders;
  END IF;
  RAISE NOTICE 'positive check3: schema clean — all pl* functions pin search_path ✓';
END
$test4_check3$;

COMMIT;

\echo 'lint-schema-security regression suite passed: 3 negative + 3 positive checks'
