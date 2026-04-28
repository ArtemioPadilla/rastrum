# Module 24 — Diversity Indices & Spatial Analytics

**Status:** Spec v1.0 — 2026-04-28
**Author:** Nyx (via Rastrum group, requested by Eugenio Padilla)
**Milestone:** v1.5
**Routes:**
- `/en/explore/diversity/` ↔ `/es/explorar/diversidad/`
- API: `GET /rest/v1/rpc/diversity_indices` (PostgREST RPC)
- Edge Function: `supabase/functions/v1/diversity` (for heavy polygon queries)

---

## Problem

Rastrum accumulates georeferenced, research-grade observations across
municipalities, ANPs (Áreas Naturales Protegidas), and other spatial
units. Today there is no way to answer the most basic ecological
question about that data:

> *"How diverse is the biological community inside polygon X,
> compared to polygon Y, for the observations we have?"*

Field biologists like Eugenio need standardised diversity metrics —
not just species lists — to make management arguments, write reports
to CONANP, or compare sites over time.

---

## Scope

### Indices computed

| Index | Symbol | Formula | Use |
|---|---|---|---|
| **Species richness** | *S* | count of distinct taxa | baseline |
| **Abundance** | *N* | count of all individual observations | sampling effort proxy |
| **Shannon-Wiener** | *H′* | −Σ pᵢ ln pᵢ | standard alpha diversity |
| **Simpson** | *D* | 1 − Σ pᵢ² | dominance-corrected diversity |
| **Simpson's evenness** | *E* | D / S | how evenly species are distributed |
| **True diversity (Hill numbers)** | ⁰D, ¹D, ²D | q=0,1,2 Hill series | unifies S, H′, D in one framework |
| **Pielou's evenness** | *J′* | H′ / ln(S) | 0–1 evenness index |
| **Margalef richness** | *d* | (S−1) / ln(N) | richness adjusted for sample size |

Hill numbers are the recommended modern standard (Chao et al. 2014).
The UI should lead with ⁰D / ¹D / ²D and offer the classic indices
as a secondary panel for researchers who need them for legacy reports.

### Spatial units supported (Phase 1)

1. **ANPs federales** — CONANP polygon layer (GeoJSON, ~900 polygons)
2. **Municipios** — INEGI MGRS layer (~2,500 polygons)
3. **Custom bbox** — user-drawn bounding box on the map
4. **Custom polygon** — user-drawn polygon (free-form, ≤100 vertices)

Phase 2 (v2.0): ejidos, cuencas hidrológicas, buffer-around-point.

---

## Data model

### New table: `spatial_units`

```sql
CREATE TABLE IF NOT EXISTS public.spatial_units (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  kind          text NOT NULL CHECK (kind IN ('anp','municipio','custom_bbox','custom_polygon')),
  name          text NOT NULL,          -- e.g. "Sierra Juárez", "Oaxaca de Juárez"
  name_es       text,
  code          text,                   -- CONANP ID or INEGI CVE_MUN
  source        text,                   -- 'conanp_2024', 'inegi_mgrs_2020', 'user', …
  geom          geometry(MultiPolygon, 4326) NOT NULL,
  bbox          geometry(Polygon, 4326) GENERATED ALWAYS AS (ST_Envelope(geom)) STORED,
  area_km2      numeric GENERATED ALWAYS AS (
                  ST_Area(geom::geography) / 1e6
                ) STORED,
  created_at    timestamptz DEFAULT now(),
  created_by    uuid REFERENCES public.users(id) ON DELETE SET NULL
);

CREATE INDEX IF NOT EXISTS idx_spatial_units_geom ON public.spatial_units USING GIST(geom);
CREATE INDEX IF NOT EXISTS idx_spatial_units_bbox ON public.spatial_units USING GIST(bbox);
CREATE INDEX IF NOT EXISTS idx_spatial_units_kind ON public.spatial_units(kind);
```

### New table: `diversity_cache`

Pre-computed results keyed by `(spatial_unit_id, taxon_kingdom, date_range, min_confidence)`.
Invalidated nightly by `pg_cron` or on new research-grade observation within the polygon.

```sql
CREATE TABLE IF NOT EXISTS public.diversity_cache (
  id                  uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  spatial_unit_id     uuid NOT NULL REFERENCES public.spatial_units(id) ON DELETE CASCADE,
  taxon_kingdom       text,            -- NULL = all kingdoms
  date_from           date,
  date_to             date,
  min_confidence      numeric DEFAULT 0.5,
  obs_count           int NOT NULL,
  species_richness    int NOT NULL,    -- S
  abundance           int NOT NULL,    -- N
  shannon             numeric,         -- H′
  simpson             numeric,         -- D = 1 - Σpᵢ²
  simpson_evenness    numeric,         -- E = D/S
  pielou_evenness     numeric,         -- J′
  margalef            numeric,         -- d
  hill_q0             numeric,         -- ⁰D = S
  hill_q1             numeric,         -- ¹D = exp(H′)
  hill_q2             numeric,         -- ²D = 1/Σpᵢ²
  top_species         jsonb,           -- [{taxon_id, scientific_name, count, pi}] top 10
  computed_at         timestamptz DEFAULT now(),
  UNIQUE (spatial_unit_id, taxon_kingdom, date_from, date_to, min_confidence)
);
```

---

## Core SQL function

```sql
-- Compute diversity indices for a spatial unit.
-- Called by the Edge Function and cached in diversity_cache.
CREATE OR REPLACE FUNCTION public.compute_diversity(
  p_geom            geometry,          -- polygon to query within
  p_kingdom         text    DEFAULT NULL,
  p_date_from       date    DEFAULT NULL,
  p_date_to         date    DEFAULT NULL,
  p_min_confidence  numeric DEFAULT 0.5
)
RETURNS TABLE (
  obs_count         int,
  species_richness  int,
  abundance         int,
  shannon           numeric,
  simpson           numeric,
  simpson_evenness  numeric,
  pielou_evenness   numeric,
  margalef          numeric,
  hill_q0           numeric,
  hill_q1           numeric,
  hill_q2           numeric,
  top_species       jsonb
)
LANGUAGE plpgsql STABLE SECURITY DEFINER AS $$
DECLARE
  v_total  int;
BEGIN
  -- 1. Collect observation × taxon counts inside polygon
  CREATE TEMP TABLE _obs_counts ON COMMIT DROP AS
  SELECT
    i.taxon_id,
    t.scientific_name,
    count(*)::int AS n
  FROM observations o
  JOIN identifications i ON i.observation_id = o.id
                        AND i.is_primary = true
                        AND i.confidence  >= p_min_confidence
  JOIN taxa t ON t.id = i.taxon_id
  WHERE o.sync_status = 'synced'
    AND ST_Within(o.location::geometry, p_geom)
    AND (p_kingdom IS NULL OR t.kingdom = p_kingdom)
    AND (p_date_from IS NULL OR o.observed_at::date >= p_date_from)
    AND (p_date_to   IS NULL OR o.observed_at::date <= p_date_to)
  GROUP BY i.taxon_id, t.scientific_name;

  SELECT sum(n) INTO v_total FROM _obs_counts;

  RETURN QUERY
  WITH
  props AS (
    SELECT
      count(*)::int                               AS s,   -- richness
      v_total                                     AS n,   -- abundance
      -sum( (n::numeric/v_total) * ln(n::numeric/v_total) ) AS h_prime,
      1 - sum( (n::numeric/v_total)^2 )           AS d,   -- Simpson
      sum( (n::numeric/v_total)^2 )               AS sum_pi2
    FROM _obs_counts
  )
  SELECT
    v_total                                       AS obs_count,
    props.s                                       AS species_richness,
    props.n                                       AS abundance,
    round(props.h_prime, 4)                       AS shannon,
    round(props.d, 4)                             AS simpson,
    round(CASE WHEN props.s > 1 THEN props.d / props.s ELSE NULL END, 4)
                                                  AS simpson_evenness,
    round(CASE WHEN props.s > 1 THEN props.h_prime / ln(props.s) ELSE NULL END, 4)
                                                  AS pielou_evenness,
    round(CASE WHEN props.n > 1 THEN (props.s - 1.0) / ln(props.n) ELSE NULL END, 4)
                                                  AS margalef,
    props.s::numeric                              AS hill_q0,
    round(exp(props.h_prime), 4)                  AS hill_q1,
    round(1.0 / props.sum_pi2, 4)                 AS hill_q2,
    (SELECT jsonb_agg(
       jsonb_build_object(
         'taxon_id', taxon_id,
         'scientific_name', scientific_name,
         'count', n,
         'pi', round(n::numeric / v_total, 4)
       ) ORDER BY n DESC
    ) FROM (SELECT * FROM _obs_counts ORDER BY n DESC LIMIT 10) top)
                                                  AS top_species
  FROM props;
END;
$$;
```

### RPC via PostgREST

```sql
-- Thin wrapper for named spatial_unit lookup
CREATE OR REPLACE FUNCTION public.diversity_indices(
  p_spatial_unit_id uuid,
  p_kingdom         text    DEFAULT NULL,
  p_date_from       date    DEFAULT NULL,
  p_date_to         date    DEFAULT NULL,
  p_min_confidence  numeric DEFAULT 0.5,
  p_use_cache       boolean DEFAULT true
)
RETURNS TABLE (LIKE public.diversity_cache)
...
-- checks diversity_cache first; calls compute_diversity() on miss
```

---

## Edge Function: `diversity`

For polygons that don't map to a `spatial_units` row (custom bbox /
freehand draw), a lightweight Edge Function accepts a GeoJSON geometry
and calls `compute_diversity()` directly.

```
POST /functions/v1/diversity
Authorization: Bearer <anon key>
Content-Type: application/json

{
  "geom": { "type": "Polygon", "coordinates": [...] },
  "kingdom": "Plantae",          // optional
  "date_from": "2024-01-01",     // optional
  "date_to":   "2026-04-28",     // optional
  "min_confidence": 0.5
}
```

Response:
```json
{
  "obs_count": 47,
  "species_richness": 18,
  "hill_q0": 18,
  "hill_q1": 11.2,
  "hill_q2": 7.8,
  "shannon": 2.418,
  "simpson": 0.872,
  "pielou_evenness": 0.835,
  "margalef": 4.21,
  "top_species": [...]
}
```

---

## UI: `/explore/diversity/`

### Layout

```
┌─────────────────────────────────────────────────────┐
│  Diversidad  [ANPs ▾] [Municipios ▾] [Dibujar]      │
├──────────────────────────┬──────────────────────────┤
│                          │  ⁰D  18 spp              │
│   Mapa interactivo       │  ¹D  11.2  (H′ = 2.42)  │
│   (polígono activo       │  ²D  7.8   (Simpson)     │
│    resaltado en verde)   ├──────────────────────────┤
│                          │  Pielou J′  0.84         │
│                          │  Margalef d  4.21        │
│                          ├──────────────────────────┤
│                          │  Top especies            │
│                          │  1. Quercus rugosa  18%  │
│                          │  2. Brongniartia arg 12% │
└──────────────────────────┴──────────────────────────┘
│  Filtros: Reino [Plantae ▾]  Fechas [desde] [hasta] │
│  [Exportar CSV]  [Exportar JSON]                     │
└─────────────────────────────────────────────────────┘
```

### Comparison mode

Select up to 4 polygons → side-by-side bar chart of Hill numbers
(using `chart.js` or a lightweight SVG renderer — no heavy deps).

### Interpretation tooltips

Each index shows a `?` icon with a plain-language explanation
(bilingual). Example for *¹D*:

> **Diversidad verdadera (q=1)** — número efectivo de especies igualmente
> comunes que producirían la misma diversidad de Shannon. Un valor de 11.2
> significa que este sitio se comporta como si tuviera 11 especies
> perfectamente equidistribuidas.

---

## Data seeding — ANPs & Municipios

### Phase 1 approach (zero-cost)

CONANP and INEGI publish open GeoJSON/SHP datasets:

- ANPs: `https://datos.gob.mx/busca/dataset/areas-naturales-protegidas-federales`  
  (CONANP, CC BY 4.0 — ~900 polygons, ~15 MB GeoJSON)
- Municipios: `https://www.inegi.org.mx/temas/mg/` (INEGI Marco Geoestadístico,
  INEGI open license — ~2,500 polygons, ~40 MB GeoJSON)

Seed script: `scripts/seed-spatial-units.ts`
- Downloads GeoJSON, simplifies polygons to 0.001° tolerance
  (`ST_Simplify`) to reduce storage
- Bulk-inserts into `spatial_units` using `psql COPY`
- Idempotent (`ON CONFLICT (kind, code) DO UPDATE SET name = EXCLUDED.name`)

Estimated storage after simplification: ~5 MB total.

### Licensing

Both datasets are open government data.
Source attribution is added to the UI footer of the diversity page.

---

## Rarefaction curves (Phase 2 — v2.0)

Species-accumulation curves (`S` vs. `N`) are the standard way to
assess whether sampling is sufficient. Implementation deferred to v2.0
to keep Phase 1 tractable. Schema already supports it since we store
individual observation timestamps.

---

## Darwin Core export integration (Module 06)

The diversity page can pre-filter a DwC-A export to only the
observations inside the selected polygon. This links naturally with
the GBIF IPT pilot (v0.5). Implementation: add `spatial_unit_id` as
an optional query param to the existing DwC export Edge Function.

---

## RLS

```sql
-- Public read on pre-seeded spatial units
ALTER TABLE public.spatial_units ENABLE ROW LEVEL SECURITY;
CREATE POLICY "spatial_units_public_read"
  ON public.spatial_units FOR SELECT USING (true);

-- Users can insert/update their own custom polygons
CREATE POLICY "spatial_units_owner_write"
  ON public.spatial_units FOR INSERT
  WITH CHECK (created_by = auth.uid() AND kind IN ('custom_bbox','custom_polygon'));

-- diversity_cache is read-only for everyone; written only by the DB function (SECURITY DEFINER)
ALTER TABLE public.diversity_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "diversity_cache_public_read"
  ON public.diversity_cache FOR SELECT USING (true);
```

---

## Caching strategy

| Query type | Cache TTL | Invalidation trigger |
|---|---|---|
| Named ANP / municipio, no date filter | 24 h | new research-grade obs inside polygon |
| Named polygon with date filter | 6 h | — |
| Custom polygon (bbox / freehand) | No cache (compute on request) | — |

The nightly `pg_cron` job `refresh_diversity_cache()` re-computes
cached rows for the 50 most-queried polygons.

---

## Cost & risk notes

| Item | Cost |
|---|---|
| `compute_diversity()` on 10k obs inside polygon | ~80 ms (GIST index) |
| Storage for 900 ANP + 2500 municipio polygons (simplified) | ~5 MB |
| `diversity_cache` table | negligible |
| Edge Function invocation | Supabase free tier allows 500k/month |

**Risk:** PostGIS `ST_Within` on `geography` columns requires casting to
`geometry`. Already done in the existing schema (see `obscure_point`).
Index on `observations.location` is GIST — confirmed in schema line 238.

**Risk:** observations with `obscure_level != 'none'` use
`location_obscured` (coarsened). The diversity function must use
`COALESCE(location_obscured, location)` for sensitive species to avoid
excluding them entirely while still respecting privacy.

---

## Dependencies

| Module | Dependency |
|---|---|
| Module 02 (Observations) | `observations` table with `location geography` |
| Module 06 (Darwin Core) | optional: DwC export filtered by polygon |
| Module 22 (Community Validation) | `is_research_grade` flag used as default filter |
| Module 23 (Karma / Rarity) | `taxon_rarity` enriches top-species display |

---

## Open questions for Eugenio

1. **Nivel mínimo de confianza:** ¿Solo observaciones `is_research_grade = true`, o incluir todas con `confidence >= 0.5`?  
   Propuesta: research-grade por defecto, con toggle en la UI para incluir todas.

2. **Abundancia vs. detecciones:** ¿`N` = número de observaciones (detecciones individuales) o número de registros fotográficos únicos por especie? Para cámaras trampa puede importar la distinción.

3. **Polígonos adicionales prioritarios:** ¿Ejidos, cuencas, o RAMSAR/Reservas de la Biosfera antes que municipios?

4. **Exportación:** ¿El CSV debe incluir la lista completa de especies con abundancias, o solo los índices agregados?
