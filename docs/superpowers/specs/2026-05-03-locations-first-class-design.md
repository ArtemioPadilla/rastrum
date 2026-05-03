# Locations as First-Class Citizens — Design Spec

**Date:** 2026-05-03
**Status:** Approved
**Author:** ArtemIO + Nyx (brainstorm) / ArtemIO (spec)

---

## Overview

Locations in Rastrum are currently just lat/lng coordinates on observations — no identity, no page, no exploration. This spec defines "places" as first-class entities that emerge from observation data, support named areas (from WDPA protected areas database) and H3 hexagons as fallback, and enable four core use cases: exploration, observation context, discovery, and comparison.

**Core principle:** A place exists because observations happened there, not the other way around. Places are data-emergent, community-curated.

---

## Data Model

### New table: `places`

```sql
places (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug            text UNIQUE NOT NULL,           -- URL-safe, e.g. 'reserva-biosfera-tehuacan'
  name            text NOT NULL,                  -- Display name
  name_local      text,                           -- Local/indigenous name if different
  place_type      text NOT NULL                   -- 'protected_area' | 'h3_cell' | 'custom' | 'community'
                  CHECK (place_type IN ('protected_area','h3_cell','custom','community')),
  geometry        geography(Geometry,4326) NOT NULL,  -- Polygon, multipolygon, or point+radius
  h3_cells        text[],                         -- H3 cell IDs covered (resolution 7), for fast lookup
  h3_resolution   int,                            -- H3 resolution if place_type='h3_cell'
  source          text NOT NULL                   -- 'wdpa' | 'user' | 'auto_h3' | 'nominatim'
                  CHECK (source IN ('wdpa','user','auto_h3','nominatim')),
  source_id       text,                           -- External ID (e.g. WDPA_PID for protected areas)
  country_code    text,                           -- ISO 3166-1 alpha-2
  state_province  text,                           -- Admin level 1
  description     text,                           -- Optional community-written description
  created_by      uuid REFERENCES public.users(id),  -- NULL for imports
  obs_count       int NOT NULL DEFAULT 0,         -- Denormalized, updated by trigger/cron
  species_count   int NOT NULL DEFAULT 0,         -- Denormalized
  observer_count  int NOT NULL DEFAULT 0,         -- Denormalized
  first_obs_at    timestamptz,                    -- Denormalized
  last_obs_at     timestamptz,                    -- Denormalized
  created_at      timestamptz NOT NULL DEFAULT now(),
  updated_at      timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX idx_places_geometry ON places USING GIST(geometry);
CREATE INDEX idx_places_h3_cells ON places USING GIN(h3_cells);
CREATE INDEX idx_places_type ON places(place_type);
CREATE INDEX idx_places_obs_count ON places(obs_count DESC);
```

### Changes to `observations`

```sql
ALTER TABLE observations ADD COLUMN place_id uuid REFERENCES places(id);
CREATE INDEX idx_obs_place ON observations(place_id) WHERE place_id IS NOT NULL;
```

### RLS

- `places`: public SELECT for all. INSERT/UPDATE for authenticated owners (`created_by = auth.uid()`). Protected areas are read-only for all users (admin only via service role).
- `observations.place_id`: set by trigger (SECURITY DEFINER), users cannot directly update it.

---

## Backend & Data Pipeline

### A) WDPA Import (one-shot + annual cron)

**Script:** `scripts/import-wdpa.ts`

Downloads WDPA shapefile for Mexico + LATAM countries (free, CC BY 4.0 from protectedplanet.net), converts with `ogr2ogr`, and bulk-inserts into `places`:
- `place_type = 'protected_area'`, `source = 'wdpa'`
- Generates slug from name (lowercase, dashes, dedup with numeric suffix)
- Computes `h3_cells` coverage at resolution 7 using H3-js
- Skip if `source_id` already exists (idempotent)

**GitHub Actions cron:** Runs every January 1st via `workflow_dispatch` + schedule. Mexico first in v1, full LATAM in v2.

### B) Trigger: `assign_place`

```sql
-- BEFORE INSERT OR UPDATE OF location ON observations
-- SECURITY DEFINER
```

Logic:
1. Find the most specific `place_id` where `ST_Within(NEW.location, place.geometry)` — ordered by area ASC (most specific first)
2. If none found: compute H3 cell at resolution 7 for `NEW.location`, upsert a `place_type='h3_cell'` row with name from H3 cell ID (e.g. `"Zona H3 8a48a1b2c3dffff"`), return its `place_id`
3. Set `NEW.place_id`

Performance: GIST index on `places.geometry` makes `ST_Within` spatial join sub-millisecond for the expected volume (<10k places).

### C) Place stats materialized view + denormalization

```sql
-- Materialized view refreshed hourly via pg_cron
CREATE MATERIALIZED VIEW place_stats AS
SELECT
  place_id,
  COUNT(*) AS obs_count,
  COUNT(DISTINCT primary_taxon_id) AS species_count,
  COUNT(DISTINCT observer_id) AS observer_count,
  MIN(observed_at) AS first_obs_at,
  MAX(observed_at) AS last_obs_at
FROM observations
WHERE sync_status = 'synced' AND place_id IS NOT NULL
GROUP BY place_id;
```

A pg_cron job denormalizes back into `places` columns every hour (same pattern as `recompute-user-stats`).

### D) H3 name enrichment via Nominatim (optional, zero cost)

Edge Function `enrich-h3-names` calls Nominatim reverse geocoding (OSM, free) for H3 cells that still have generic names. Runs as a low-priority background cron. Non-blocking — generic H3 name is always the fallback.

---

## Pages & Navigation

### `/explore/places/` — Place index

- Grid of places sorted by `obs_count DESC`
- Filters: `place_type`, `country_code`, `state_province`  
- Full-text search on `name`
- Background map showing all places as colored polygons/hexes (opacity = obs density)
- "Near me" button triggers geolocation and reorders by distance

### `/explore/places/[slug]` — Place detail

**Header:** Name, type badge (Área Protegida / Zona H3 / Comunidad), source badge (WDPA / Usuario / Auto)

**Stats bar:** obs_count · species_count · observer_count · first/last obs date

**Map:** MapLibre centered on place, place boundary rendered as polygon, observation pins clustered inside

**Tabs:**
- *Observaciones recientes* — grid of last 20 obs, link to full filtered view
- *Especies* — list of species by obs count, links to `/explore/species/[slug]`
- *Observadores* — top contributors in this place
- *Lugares cercanos* — 5 nearest places by centroid distance

**Owner actions (if `created_by = auth.uid()`):** Edit name, description, rename slug

### `/share/obs/[id]` — Observation detail (existing, extended)

Add place chip below coordinates:
```
📍 Reserva de la Biosfera Tehuacán-Cuicatlán  →  Ver lugar
```
If `place_id` is null (obs has no location): chip not shown.

### `/explore/map/` — Map (existing, extended)

- New layer toggle: "Mostrar áreas" — renders place polygons with low-opacity fill
- Click on polygon → side panel with place name, stats, link to place detail page
- Observation pin popup gets "Ver lugar" link if obs has place_id

---

## Rollout Phases

| Module | Description | Dependencies | Est. |
|--------|-------------|--------------|------|
| M-Loc-1 | DB schema + WDPA import + assign_place trigger + backfill | None | 2-3d |
| M-Loc-2 | Place chip on obs detail page | M-Loc-1 | 1d |
| M-Loc-3 | Place detail page `/explore/places/[slug]` | M-Loc-1 | 2-3d |
| M-Loc-4 | Place index `/explore/places/` | M-Loc-3 | 1-2d |
| M-Loc-5 | Discovery (near me, map layer, comparison) | M-Loc-3 | 2-3d |

**Total estimate:** 8-12 days. Each module is independently shippable.

---

## Out of Scope (v1)

- Drawing custom place polygons in-browser (v2)
- User-proposed name changes with approval workflow (v2)
- Comparison view between two places (M-Loc-5, v1 is read-only)
- Indigenous/local name database (tracked as future enhancement)
- Place "following" / notifications (v2)

---

## Open Questions (resolved)

- **Who creates places?** System auto-creates from WDPA + H3 fallback. Users can create custom places (community type). No approval flow in v1.
- **What geometry type per place type?** protected_area = polygon/multipolygon (from WDPA), h3_cell = H3 hex, custom = any (point+radius or polygon drawn by user in v2).
- **Geocoding cost?** Zero. Nominatim (OSM) for H3 name enrichment, no paid API.
- **WDPA coverage?** Mexico first in M-Loc-1. LATAM expansion in M-Loc-1 v2 (same script, broader filter).
