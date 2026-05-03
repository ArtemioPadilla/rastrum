-- backfill-taxa-from-identifications.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- Backfill: create taxa rows from scientific_names already stored in
-- identifications. Needed because the identify Edge Function and sync.ts
-- client previously inserted identifications without taxon_id, and
-- because the taxa table was never seeded from these names.
--
-- After this runs, re-run backfill-primary-taxon-id.sql to propagate
-- primary_taxon_id to observations.
--
-- Safe to run multiple times (WHERE NOT EXISTS guard avoids duplicates;
-- we avoid ON CONFLICT because scientific_name only has a plain index,
-- not a UNIQUE constraint).
-- Run with: psql "$SUPABASE_DB_URL" -f scripts/backfill-taxa-from-identifications.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

-- ── Step 1: insert missing taxa from identifications ──────────────────────────
DO $$
DECLARE
  v_count int;
BEGIN
  INSERT INTO public.taxa (scientific_name, common_name_es, common_name_en, taxon_rank)
  SELECT DISTINCT ON (i.scientific_name)
    i.scientific_name,
    -- Extract common names from raw_response if present (PlantNet / Claude store them there)
    COALESCE(
      (i.raw_response->>'common_name_es')::text,
      (i.raw_response->'raw'->>'common_name_es')::text
    ),
    COALESCE(
      (i.raw_response->>'common_name_en')::text,
      (i.raw_response->'raw'->>'common_name_en')::text
    ),
    'species'
  FROM public.identifications i
  WHERE i.scientific_name IS NOT NULL
    AND i.scientific_name <> ''
    AND NOT EXISTS (
      SELECT 1 FROM public.taxa t WHERE t.scientific_name = i.scientific_name
    )
  ORDER BY i.scientific_name;  -- required by DISTINCT ON

  GET DIAGNOSTICS v_count = ROW_COUNT;
  RAISE NOTICE 'Step 1: inserted % new taxa from identifications', v_count;
END $$;

-- ── Step 2: resolve taxon_id on identifications that still lack it ────────────
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
  RAISE NOTICE 'Step 2: resolved taxon_id for % identification(s)', v_count;
END $$;

-- ── Step 3: backfill observations.primary_taxon_id ────────────────────────────
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
  v_taxa_total   int;
  v_null_taxon   int;
  v_total_synced int;
BEGIN
  SELECT COUNT(*) INTO v_taxa_total FROM public.taxa;
  SELECT COUNT(*) INTO v_total_synced FROM public.observations WHERE sync_status = 'synced';
  SELECT COUNT(*) INTO v_null_taxon
  FROM public.observations
  WHERE sync_status = 'synced' AND primary_taxon_id IS NULL;

  RAISE NOTICE 'Verification: % taxa total, % synced observations, % still have primary_taxon_id NULL',
    v_taxa_total, v_total_synced, v_null_taxon;
END $$;

COMMIT;
