-- backfill-place-id.sql
-- ─────────────────────────────────────────────────────────────────────────────
-- M-Loc-1: Idempotent backfill — assign place_id to synced observations that
-- have a location but no place_id yet.
--
-- Only matches named places (place_type != 'h3_cell'). H3 fallback cells are
-- not created here; the assign_observation_place trigger handles those for
-- new/updated rows. Historical observations without a named place match will
-- remain NULL until the trigger fires on their next location UPDATE, or until
-- a WDPA import adds a matching polygon.
--
-- Safe to run multiple times (idempotent WHERE clause: place_id IS NULL).
-- Run with: psql "$SUPABASE_DB_URL" -f scripts/backfill-place-id.sql
-- ─────────────────────────────────────────────────────────────────────────────

BEGIN;

DO $$
DECLARE
  v_updated  int;
  v_total    int;
BEGIN
  RAISE NOTICE 'M-Loc-1 backfill: assigning place_id to observations...';

  -- Assign the smallest named place that contains each observation's location.
  -- Using a correlated subquery + DISTINCT ON for correctness; the GIST index
  -- on places.geometry makes the ST_Within scan fast.
  UPDATE public.observations o
     SET place_id = (
           SELECT id
             FROM public.places p
            WHERE p.place_type != 'h3_cell'
              AND ST_Within(o.location::geometry, p.geometry::geometry)
            ORDER BY ST_Area(p.geometry::geometry) ASC
            LIMIT 1
         )
   WHERE o.location   IS NOT NULL
     AND o.place_id   IS NULL
     AND o.sync_status = 'synced';

  GET DIAGNOSTICS v_updated = ROW_COUNT;

  SELECT COUNT(*) INTO v_total
    FROM public.observations
   WHERE place_id    IS NOT NULL
     AND sync_status  = 'synced';

  RAISE NOTICE 'Backfill complete: % rows updated this run. % synced observations now have place_id.',
    v_updated, v_total;
END;
$$;

COMMIT;
