-- Schema security invariants — pre-merge gate
-- ═══════════════════════════════════════════════════════════════════════════
-- Wired into .github/workflows/db-validate.yml. Run against the ephemeral
-- Postgres after the schema has been applied (and the second-pass idempotency
-- check has succeeded). Three checks; each emits a NOTICE on pass, a fatal
-- error with the offending list on fail.
--
-- Rationale lives in docs/specs/infra/supabase-schema.sql under the
-- "Security Advisor remediation — 2026-05-08" section, and in CLAUDE.md
-- under "Schema security invariants".

\set ON_ERROR_STOP on

-- ─────────────────────────────────────────────────────────────────────────
-- Check 1: every view in public must have security_invoker = true
-- ─────────────────────────────────────────────────────────────────────────
DO $check1$
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
     );

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'Views without security_invoker=true (would bypass RLS):\n  - %', offenders;
  END IF;
  RAISE NOTICE 'check1: all public views are security_invoker ✓';
END
$check1$;

-- ─────────────────────────────────────────────────────────────────────────
-- Check 2: no user-defined SECURITY DEFINER function in public may be
--          callable by PUBLIC (the implicit catch-all role)
-- ─────────────────────────────────────────────────────────────────────────
-- pg_proc.proacl is null when the function uses the system default ACL,
-- which grants EXECUTE to PUBLIC. We treat null-ACL as "PUBLIC has execute"
-- and require an explicit ACL that doesn't include the empty grantee
-- (=X means "PUBLIC has EXECUTE"). The pg_has_role(...) check excludes
-- extension-owned functions whose ACL is managed by the extension itself.
DO $check2$
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
     -- Skip functions that came from an installed extension; their ACL is
     -- the extension author's call, not ours.
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
     );

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'SECURITY DEFINER functions executable by PUBLIC (anon escalation risk):\n  - %\n\nFix: add `REVOKE EXECUTE ON FUNCTION public.fn(args) FROM PUBLIC;` after the function definition, then `GRANT EXECUTE ... TO authenticated` (or service_role) explicitly.', offenders;
  END IF;
  RAISE NOTICE 'check2: no SECURITY DEFINER function is PUBLIC-callable ✓';
END
$check2$;

-- ─────────────────────────────────────────────────────────────────────────
-- Check 3: every plpgsql / plpython / etc. function in public must have
--          search_path pinned in proconfig
-- ─────────────────────────────────────────────────────────────────────────
-- LANGUAGE sql functions whose body is a single SELECT/etc. don't strictly
-- need a search_path (they're parsed at definition time and bind their
-- references early), but pl* functions resolve names at execute time using
-- the caller's search_path unless overridden — so pin them.
DO $check3$
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
     AND l.lanname NOT IN ('sql', 'internal', 'c')   -- pl* languages only
     AND NOT EXISTS (
       SELECT 1
         FROM unnest(COALESCE(p.proconfig, ARRAY[]::text[])) c
        WHERE c LIKE 'search_path=%'
     )
     -- Extension-owned functions don't need our search_path discipline.
     AND NOT EXISTS (
       SELECT 1 FROM pg_depend d
        WHERE d.objid = p.oid AND d.deptype = 'e'
     );

  IF offenders IS NOT NULL THEN
    RAISE EXCEPTION E'pl* functions without SET search_path (search-path-shadow risk):\n  - %\n\nFix: append `SET search_path = public, extensions, pg_temp` to the function declaration, or rely on the bulk ALTER FUNCTION block at the end of supabase-schema.sql.', offenders;
  END IF;
  RAISE NOTICE 'check3: all pl* functions pin search_path ✓';
END
$check3$;
