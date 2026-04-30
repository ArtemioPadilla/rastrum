# M31 — Camera stations + sampling-effort tracking

> **Status:** v1 schema in progress.
> **Owner:** Artemio.
> **Surfaces:** schema only for v1; UI is a v1.1 follow-up.
> **Depends on:** M29 (Projects).

A *camera station* is a fixed deployment with one or more *active
periods* (start/end dates). Standardised wildlife indices like
Relative Abundance Index (RAI), detection rate per 100 trap-nights,
and species richness all depend on knowing **how long the camera was
sampling**, not just **what it captured** — that's why this module
ships separately from M30's import pipeline.

## Schema

```
camera_stations (
  id            uuid PK,
  project_id    uuid → projects.id  ON DELETE CASCADE,
  station_key   text,             -- researcher code, e.g. "SJ-CAM-01"
  name, name_es text,
  coords        geography(Point, 4326),
  habitat       text,
  camera_model  text,
  notes         text,
  UNIQUE(project_id, station_key)
)

camera_station_periods (
  id          uuid PK,
  station_id  uuid → camera_stations.id,
  start_date  date,
  end_date    date,            -- NULL = "still active"
  notes       text
)

observations.camera_station_id  uuid → camera_stations.id  ON DELETE SET NULL
```

Station-key uniqueness is **per project** so two projects can both
have a `SJ-CAM-01` without collision.

## RLS — inherits the project's visibility

A station is visible (read) iff the parent project is visible to the
caller. Public-project stations show to anon. Private-project
stations show only to owner + members. Writes restricted to project
owners.

The auto-tagging trigger from M29 sets `project_id` on observations
by polygon match; **station assignment stays explicit** because two
camera stations within one polygon need different trap-night counts.
The CLI's `--station-key` (v1.1) writes `camera_station_id` directly.

## Trap-nights helper

```sql
SELECT public.station_trap_nights(
  '<station-uuid>',
  p_from := '2025-01-01',  -- optional bound
  p_to   := '2025-12-31'   -- optional bound
);
```

Returns the number of nights the station was active across all its
periods, optionally bounded to a date range. NULL `end_date` means
"still active" — counted up to the supplied upper bound (or
`current_date`). Used by the per-project Species × Station summary
table (v1.1).

## Out of v1 (tracked)

- UI for creating / editing stations + periods (`/{en,es}/projects/[slug]/stations/`)
- CLI `--station-key <key>` flag for batch tagging
- Per-station detection-rate dashboard (RAI per species per period)
- DwC-A export filter for "stations only" (vs the full project)
- Station polygons / sampling grids beyond a single point

## Why date columns instead of timestamptz

Camera-trap protocols are date-granular ("the trap was active from
2025-04-01 to 2025-04-15", not 03:42 UTC). `date` columns also avoid
the daylight-saving footgun for cross-year deployments.
