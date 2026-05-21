# Explore UI — recent / species / watchlist

The three `/explore/*` (`/explorar/*`) surfaces wired in v1.0.x. Each is a
client-rendered grid backed by Supabase; the page shells are static Astro,
all data + i18n are runtime.

## Roadmap items this covers

- `explore-recent-ui` — `/explore/recent/` (ES `/explorar/reciente/`):
  latest 20 public observations grid (photo, scientific + common name,
  confidence, observer link, load-more).
- `explore-species-ui` — `/explore/species/` index + `?slug=…` detail
  (search, conservation badges, taxonomy chain, distribution mini-map,
  recent photo strip).
- `explore-watchlist-ui` — `/explore/watchlist/`: mounts
  `WatchlistView.astro` with a sign-in CTA for anonymous visitors.

## Components

| Surface | Astro page | Shared view | Data source |
|---|---|---|---|
| Recent | `src/pages/{en,es}/explore/recent.astro` (slug pair) | `ExploreRecentView.astro` | `mv_recent_species` materialized view + `media_files` side-fetch |
| Species index + detail | `.../explore/species.astro` | `ExploreSpeciesView.astro` | `taxa` + `mv_recent_species` + `taxon_range_index` (distribution mini-map) |
| Watchlist | `.../explore/watchlist.astro` | `WatchlistView.astro` | `watchlist` table + observation join |

## Invariants

1. **Locale slugs are paired.** Routes live in `src/i18n/utils.ts`
   `routes.exploreRecent` / `routes.exploreSpecies` /
   `routes.exploreWatchlist`; the EN + ES slugs must be added together
   per CLAUDE.md "EN/ES parity is a hard rule".
2. **`share/obs/?id=…` links are locale-neutral.** Per the known
   pitfall: every explore row's link MUST use `/share/obs/?id=` (no
   locale prefix). Regression covered by `tests/e2e/smoke.spec.ts`
   ("share/obs/ is locale-neutral"). Bit ExploreSpecies + ExploreRecent
   once (fixed 2026-04-27).
3. **`mv_recent_species` SELECTs `primary_taxon_id`** (not `taxon_id`).
   The column was renamed PR #1002; the matview must follow per the
   #1011 schema-drift bug. Audit via
   `tests/unit/consensus-untouched.test.ts` adjacent guards.
4. **Below-fold images are `loading="lazy"`** — every grid thumbnail
   and reference photo per CLAUDE.md "Code style".
5. **MegaMenu wiring.** Explore is the only top-level `▾` dropdown
   that splits into Biodiversity + Community columns (M28). Adding a
   new explore subroute needs both an entry in `MegaMenu.astro` AND a
   row in `journey-catalog.md` §1; the CI route-spine diff
   (`journey-catalog-complete.test.ts`) fails otherwise.

## Sign-in gating

Watchlist is the only `/explore/*` surface that gates on auth. Anonymous
visitors see `WatchlistView`'s sign-in CTA (`labels.signinPrompt` in
the `validation` i18n namespace, shared with the validate queue). Recent
+ Species are anon-readable; the `mv_recent_species` view is GRANTed to
`anon` + `authenticated`.

## E2E coverage

- `tests/e2e/smoke.spec.ts` loads `/en/explore/` + `/es/explorar/` and
  asserts no console error (the index page).
- The route spine is asserted by `tests/unit/journey-catalog-complete.test.ts`.
- There is **no journey-explore spec** today — explore is read-only
  enough that smoke + the route-spine guard are considered sufficient
  per qa-policy "add tests sparingly".

## When you ship a new explore subroute

1. Add to `routes` in `src/i18n/utils.ts` (slug pair EN + ES).
2. Add row to `docs/journey-catalog.md` §1 (CI requires it).
3. Add to the Explore MegaMenu (`src/components/MegaMenu.astro`).
4. If it ranks anything, register an `AlgorithmId` in
   `src/lib/algorithms.ts` per CLAUDE.md "Persuasive Tech" rule 1.
