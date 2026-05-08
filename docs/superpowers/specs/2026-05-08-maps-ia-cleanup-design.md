# Maps IA cleanup — design

> Date: 2026-05-08
> Scope: `/explore/map/` and `/community/map/` confusion in the header MegaMenu
> Status: design approved; ready for implementation plan

## Context

Today the header MegaMenu surfaces two map items, both labelled simply
"Map", in adjacent columns:

- **Biodiversity column** → "Map" → `/{en,es}/explore/map/` (and `/explorar/mapa/`) — the `ExploreMap.astro` component, fed from the `observations` table. Each point is one observation; clusters indicate density of biodiversity records. Privacy is gated by per-species `obscure_level` (NOM-059, CITES).
- **Community column** → "Map" → `/{en,es}/community/map/` — the `CommunityMapView.astro` component, fed from the `community_observers[_with_centroid]` views. Each point is an observer's coarsened centroid. Anonymous viewers see no centroid; authenticated viewers see centroids; precise nearby coordinates require sign-in (`docs/runbooks/community-discovery.md`).

Conceptually the two views answer different questions — "where is biodiversity being recorded?" vs. "where are observers active?" — so the two pages are *not* redundant. But the shared "Map" label and side-by-side placement in the MegaMenu force users to read column headers to disambiguate, which is friction every visit.

The brainstorm explored four approaches:

| | Cost | UX gain | Engineering risk |
|---|---|---|---|
| A · Status quo | 0 | Confusion stays | None |
| B · Rename + cross-link | ~1 hour | Removes label collision; preserves URLs/SEO | Trivial — i18n only |
| C · Single map with tabs (Observations / Observers / Hotspots) | 1–2 days | Cleaner top-level IA but "Hotspots" is just a render mode of observations, not a separate domain | Adds 6 (tab × overlay) UI states to test |
| D' · Single map, filter sidebar + layer toggles + render-mode toggle | 2–4 days | Matches industry pattern (iNaturalist/GBIF/eBird); best long-term | One unified component; meaningful refactor |

C looked good in the first pass but on closer inspection its third tab is a render variant of the first, which dresses up the IA but doesn't clarify it. D' is the architecturally-correct destination but is a real refactor.

## Decision

**Two-stage approach: ship B now, file D' as a v1.1 issue.**

- **B** removes the MegaMenu label collision in ~1 hour with zero URL or routing changes. SEO and external deep-links are preserved. Community map's privacy gate is untouched.
- **D'** is the architecturally correct destination but a real refactor. Filing it as a tracked issue (with the rationale + scope outline below) preserves the design conversation and lets the work land cleanly when there's bandwidth, without holding the immediate fix hostage.

C+overlay was considered and rejected: it solves the IA collision but introduces an awkward "Hotspots tab" that is really a render mode, and adds tab-state combinatorics that D' subsumes more cleanly.

## B — design

### Label changes (i18n only)

`src/i18n/en.json`:

```diff
   "explore_dropdown": {
-    "map": "Map",
+    "map": "Observations map",
     "recent": "Recent",
     "watchlist": "Watchlist",
     "species": "Species"
   },
   "explore_megamenu": {
     ...
-    "community_map": "Map",
+    "community_map": "Observers map",
     ...
   }
```

`src/i18n/es.json`:

```diff
   "explore_dropdown": {
-    "map": "Mapa",
+    "map": "Mapa de observaciones",
     ...
   },
   "explore_megamenu": {
     ...
-    "community_map": "Mapa",
+    "community_map": "Mapa de observadores",
     ...
   }
```

The route slugs in `src/i18n/utils.ts` (`routes.exploreMap`, `routes.communityMap`) **do not change**. URLs stay identical.

### Page titles

`/explore/map/` currently uses `tr.map.title` ("Map"). Update to "Observations map" / "Mapa de observaciones". Same key, new value:

```diff
   "map": {
-    "title": "Map",
+    "title": "Observations map",
     ...
   }
```

`/community/map/` currently uses `tr.community.map_title` ("Community Map"). Update to "Observers map" / "Mapa de observadores":

```diff
   "community": {
-    "map_title": "Community Map",
+    "map_title": "Observers map",
     ...
   }
```

The `description` meta on each page already references the right concept (biodiversity observations vs. observer activity); no change needed there.

### Cross-link banner

A single thin banner directly above the MapLibre canvas — below the page `<h1>`, full-width, one line of text plus an inline link, pointing to the *other* map. Both maps live under the Explore section conceptually, so the banner uses the muted zinc text style (`text-zinc-500 dark:text-zinc-400 text-xs`) with the link itself in `text-emerald-600 dark:text-emerald-400` (the link colour used elsewhere in Explore views). The banner is informational, not navigational — it should not compete visually with the map.

On `/explore/map/`:

> Looking for observers near you? See **Observers map** →

On `/community/map/`:

> Looking for biodiversity observations? See **Observations map** →

Implementation lives in each map's component:

- `src/components/ExploreMap.astro` → banner with `href={routes.communityMap[locale]}`, target text from a new i18n key `map.cross_link.to_observers`.
- `src/components/CommunityMapView.astro` → banner with `href={routes.exploreMap[locale]}`, target text from a new i18n key `community.cross_link.to_observations`.

Banner styling: the existing `text-zinc-500 dark:text-zinc-400 text-xs` pattern used for tab subtitles in `ExploreSpeciesView.astro` keeps it understated — informational, not promotional.

Dismissibility: not in v1. The banner is small and contextual; if telemetry later shows users actually annoyed, add a localStorage-based dismissal then.

### Out of scope for B

- Route changes / redirects — preserved as-is.
- MegaMenu structural changes — preserved as-is.
- Mobile drawer (`MobileDrawer.astro`) — uses the same i18n keys, so it picks up the new labels automatically.
- Analytics events for the cross-link click — useful telemetry, but a v1.1 follow-up under D'.

## D' — future scope (issue body)

A separate GitHub issue captures the architecturally-correct future:

> **Title:** Unified `/explore/map/` with filters, layers, and render modes
>
> **Why:** B fixes the labels but the deeper duplication remains — two MapLibre instances, two data-fetch paths, two implementations of clustering and privacy. The industry pattern for biodiversity maps (iNaturalist, GBIF, eBird) is one canvas with rich filtering, not separate routes per data type.
>
> **Scope:**
> 1. Unify both maps into a single component under `/explore/map/`. `/community/map/` 301-redirects to `/explore/map/?layers=observers&overlay=none`.
> 2. **Layer toggles** (multi-select): `Observations · Observers · Places · Projects (ANP)`. Default = `observations` only.
> 3. **Render-mode toggle** (single-select): `Dots · Clusters · Heatmap`. Default = `clusters`.
> 4. **Filter sidebar / mobile sheet**: taxon, kingdom, date range, observer (by handle), project. URL-encoded so views are sharable.
> 5. Privacy gates preserved: the `Observers` layer requires authentication for non-centroid precision; obscure-level rules apply to `Observations` exactly as today.
> 6. **MobileBottomBar / MobileDrawer**: single "Map" entry; the page handles all variants.
> 7. **Telemetry**: track which layer combinations users actually pick — informs whether layered defaults should change.
>
> **Out of scope (v1.2+):** time-slider, custom palette per kingdom, GeoJSON export from the current view, polygon-draw filter.
>
> **Risks / dependencies:** the largest open question is mobile UX for the filter sheet — bottom-sheet vs slide-over vs collapsible-drawer. Recommend a wireframing pass before implementation, comparing against how `ConsoleLayout`'s mobile drawer (`md:hidden` + `MobileDrawer.astro`) handles a similar role-scoped panel today.

The issue is filed in this PR's branch using `gh issue create` so it's discoverable from the PR description.

## Test plan (B)

- `npx tsc --noEmit` — clean (i18n only, no type changes).
- `npm run test` — full suite green; existing 1042 tests unaffected.
- `npm run build` — 231 pages still build; verify EN/ES parity on both map pages.
- Visual check on `/{en,es}/{explore,explorar}/{map,mapa}/`:
  - MegaMenu now shows "Observations map" + "Observers map" (or ES equivalents).
  - Page `<title>` matches the new label.
  - Cross-link banner visible above each map; clicking it lands on the other map's page.
- Mobile (`MobileBottomBar`, `MobileDrawer`): same labels appear; no regressions.
- ES parity: every EN string change has a paired ES change.

## Migration notes

None — URLs unchanged. External backlinks to `/community/map/` and `/explore/map/` continue to resolve. SEO is preserved (the page title change is a minor on-page update that search engines reconcile within a normal crawl cycle).

## References

- [`docs/runbooks/community-discovery.md`](../../runbooks/community-discovery.md) — privacy model for the observers map (still applies post-B).
- [`docs/specs/modules/00-index.md`](../../specs/modules/00-index.md) — module catalog (no entries change).
- [`AGENTS.md`](../../../CLAUDE.md) — chrome-mode + IA conventions; rail-accent rules apply to the cross-link banner styling.
