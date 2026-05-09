# Contextual species suggestions (issue #723)

A chip-strip on `/observe` (and the `/identify` flow it shares) that
surfaces 5–10 species likely to be encountered at the user's current
location and month, derived from Rastrum's own observation data.

## Mental model

Same proxy as falta-dex (issue #726, "Option A"): the baseline is
Rastrum's own community observations. v1 trades a curated GBIF
baseline for the simplest thing that produces useful chips on day
one. The honest copy under the heading admits the limit; precision
improves as more observations land.

A v1.1 follow-up can swap the data source to a GBIF-derived baseline
(or a hybrid) without changing the UI contract — the RPC signature
stays the same.

## Filters

| Knob | Value | Why |
|---|---|---|
| Radius | 50 km | Wide enough to surface meaningful taxa in low-density grids; narrow enough to capture habitat affinity. The same radius the M28 community-nearby RPC uses. |
| Month window | ±1 month, year-wrapping | Captures phenological neighbours without being so loose that a winter migrant shows up in July. Wraps so December → {Nov, Dec, Jan}. |
| Eligibility | `is_research_grade=true OR primary_taxon_id IS NOT NULL` | Mirrors the falta-dex inclusion rule — a "soft" research-grade with at least a primary ID is good enough as a prior, especially in low-density biomes where a stricter rule starves the chip strip. |
| Limit | top 10 by `COUNT(*) DESC, MIN(distance) ASC` | Matches the chip-strip footprint (5–10 cards). |

## Schema

The RPC `probable_taxa_at(p_lat numeric, p_lng numeric, p_month int, p_limit int)` is appended at the end of `docs/specs/infra/supabase-schema.sql`.

- `SECURITY INVOKER` — RLS on `observations` + `identifications` is
  the gate. Anonymous callers see public observations only.
- Returns `taxon_id`, `scientific_name`, common-name pair, `slug`,
  `thumbnail_url` (via `taxa_thumbnails` view), `n_obs`,
  `last_seen_distance_km`, `has_observed_by_viewer`.
- `has_observed_by_viewer` is NULL for anonymous callers,
  true/false for authenticated callers — the chip-strip uses NULL to
  mean "skip the badge".

Granted to `anon, authenticated`.

## Cache layer (deferred)

The original spec floated a `probable_taxa_cache(geohash5, month, …)`
materialised cache warmed by a nightly cron. **Not shipped in v1.**
Reasoning:

- The live RPC is fast — `idx_obs_location` (GIST) + the month filter
  + GROUP BY against the indexed FK is well under 300 ms in the
  current dataset (< 100 k observations).
- Building the cache adds operational overhead (cron + warming + cache
  invalidation when new obs land) that we'd prefer to defer until we
  *measure* a problem.
- A sessionStorage cache in the browser already covers the common
  case of the user bouncing back to `/observe` mid-task.

When live latency starts hurting (probably around 1–5 M observations,
or once we add a hot-path on `/explore` that hits this RPC per map
pan), revisit. The follow-up will be:

```sql
CREATE TABLE probable_taxa_cache (
  geohash5  text,
  month     smallint,
  taxon_id  uuid,
  rank      smallint,
  n_obs     int,
  refreshed_at timestamptz,
  PRIMARY KEY (geohash5, month, taxon_id)
);
```

…with a nightly cron that pre-computes the top-10 per (geohash5,
month) for high-traffic cells and a fallback to the live RPC when
the cache misses.

## UI integration

`src/components/ContextualSpeciesChips.astro` is mounted in
`ObserveView2.astro` above the upload zone. It listens for
`rastrum:observe-location-ready` (dispatched by the GPS handler in
`ObserveView2`) and falls back to `navigator.geolocation` after a
12 s timeout if no event arrives.

Chip taps:

1. Set `obs2-taxon-input.value = scientificName`.
2. Set `dataset.idSource = 'manual'` and `dataset.taxonId = <uuid>`.
3. Dispatch a bubbling `change` event so any existing observer
   (form-state machine, autocomplete) reacts the same as if the
   user had typed and selected a row.
4. Dispatch a `rastrum:contextual-pick` CustomEvent for analytics.

No auto-submit. The chip is a soft nudge — the user still confirms
by saving the observation.

## Privacy

- The RPC is `SECURITY INVOKER`, so anon callers can only group over
  public observations. No coordinate data leaves the server.
- The `has_observed_by_viewer` derivation reads `auth.uid()`, which
  is NULL for anon — no cross-account leak.
- Coords come from `navigator.geolocation` and are passed RPC-only;
  never persisted in the URL or sessionStorage as a raw lat/lng
  (the cache key bucketises to ~1 km).

## When to revisit

- Cache: see "Cache layer (deferred)" above.
- Personalised ranking ("species *you* have not seen") is a phase-2
  add — depends on falta-dex (M08) and is gated by user sign-in. The
  current `has_observed_by_viewer` badge is the v1 stub.
- Biome-aware ranking is the natural v1.5 upgrade once we ship the
  ecoregion polygon layer.
