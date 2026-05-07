# Pokédex + Especies — visual redesign

> Status: design  
> Author: Artemio Padilla, with Claude (brainstorming session)  
> Date: 2026-05-06  
> Related modules: M08 (profile/activity), M16 (my observations), M23 (rarity), M28 (community discovery)  
> Module number: **M34**

## Goal

Both `/perfil/dex/` (personal Pokédex) and `/explorar/especies/` (global catalog) render today as text-only cards. They are two of the highest-engagement-potential surfaces in Rastrum — one carries personal pride (collection / completion), the other is the public catalog and a primary acquisition surface (a non-logged visitor browses, discovers, signs up to register their own).

Replace the text-only treatment with a photo-first card system, plus per-page heroes that drive each page's specific engagement loop.

## Non-goals

- Re-architecting the species detail page (`/explorar/especies/?slug=…`) — already redesigned in M03 spec, only minor edits here.
- Adding a regional species denominator ("X of N species in your country"). The data isn't there yet; we communicate completion in absolute terms (kingdoms, rarities, recent activity) and let the regional denominator land later.
- Replacing the existing radial/sunburst tab on Especies — preserve, only restyle the tab strip.
- Notifications / push reminders to "go catch" species.

## Engagement loops

**Pokédex (personal, requires login):** *"Look what I've collected → here's what I'm proud of → here's what to catch next."* Loop closes by sending the user to `/observar` or `/explorar/especies/`.

**Especies (public, anonymous OK):** *"Here's something interesting → these are the rarities and endemics → look at the catalog → register so you can contribute."* Loop closes for visitors at sign-in; for logged users it closes back into Pokédex (cards show a ✓ when already in dex).

## Visual decisions (locked from brainstorming)

### Card style — direction D ("modern app card")

Single shared `SpeciesCard` component used by both pages.

```
┌─────────────────────────┐
│   [photo, 16:10]        │
│  ┌──────┐               │
│  │★ Rara│               │← rarity / endemic / NOM-059 pill (top-left)
│  └──────┘               │
│                         │
├─────────────────────────┤
│ Aratinga canicularis    │← scientific name, italic, emerald-700
│ Perico frente naranja   │← common name (locale-aware)
│ 3 obs · Aves            │← context-specific meta
└─────────────────────────┘
```

Pill priority (only one shown, in this order):
1. **★ Rara / Excepcional** (rarity_bucket ≥ 4) — amber
2. **🇲🇽 Endémica** (`is_endemic_mexico = true`) — lime
3. **⚠ NOM-059** (`nom059_status` ∈ {amenazada, peligro, …}) — orange
4. **★ Notable** (rarity_bucket = 3) — amber, lighter
5. *(none)* — Common, no pill

When no photo is available: light emerald→cyan gradient placeholder with the literal text `sin foto aún` (es) / `no photo yet` (en). Deliberately uninspiring to invite contribution.

`✓ in dex` marker (top-right corner, small green check on white circle): rendered only on Especies cards when a logged-in viewer has the species in their own Pokédex.

### Pokédex hero — three tiles desktop, compact on mobile

**Desktop (≥ 820 px):** 1.2fr / 2fr / 1.4fr grid.

| Tile | Content |
|---|---|
| Total | `<big number>` species captured · 4-stat strip below: kingdoms / rares / total obs / streak |
| Showcase | "Tu rareza más alta" — thumbnail of user's rarest species (highest `rarity_bucket`, ties broken by oldest `first_observed_at`), gold ring around photo, name + common + stars |
| Discovery | "Para cazar" — thumbnail in greyscale silhouette of a candidate species the user hasn't observed yet. Caption "Común en MX, no la has visto". CTA → `/explorar/especies/` filtered. |

Below the tiles: kingdom pills row (`Todos · 12` then per-kingdom counts with color dot). Click filters the cards grid.

**Mobile (< 820 px):** all three tiles collapse to a single horizontal `ph-compact` strip:
```
[12 especies] | 4 reinos · 2 raras · 18 obs · 🔥 5 días | [thumb][thumb][thumb][thumb]
```
Kingdom pills become a horizontally-scrollable strip with snap.

**Empty / first-visit state (0 captures):** Tile 1 morphs into "Empieza tu Pokédex" with a CTA button to `/observar`. Tile 2 hides. Tile 3 shows a generic suggested species (random common-bucket species with photo, server-picked).

### Especies hero — split (featured + stats)

```
┌─────────────────────────────────┬──────────┬──────────┐
│  FEATURED SPECIES               │ 1,247    │ 89       │
│  [photo full-bleed, gradient]   │ Especies │ Observad.│
│  Eysenhardtia polystachya       ├──────────┼──────────┤
│  Palo dulce                     │ 2.3k     │ +12      │
│  [Endémica] [NOM-059] [★ Rara]  │ Obs.     │ Esta sem.│
│  Conoce más →                   │          │          │
└─────────────────────────────────┴──────────┴──────────┘
```

**Featured selection algorithm:** weekly-stable random pick from species matching:
- has at least one media URL,
- `rarity_bucket ≥ 4` OR `is_endemic_mexico = true` OR `nom059_status` ∈ {sujeta_proteccion, amenazada, peligro_extincion},
- has at least one synced observation in the last 90 days (i.e., it's "alive" in the catalog).

Pick is deterministic per ISO week — the same featured species shows for everyone for 7 days (Mon-Sun, project timezone), so it can be talked about in social posts. Implemented as a SQL view `featured_species_current` selecting `LIMIT 1` ordered by `md5(taxon_id || date_trunc('week', now()))`.

**Stats stripe:** four counters from `mv_platform_stats` (new lightweight materialized view, refreshed hourly via `pg_cron`):
- total distinct species observed
- total distinct observers (with at least one synced obs)
- total synced observations
- delta this week (new species first observed in current ISO week)

### Filter chips (Especies, new)

Below the search input, above the cards: a horizontal chip strip. v1 set:
- Todos (default active)
- 🇲🇽 Endémicas
- ⚠ NOM-059
- ★ Raras
- Per-kingdom: Animalia / Plantae / Fungi / Chromista (and others present in the dataset)

Composable with the search input. Single-active per group is NOT enforced (you can combine "Endémicas + Aves"). State serialized to URL params (`?endemic=1&kingdom=Animalia`). Browser back/forward restores.

### Tabs (Especies, restyle only)

Existing `Cuadrícula / Árbol / Buscar` tabs preserved. Restyle:
- emerald-700 underline on active
- 13 px font, 600 weight
- icons: `▦` grid, `⊙` tree, `⌕` search (or proper SVG icons — TBD during impl)

The "Buscar" tab is the dedicated typeahead/filter UI; it now becomes redundant with the always-visible search input + chips. **Decision:** drop the Buscar tab entirely; merge its functionality into the always-visible search input. The Cuadrícula and Árbol tabs remain.

### Cross-page connection: ✓ in dex

When a logged-in user browses `/explorar/especies/`, every card whose `taxon_id` is in their `profile_pokedex` gets a small green ✓ icon in the top-right corner of the photo. Click of the card still goes to the species detail page.

Implementation: client fetches the user's `profile_pokedex` once on page load (already an indexed query, capped at the user's species count), builds a Set of taxon_ids, the card render reads from it. No N+1.

## Architecture

### Components

```
src/components/
├── species/
│   ├── SpeciesCard.astro        ← shared card, direction D
│   ├── SpeciesCardGrid.astro    ← grid wrapper (responsive cols, lazy-load photos)
│   ├── PokedexHero.astro        ← 3-tile hero with tile-1 / tile-2 / tile-3 sub-components
│   ├── PokedexCompactHero.astro ← mobile compact variant
│   ├── KingdomPills.astro       ← filter pills used by both pages
│   ├── EspeciesHero.astro       ← featured + stats split
│   ├── FeaturedSpeciesCard.astro← the gradient/photo featured panel
│   ├── PlatformStats.astro      ← 4-stat counters
│   └── FilterChips.astro        ← URL-state-aware chip strip
└── (existing PokedexView.astro, ExploreSpeciesView.astro reorchestrated to use the above)
```

`PokedexView.astro` and `ExploreSpeciesView.astro` shrink to thin orchestrators (bind data → pass to subcomponents).

### Data

#### `profile_pokedex` view extension (replace, not new)

Current shape: `user_id, taxon_id, scientific_name, kingdom, rarity_bucket, first_observed_at, obs_count`.

Add columns:
- `common_name_es` — from `taxa.common_name_es`
- `common_name_en` — from `taxa.common_name_en`
- `slug` — from `taxa.slug` (for linking to detail)
- `thumbnail_url` — LATERAL join on `media_files`, same pattern as `profile_top_species` (oldest synced primary photo on the user's earliest obs of this taxon)
- `endemic_mx` — boolean from `taxa.is_endemic_mexico`
- `nom059_status` — text from `taxa.nom059_status`

The `CREATE OR REPLACE VIEW` rule (auto-memory: append-only on column order) applies — we add all new columns at the end of the SELECT list, keeping the existing column positions intact. No `DROP VIEW` needed; `CREATE OR REPLACE` succeeds because we're appending. Existing consumer `PokedexView.astro` is the only consumer (confirmed via `rg "from\(.profile_pokedex.\)"`); it reads by name, so positional order is irrelevant to the client either way.

#### `mv_platform_stats` (new materialized view)

```sql
CREATE MATERIALIZED VIEW IF NOT EXISTS public.mv_platform_stats AS
SELECT
  (SELECT COUNT(DISTINCT i.taxon_id) FROM identifications i JOIN observations o ON o.id = i.observation_id
     WHERE i.is_primary AND o.sync_status = 'synced')                              AS total_species,
  (SELECT COUNT(DISTINCT o.observer_id) FROM observations o
     WHERE o.sync_status = 'synced')                                               AS total_observers,
  (SELECT COUNT(*) FROM observations o WHERE o.sync_status = 'synced')             AS total_obs,
  (SELECT COUNT(DISTINCT i.taxon_id)
     FROM identifications i JOIN observations o ON o.id = i.observation_id
     WHERE i.is_primary AND o.sync_status = 'synced'
       AND date_trunc('week', o.observed_at) = date_trunc('week', now())
       AND NOT EXISTS (
         SELECT 1 FROM identifications i2 JOIN observations o2 ON o2.id = i2.observation_id
         WHERE i2.taxon_id = i.taxon_id AND i2.is_primary AND o2.sync_status = 'synced'
           AND o2.observed_at < date_trunc('week', now()))
  )                                                                                AS new_species_this_week,
  now()                                                                            AS computed_at;
GRANT SELECT ON public.mv_platform_stats TO anon, authenticated;
```

Refreshed hourly via `pg_cron`:

```sql
SELECT cron.schedule('refresh-platform-stats', '0 * * * *',
  $$REFRESH MATERIALIZED VIEW CONCURRENTLY public.mv_platform_stats$$);
```

(The `CONCURRENTLY` requires a UNIQUE index on the MV — add one on `computed_at` even though the MV will only ever have one row.)

#### `featured_species_current` view (new, regular view, not MV)

```sql
CREATE OR REPLACE VIEW public.featured_species_current AS
WITH eligible AS (
  SELECT t.id AS taxon_id, t.scientific_name, t.common_name_es, t.common_name_en, t.slug,
         t.kingdom, t.is_endemic_mexico, t.nom059_status,
         tr.bucket AS rarity_bucket
  FROM public.taxa t
  LEFT JOIN public.taxon_rarity tr ON tr.taxon_id = t.id
  WHERE EXISTS (SELECT 1 FROM public.media_files mf
                JOIN public.observations o ON o.id = mf.observation_id
                JOIN public.identifications i ON i.observation_id = o.id
                WHERE i.is_primary AND i.taxon_id = t.id
                  AND o.sync_status = 'synced'
                  AND o.observed_at > now() - interval '90 days')
    AND (
      tr.bucket >= 4
      OR t.is_endemic_mexico = true
      OR t.nom059_status IN ('sujeta_proteccion', 'amenazada', 'peligro_extincion')
    )
)
SELECT *,
       (SELECT mf.url FROM public.media_files mf
          JOIN public.observations o ON o.id = mf.observation_id
          JOIN public.identifications i ON i.observation_id = o.id
          WHERE i.is_primary AND i.taxon_id = e.taxon_id
            AND o.sync_status = 'synced'
          ORDER BY mf.is_primary DESC NULLS LAST, mf.created_at DESC LIMIT 1) AS thumbnail_url
FROM eligible e
ORDER BY md5(e.taxon_id::text || to_char(date_trunc('week', now()), 'YYYY-IW'))
LIMIT 1;

GRANT SELECT ON public.featured_species_current TO anon, authenticated;
```

#### "Para cazar" suggestion — RPC

```sql
CREATE OR REPLACE FUNCTION public.suggest_pokedex_target(viewer_id uuid)
RETURNS TABLE (taxon_id uuid, scientific_name text, common_name_es text, common_name_en text,
               slug text, kingdom text, thumbnail_url text)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH owned AS (
    SELECT taxon_id FROM public.profile_pokedex WHERE user_id = viewer_id
  ),
  user_kingdoms AS (
    SELECT kingdom, COUNT(*) AS c FROM public.profile_pokedex
    WHERE user_id = viewer_id GROUP BY kingdom ORDER BY c DESC LIMIT 1
  )
  SELECT t.id, t.scientific_name, t.common_name_es, t.common_name_en, t.slug, t.kingdom,
         (SELECT mf.url FROM public.media_files mf
            JOIN public.observations o ON o.id = mf.observation_id
            JOIN public.identifications i ON i.observation_id = o.id
            WHERE i.is_primary AND i.taxon_id = t.id AND o.sync_status = 'synced'
            ORDER BY mf.is_primary DESC NULLS LAST, mf.created_at DESC LIMIT 1) AS thumbnail_url
    FROM public.taxa t
    LEFT JOIN public.taxon_rarity tr ON tr.taxon_id = t.id
   WHERE t.id NOT IN (SELECT taxon_id FROM owned)
     AND t.kingdom = COALESCE((SELECT kingdom FROM user_kingdoms), 'Animalia')
     AND COALESCE(tr.bucket, 1) <= 2
     AND EXISTS (SELECT 1 FROM public.media_files mf
                 JOIN public.observations o ON o.id = mf.observation_id
                 JOIN public.identifications i ON i.observation_id = o.id
                 WHERE i.is_primary AND i.taxon_id = t.id AND o.sync_status = 'synced')
   ORDER BY md5(t.id::text || viewer_id::text || to_char(now(), 'YYYY-MM-DD'))
   LIMIT 1;
$$;
GRANT EXECUTE ON FUNCTION public.suggest_pokedex_target(uuid) TO authenticated;
```

Pick stable per user per day. Falls back to `Animalia` if user has no captures yet.

### Data flow

**`/perfil/dex/`** (PokedexView):
1. `getSession()` → if no user, render empty owner state (CTA to `/ingresar`).
2. Fetch `profile_pokedex` for user — returns extended rows.
3. Compute hero data client-side: total, kingdom counts, rarest catch (max `rarity_bucket`).
4. Fire `supabase.rpc('suggest_pokedex_target', { viewer_id: user.id })` for tile 3.
5. Render hero (3-tile or compact based on viewport — CSS-driven).
6. Render kingdom pills + cards.

**`/explorar/especies/`** (ExploreSpeciesView):
1. Fetch `featured_species_current` (1 row, public).
2. Fetch `mv_platform_stats` (1 row, public).
3. Existing fetch path: `observations.primary_taxon_id` aggregation + `taxa` join. Extend the `taxa` SELECT to also pull a thumbnail. Easiest: parallel `from('media_files')` query on a sample observation per taxon, OR add a `taxa_thumbnails` view (taxon_id + url + computed_at, refreshed daily). **Go with the view** — keeps client code thin and the ranking logic centralised.
4. If logged in, also fetch `profile_pokedex` for viewer — build `Set<taxon_id>` for ✓ marker.
5. Apply URL filter chips state to result list.
6. Render hero, tabs, search, chips, cards.

`taxa_thumbnails` view:

```sql
CREATE OR REPLACE VIEW public.taxa_thumbnails AS
SELECT t.id AS taxon_id,
       (SELECT mf.url FROM public.media_files mf
          JOIN public.observations o ON o.id = mf.observation_id
          JOIN public.identifications i ON i.observation_id = o.id
          WHERE i.is_primary AND i.taxon_id = t.id AND o.sync_status = 'synced'
            AND o.obscure_level <> 'full'
          ORDER BY mf.is_primary DESC NULLS LAST, mf.created_at DESC LIMIT 1) AS thumbnail_url
FROM public.taxa t;
GRANT SELECT ON public.taxa_thumbnails TO anon, authenticated;
```

Cost: one LATERAL-style subquery per taxon row queried; the catalog page caps at the 2000-obs aggregation already, so this is fine. If pagination becomes painful later, materialize.

### Error / loading / edge states

| State | Pokédex | Especies |
|---|---|---|
| Loading | Skeleton matching final layout: 3 tile placeholders, skeleton pills, 8 card skeletons | Featured panel skeleton (dark gradient with shimmer), 4 stat blanks, 6 card skeletons |
| Empty (anon visiting Pokédex own) | Tile 1 → "Empieza tu Pokédex" + CTA `/observar`; tile 2 hidden; tile 3 generic suggestion | n/a — no auth required |
| Empty (no species at all) | Centered message "Aún no hay especies — registra tu primera observación" + CTA | "El catálogo aún no tiene especies sincronizadas" + CTA `/observar` |
| Error (network) | Inline error pill below header, retry button | Same |
| Visitor mode (Pokédex of `@otherUser`) | Tile 3 hidden (no suggestions for others); tile 1 + tile 2 reflect target user; everything else identical | n/a |
| Private profile (`pokedex` facet hidden) | Existing visitor-private message preserved | n/a |

Featured species fallback: if `featured_species_current` returns 0 rows (catalog too small / no recent obs), the featured panel collapses and the stats expand to full width.

### i18n

All new strings under two new namespaces in `src/i18n/{en,es}.json`:

- `pokedex.hero.*` — total label, kingdom labels, "rareza más alta", "para cazar", CTA strings, empty-state copy
- `species.hero.*` — "destacada de la semana", stat labels, chip labels, "sin foto aún", "ya en tu dex"

EN/ES parity enforced. Existing `pokedex.bucket.{1..5}` and `pokedex.title/subtitle/empty` keys reused.

Plural rules use the existing pattern from M28: `obs_count_one`, `obs_count_other`. Spanish "1 observación / 2 observaciones".

### Performance

- Photos: served from existing R2 bucket via `media.rastrum.org`. Thumbnail size: feed `?w=400&q=70` query param (R2 transform if available; else use a CSS-cropped full image and accept the bytes — the R2 worker for transforms is already deployed for share cards).
- All photos below the fold use `loading="lazy"` (CLAUDE.md convention).
- Hero tile 2 / tile 3 photos and the featured species photo are above-fold → default loading.
- Total payload budget: < 250 KB initial photos on a fresh Especies page (≈ 6 cards × 25 KB + featured 70 KB + tile photos ≈ 30 KB).

### Accessibility

- Photos use scientific name as `alt` (e.g., `alt="Aratinga canicularis"`).
- Pill labels have visible text + `aria-label` with full meaning ("rareza notable" not just "★ Notable").
- Featured panel: H3 receives the species name, badges are described in `aria-label` on the badge container.
- Color is never the sole distinguisher: pills always pair color + text; kingdom dots pair color + label.
- Tab navigation reaches all interactive elements; chip strip uses `role="tablist"` only if active state is exclusive — for the multi-select chip strip, plain buttons with `aria-pressed`.

### Telemetry (light, no analytics provider mandated)

`rastrum:onboarding-event`-style DOM events (existing pattern from M18) for:
- `pokedex.hero.tile_clicked` { tile: 'showcase' | 'discovery' }
- `pokedex.kingdom.filtered` { kingdom }
- `species.featured.clicked` { taxon_id }
- `species.chip.toggled` { chip, active }

Let operators wire to whatever they want in `BaseLayout.astro`.

## Migration / build sequence

1. **Schema** (`docs/specs/infra/supabase-schema.sql`):
   - Drop & recreate `profile_pokedex` with new columns at end.
   - Add `taxa_thumbnails` view.
   - Add `featured_species_current` view.
   - Add `mv_platform_stats` materialized view + UNIQUE index + cron schedule.
   - Add `suggest_pokedex_target(uuid)` RPC.
2. **Components** — create `src/components/species/*` skeleton, types only, no logic.
3. **`SpeciesCard` + grid** — no-op tests pass; render statically with mock data; replace text-only cards in both views.
4. **Pokédex hero** (3-tile + compact) — tile 1 + 2 first, tile 3 with `suggest_pokedex_target` last.
5. **Especies hero** (featured + stats).
6. **Filter chips** with URL state.
7. **i18n strings** for both pages, EN + ES.
8. **Cross-page ✓ marker** on Especies cards.
9. **E2E + a11y** tests in Playwright suite.

## Testing

- Unit: card rendering with all pill states, missing-photo placeholder, all i18n locales (Vitest).
- Unit: filter-chip URL state serializer (round-trip `chips → URL → chips`).
- Unit: kingdom-filter logic (all / per-kingdom).
- Integration: Pokédex empty state for not-logged-in user, visitor mode for non-existent username, visitor mode for private profile.
- E2E (Playwright): smoke pass on both routes EN+ES, chip toggle stays in URL after reload, featured species clickable goes to species detail.
- pgTAP-ish: smoke check that `profile_pokedex` returns the expected columns, `mv_platform_stats` row exists post-refresh, `suggest_pokedex_target` returns 0 or 1 rows for arbitrary user_id.

## Open questions

1. **R2 thumbnail transform availability** — does `media.rastrum.org/...?w=400&q=70` already work, or do we need a worker change? Need to confirm before plan; if not, we serve full-size and accept the bytes for v1 or add it as a parallel sub-task.
2. **Featured species localisation** — featured-species text is currently the species' own data (sci name + common name from `taxa`); no localized "blurb". v1 ships with no blurb. v1.1 could pull a 1-2 sentence description from `taxa.description_es` / `taxa.description_en` if those columns end up populated.
3. **"+12 esta semana" delta** — current SQL counts species with their first-ever observation in the current ISO week. If a species was already observed but had its first synced this week, it counts. Confirm acceptable definition.

## Out of scope (deferred to v1.1)

- Silhouette grid of "all species you haven't seen in your region" (needs regional denominator).
- Per-species share cards from the dex page (have OG cards for the catalog already).
- Achievement / badge integration in the hero (M08 owns the badge surface).
- Personalised featured species per logged-in user (currently global).
- Server-paginated Especies list (current 2000-obs cap is fine for the dataset size).
