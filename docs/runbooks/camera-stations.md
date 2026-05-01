# Camera stations (M31) — runbook

> **Spec:** [`docs/specs/modules/31-camera-stations.md`](../specs/modules/31-camera-stations.md).
> **Status:** schema + create-station UI shipped 2026-04-30 (PRs #141 + #213); period management + per-station detection-rate dashboard remain v1.1 follow-ups.
> **Depends on:** M29 (Projects).

## Apply schema

```bash
make db-apply
```

Creates `camera_stations`, `camera_station_periods`,
`observations.camera_station_id` column, GIST + B-tree indexes,
`station_trap_nights()` SQL function, and RLS policies. Idempotent.

Verify:

```bash
make db-psql
\d camera_stations
\d camera_station_periods
\df station_trap_nights
SELECT public.station_trap_nights('00000000-0000-0000-0000-000000000000'::uuid);
```

## Create a station via the UI (PR #213)

Sign in as the project owner, navigate to
`/{en,es}/projects/detail/?slug=<your-slug>`, scroll to the
**Camera stations** section, click **Add station**, fill in the
station_key + name + lat/lng + (optional) habitat / camera model /
notes, and **Save**. The station appears in the inline list with
its trap-night count (computed live via the
`station_trap_nights()` RPC).

Non-owners see the section read-only with a "Only the project
owner can add stations" notice — RLS enforces the same gate
server-side.

## Create a station + active period via SQL

For batch operations, scripted setup, or operators preparing
deployments ahead of time, use SQL via `make db-psql` while signed
in as the project owner:

```sql
-- 1. Create the station, anchored to an existing M29 project
INSERT INTO public.camera_stations (project_id, station_key, name, name_es, coords, habitat, camera_model)
SELECT p.id, 'SJ-CAM-01',
       'Sierra Juárez camera 01',
       'Cámara Sierra Juárez 01',
       ST_SetSRID(ST_MakePoint(-96.7123, 17.2856), 4326)::geography,
       'cloud forest', 'Bushnell Trophy Cam HD'
  FROM public.projects p
 WHERE p.slug = 'anp-sierra-juarez';

-- 2. Open an active period (NULL end_date = "still active")
INSERT INTO public.camera_station_periods (station_id, start_date, end_date, notes)
SELECT id, '2025-04-01', NULL, 'First deployment, dry season'
  FROM public.camera_stations
 WHERE station_key = 'SJ-CAM-01';
```

To close a period (camera retrieved):

```sql
UPDATE public.camera_station_periods
   SET end_date = '2025-04-15'
 WHERE station_id = (SELECT id FROM public.camera_stations WHERE station_key = 'SJ-CAM-01')
   AND end_date IS NULL;
```

## Compute trap-nights

```sql
-- Total trap-nights for the station, all periods
SELECT public.station_trap_nights(
  (SELECT id FROM public.camera_stations WHERE station_key = 'SJ-CAM-01')
);

-- Bounded to a date range
SELECT public.station_trap_nights(
  (SELECT id FROM public.camera_stations WHERE station_key = 'SJ-CAM-01'),
  p_from := '2025-04-01',
  p_to   := '2025-04-15'
);
```

`NULL` `end_date` is counted up to `current_date` (or the supplied
`p_to`).

## Tag observations to a station

In v1, observations are tagged via direct UPDATE since the API
endpoints don't expose `camera_station_id` yet:

```sql
UPDATE public.observations o
   SET camera_station_id = cs.id
  FROM public.camera_stations cs
 WHERE cs.station_key = 'SJ-CAM-01'
   AND o.project_id = cs.project_id
   AND o.observed_at::date BETWEEN '2025-04-01' AND '2025-04-15';
```

## Detection rate per 100 trap-nights (manual query)

```sql
WITH s AS (
  SELECT id FROM public.camera_stations WHERE station_key = 'SJ-CAM-01'
),
n AS (
  SELECT public.station_trap_nights((SELECT id FROM s)) AS trap_nights
),
det AS (
  SELECT primary_taxon_id, COUNT(*) AS detections
    FROM public.observations
   WHERE camera_station_id = (SELECT id FROM s)
   GROUP BY primary_taxon_id
)
SELECT t.scientific_name,
       det.detections,
       ROUND((det.detections::numeric / NULLIF(n.trap_nights, 0)) * 100, 2) AS rate_per_100_tn
  FROM det
  JOIN public.taxa t ON t.id = det.primary_taxon_id
  CROSS JOIN n
 ORDER BY rate_per_100_tn DESC;
```

## Shipped 2026-04-30

- Create-station UI on `/{en,es}/projects/detail/?slug=<slug>` (PR #213)
- CLI `--project-slug` + `--station-key` flags for batch tagging at import time (PR #208 / issue #156)
- `/api/observe` accepts `camera_station_id` (or the slug+key pair) (PR #208)

## v1.1 follow-ups (still open)

- Period management UI (open / close periods) — embedded inline in the same project page
- Per-station detection-rate dashboard (RAI per species per period)
- DwC-A export filter for "stations only" (vs the full project)
- Multi-point / sampling-grid stations (current schema is one Point per station)
