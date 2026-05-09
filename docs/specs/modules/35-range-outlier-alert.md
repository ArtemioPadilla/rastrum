# Module 35 — Submit-time Outlier Alert ("Possible range extension")

**Status:** Spec v1.0 — 2026-05-08 (issue #742)
**Milestone:** v1.5 (data-quality cluster)
**Closes:** #742
**Companion to:** [`22-community-validation.md`](22-community-validation.md)
(uses M22 priority queue for confirmed range extensions),
[`06-export.md`](06-export.md) (DwC export integrity).

---

## Problem

A user observes a tropical species in a temperate state — could be (a) a
real range extension (scientifically valuable!), (b) an escaped or
cultivated specimen, or (c) a mis-identification. Today the obs uploads
silently and the bad data lands in `observations` with no flag, no
review queue entry, and no trace. By the time M06's Darwin Core export
ships it to GBIF, the noise is already in someone else's dataset.

## Solution

A polite **soft modal** at submit time that surfaces a one-line quality
signal: "Este registro está a ~XXX km del rango conocido en
GBIF/Rastrum. ¿Es correcto?" Three outcomes:

| User action | Effect |
|---|---|
| **Confirm** ("Es correcto, lo confirmo") | `observations.is_range_extension = true`. Detail page shows a violet "Posible extensión de rango" pill. M22 queue treats the obs as priority. Submission proceeds. |
| **Review** ("Revisar") | Submit is aborted. Form stays open so the user can edit ID or location. NO row is written. |
| **No range data** | No modal at all. Submission proceeds normally. |

**Hard rule:** the modal NEVER blocks submission. If the user closes the
tab, hits Esc, or the DB call errors, the obs still lands as a normal
(non-flagged) row.

This is **Persuasive Tech, Principle of Information Quality** (Fogg,
ch. 8): a one-line, well-coordinated quality signal at the right moment
nudges behaviour without coercion.

## Out of scope

- Hard rejection / blocking submit on outliers.
- ML-based ecological-niche modelling (start with convex-hull only).
- Per-taxon thresholds — v1 is a single 50 km global threshold.
- Surfacing the alert AFTER submit (e.g. as an inbox notification);
  v1.1 follow-up.

## Schema (idempotent)

Lives at the end of `docs/specs/infra/supabase-schema.sql` under the
`M22-range` banner. Three additions:

1. **`public.taxon_range_index`** — `(taxon_id PK, geom MultiPolygon,
   source, built_at, n_records)`. RLS-enabled, public read,
   service_role write. GiST index on `geom`.
2. **`public.taxon_range_distance_km(uuid, numeric, numeric)`** —
   STABLE PARALLEL SAFE SQL function returning the distance (km) from
   `(p_lat, p_lng)` to the nearest edge of the taxon's range, or NULL
   if no range exists. Granted to anon + authenticated.
3. **`public.observations.is_range_extension`** — boolean NOT NULL
   DEFAULT false, idempotent column add. Indexed via partial index
   `WHERE is_range_extension = true`.

## Range source — v1 ("rastrum_proxy")

Same Option-A choice as falta-dex: use Rastrum's own research-grade
observations as the range. `public.refresh_taxon_ranges()` —
SECURITY DEFINER — runs weekly (Sundays 04:00 UTC) and rebuilds the
index from observations of the last 5 years where:

- `primary_taxon_id IS NOT NULL`
- `location IS NOT NULL`
- the obs has a `is_research_grade = true` primary identification
- the taxon has ≥10 such obs

Geometry: `ST_Multi(ST_ConvexHull(ST_Collect(...)))`. The cast to
MultiPolygon is required because the column type is
`geography(MultiPolygon, 4326)`; a single hull always becomes a
1-element multipolygon.

**v1.1 follow-up:** GBIF ETL replaces `source = 'rastrum_proxy'` rows
with curated regional ranges (Mexico, US, Central America). The schema
already supports `source = 'gbif'` and `'curated'`; only the seeding
job changes.

## UI — submit-time modal

`src/lib/outlier-alert.ts` exports the testable surface:

- `classifyOutlier(distanceKm, threshold)` → pure verdict.
  - `null/NaN` → `{ kind: 'no_signal' }` (no range data; do not
    show modal).
  - `≤ threshold` → `{ kind: 'in_range', distanceKm }`.
  - `> threshold` → `{ kind: 'outlier', distanceKm }`.
- `formatDistanceKm(km)` → display string. Rounds to nearest 10 km
  for distances ≥ 100 km, nearest 1 km below.
- `resolveTaxonIdByName(scientificName)` — best-effort lookup against
  `taxa.scientific_name`. Returns NULL on failure.
- `fetchTaxonRangeDistanceKm(taxonId, lat, lng)` — calls the RPC.
  Returns NULL on any error.
- `checkOutlier({...})` — orchestrator used by the form.

`ObservationForm.astro` calls `checkOutlier` after location +
identification validation but before `saveObservationToOutbox`. On
`outlier`, opens `openConfirmDialog` with localized title + message;
on confirm, sets `confirmedRangeExtension = true` (carried into the
draft via `buildSaveDraft` → `isRangeExtension`).

The threshold default is `DEFAULT_OUTLIER_THRESHOLD_KM = 50`. This
catches accidental "wrong country" submissions (typically thousands of
km) without false-positive nags on edge-of-range obs (typically
< 50 km).

## Sync

`src/lib/sync.ts` writes `obs.isRangeExtension` into the
`observations.is_range_extension` column on upsert. No additional
RPC plumbing needed — it's a plain boolean column on the existing
row.

## Surface

Two read sites:

- `/share/obs/?id=<uuid>` — `ShareObsView.astro` renders an inline
  violet pill near the species heading when `is_range_extension =
  true`. Shows unconditionally (does not depend on community IDs the
  way the "edited after IDs" badge does).
- Personal observations list (`MyObservationsView.astro`) — the same
  pill renders in the row's badge cluster, after the research-grade
  badge.

Both pull `is_range_extension` from the SELECT directly.

## Invariants

1. **Submission is never blocked.** Modal cancel = abort submit; modal
   absence (DB error, no range data, threshold passed) = submit
   proceeds.
2. **NULL distance ≠ in-range.** Callers must treat NULL as "no signal,
   no modal" — never as a passing check.
3. **Best-effort taxon lookup.** If `taxa.id` can't be resolved by
   scientific name, the check is skipped, not failed.
4. **Threshold is global.** Per-taxon tuning is a v1.1 concern; the
   `taxon_range_index` schema doesn't carry a `threshold_km` today.

## Tests

- `tests/unit/outlier-alert.test.ts` covers `classifyOutlier` and
  `formatDistanceKm` exhaustively (NaN, NULL, edge cases, large
  distances, thresholds).
- The form integration is exercised by Playwright when a real
  observation is submitted with a known-outlier coord; out of scope
  for the initial PR.

## v1.1 follow-ups (NOT in this PR)

- GBIF ETL → seed `taxon_range_index` rows with `source = 'gbif'`.
  The submit-time check stays the same; only the data improves.
- Per-taxon thresholds (e.g. 200 km for migratory raptors).
- Inbox notification when a moderator reviews a confirmed range
  extension.
- Visualisation: highlight the obs on the M22 validation queue with a
  range-pin overlay.
