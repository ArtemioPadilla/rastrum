-- backfill-primary-taxon-id.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- One-time backfill for observations whose primary_taxon_id is NULL because
-- they were submitted via the MCP tool before the fix in PR #416
-- (id_source → source + is_primary: true).
--
-- The bug had two possible failure modes:
--   A) identifications.source insert failed silently → no identification row at all
--   B) identification row exists but taxon_id is NULL (scientific_name stored
--      but never resolved against taxa table)
--
-- This script handles both:
--   Step 1 — For identifications that have scientific_name but taxon_id IS NULL,
--             resolve taxon_id from the taxa table by exact scientific_name match.
--   Step 2 — For identifications where is_primary IS NOT TRUE (false OR NULL) but
--             they are the ONLY identification on the observation, promote them.
--   Step 3 — Backfill observations.primary_taxon_id from the primary identification.
--
-- Safe to run multiple times (idempotent WHERE clauses).
-- Run with: psql "$SUPABASE_DB_URL" -f scripts/backfill-primary-taxon-id.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Step 1: resolve taxon_id on identifications that have scientific_name ────
DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.identifications i
  SET taxon_id = t.id
  FROM public.taxa t
  WHERE i.taxon_id IS NULL
    AND i.scientific_name IS NOT NULL
    AND t.scientific_name = i.scientific_name;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Step 1: resolved taxon_id for % identification(s) by scientific_name match', v_count;
END $$;

-- ── Step 2: promote sole identification to is_primary where not already set ──
-- Uses IS NOT TRUE to catch both false AND NULL (guard for any edge case
-- even though the schema has DEFAULT true).
DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.identifications i
  SET is_primary = true
  WHERE i.is_primary IS NOT TRUE
    AND NOT EXISTS (
      SELECT 1 FROM public.identifications i2
      WHERE i2.observation_id = i.observation_id
        AND i2.id <> i.id
        AND i2.is_primary = true
    );

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Step 2: promoted % identification(s) to is_primary', v_count;
END $$;

-- ── Step 3: backfill observations.primary_taxon_id ───────────────────────────
DO $$
DECLARE
  v_count int;
BEGIN
  UPDATE public.observations o
  SET primary_taxon_id = i.taxon_id,
      updated_at       = now()
  FROM public.identifications i
  WHERE i.observation_id   = o.id
    AND i.is_primary       = true
    AND i.taxon_id         IS NOT NULL
    AND o.primary_taxon_id IS NULL;

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Step 3: backfilled primary_taxon_id for % observation(s)', v_count;
END $$;

-- ── Verification ──────────────────────────────────────────────────────────────
DO $$
DECLARE
  v_null_taxon   int;
  v_total_synced int;
BEGIN
  SELECT COUNT(*) INTO v_total_synced
  FROM public.observations WHERE sync_status = 'synced';

  SELECT COUNT(*) INTO v_null_taxon
  FROM public.observations
  WHERE sync_status = 'synced'
    AND primary_taxon_id IS NULL;

  RAISE NOTICE 'Verification: % synced observations total, % still have primary_taxon_id NULL (no identification or unresolved species)', v_total_synced, v_null_taxon;
END $$;

COMMIT;
