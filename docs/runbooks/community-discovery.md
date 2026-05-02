# Community discovery (Module 28) — runbook

> Operator runbook for the Community discovery surface (`/community/observers/`).
> Spec: `docs/superpowers/specs/2026-04-29-community-discovery-design.md`.
> Plan: `docs/superpowers/plans/2026-04-29-community-discovery-plan.md`.
> Module spec: `docs/specs/modules/28-community-discovery.md`.

## Architecture

- 6 new columns on `users`: `species_count`, `obs_count_7d`, `obs_count_30d`,
  `centroid_geog`, `country_code`, `hide_from_leaderboards` (PR1 #92)
  plus `country_code_source` `'auto'|'user'` (PR4 #102) tracking whether
  `country_code` was set by the user or inferred from `region_primary`.
- 7 partial indexes scoped to `WHERE NOT hide_from_leaderboards AND profile_public`.
  Opted-out users add zero cost to anyone's query plan. (Indexes still gate on
  `profile_public` for legacy reasons; harmless under the new default-true model.)
- `iso_countries` reference table seeded with 30 LatAm + common observer locales
  (idempotent `INSERT … ON CONFLICT DO UPDATE`). `pg_trgm` GIN indexes on
  `name_en` / `name_es` for fuzzy matching by `normalize_country_code(text)`.
- Two views with the same eligibility predicate
  (`hide_from_leaderboards = false`):
  - `community_observers` — anon + authenticated. **No centroid.** All discovery
    surfaces except Nearby read from this view.
  - `community_observers_with_centroid` — authenticated only. **Lack of GRANT to
    anon is the SQL-layer security gate** mirroring the UI sign-in requirement on
    Nearby.
- `recompute-user-stats` Edge Function (Deno, `--no-verify-jwt`) calls a
  `SECURITY DEFINER` SQL wrapper `public.recompute_user_stats()` that runs the
  CTE+UPDATE aggregate. Wrapper is `REVOKE ALL FROM PUBLIC` + `GRANT EXECUTE TO
  service_role` so anon/authenticated can't invoke it directly.

## Cron schedule

`recompute-user-stats-nightly` runs at **08:00 UTC**, slotted after the existing
`streaks-nightly` (07:00 UTC) and `badges-nightly` (07:30 UTC). Schedule lives in
`docs/specs/infra/cron-schedules.sql`. The 30-minute gap after badges-nightly is
adequate for typical scale; the recompute job is read-mostly with one bulk UPDATE.

## One-time backfill (formerly PR3 operator action — now CI/CD)

After all six PRs ship, the cron will start populating counters and centroids
for users who post new observations. To backfill **all existing users**
(including those who haven't posted recently) so the page shows useful data
on day 1, fire the CI workflow once:

```
GitHub Actions → Community discovery — manual backfill → Run workflow
```

The workflow is at `.github/workflows/community-backfill.yml`. It posts to the
deployed `recompute-user-stats` Edge Function (no shell needed) and surfaces
`{ rows_updated, elapsed_ms }` in the Actions UI as a notice annotation. At
v1 scale the run completes in under 2 seconds.

The workflow is idempotent — fire it again any time you want a fresh recompute
without waiting for the nightly 08:00 UTC tick.

**For local debugging** (developer machine, not the production backfill):

```bash
make db-cron-test   # fires streaks + badges + recompute-user-stats locally
```

## Privacy invariants — do NOT break

1. The eligibility predicate (`NOT hide_from_leaderboards`) lives in **one place
   per view**. Don't duplicate it elsewhere — adding new community queries should
   consume the views, not `users` directly. As of 2026-04-30 the predicate no
   longer references `profile_public`; M28 visibility is governed solely by its
   dedicated opt-out (`hide_from_leaderboards`).
2. `community_observers_with_centroid` is **never** granted to `anon`. Adding a
   `GRANT SELECT … TO anon` on it would break the privacy gate.
3. `country_code_source` is set to `'user'` only by the Profile → Edit save
   path; the cron never touches it. If you add a new mutation site for
   `country_code`, decide explicitly whether it's a user action (set source to
   `'user'`) or an inferred backfill (leave at default `'auto'`).
4. The Nearby feature is **sign-in gated in the UI** (`/community/observers/?nearby=true`).
   The SQL gate is enforced regardless via the centroid-view authentication
   requirement.

## i18n rewrites

Two production strings explicitly state "no leaderboards":

- `src/i18n/en.json:349` — `gamification_hint`
- `src/i18n/en.json:959` — `streak_enable_body`

Both have `es.json` mirrors. They are **rewritten atomically with PR6** when
the Community page is exposed. Do not flip them earlier, or the UI will say
"No leaderboards" while the feature is reachable. The rewrite turns "No
leaderboards" into "Community leaderboards are opt-in" and points to the
Profile → Edit toggle.

## Per-step PR map

| PR | Status | Scope |
|---|---|---|
| #92 | merged 2026-04-29 | PR1 — schema deltas + dual views + iso_countries seed + `normalize_country_code` |
| #96 | merged 2026-04-29 | PR2 — `recompute-user-stats` Edge Function + cron + `SECURITY DEFINER` wrapper |
| `community-backfill.yml` | shipped 2026-04-29 | PR3 — one-time backfill, automated as a GitHub Actions workflow_dispatch (formerly an operator curl) |
| #102 | merged 2026-04-29 | PR4 — Profile → Edit country picker + `hide_from_leaderboards` toggle + `country_code_source` |
| PR5+PR6 | merged 2026-04-29 | Atomic landing — `/community/observers/` page (CSR) + composable filter chips + URL-state serializer + `community_observers_nearby` SQL RPC + MegaMenu split (Biodiversity / Community columns) + MobileDrawer subheading + atomic i18n rewrite of the two production "no leaderboards" strings + OG card + Vitest + Playwright e2e + module status flip to "shipped" |

## UX clarifications (PR17, 2026-04-30)

### Why am I the only one I see? — historical context

**As of 2026-04-30 (PR after #229), this should no longer happen.** `users.profile_public`
default flipped from `false` → `true`, the M28 views dropped the
`profile_public = true AND` clause, and a one-time backfill flipped existing
`profile_public = false` users to `true`. /community/observers/ is now
default-discoverable; users are visible unless they explicitly toggle
`hide_from_leaderboards = true` from Profile → Edit.

The PR17 amber explainer banner still renders when the filtered query returns
0 rows (e.g., a country picker selecting an empty country, or expert-only with
no experts in the result), but the historical "everyone is private by default"
case no longer applies.

If you ever DO see only yourself unexpectedly, check:
1. Did the schema migration apply? `SELECT column_default FROM information_schema.columns WHERE table_name='users' AND column_name='profile_public';` should return `true`.
2. Did the backfill run? `SELECT count(*) FROM users WHERE profile_public = false;` should be 0 or near-0.
3. Did counters compute? `SELECT count(*) FROM users WHERE observation_count > 0 AND last_observation_at IS NOT NULL;` should match your active-user count.

### GPS vs centroid Nearby modes

The Nearby filter (`?nearby=true`) has two underlying paths:

1. **Centroid mode (default)** — calls `community_observers_nearby()`,
   which reads the viewer's stored `centroid_geog` (recomputed nightly
   from their observations). Brand-new users with zero observations see
   the empty-state CTA "Log an observation to find observers near you."
2. **GPS mode (PR17)** — clicking the "📍 Use my location" pill triggers
   `navigator.geolocation.getCurrentPosition()`, then calls
   `community_observers_nearby_at(lat, lng, …)` with caller-supplied
   coords. This unlocks Nearby for new users. On geolocation deny / not
   available, the page falls back to centroid mode and shows a friendly
   notice.

**Privacy: coords NEVER touch the URL.** Putting `?lat=…&lng=…` in the
querystring would leak via the `Referer` header on every outbound link
and bake into the user's browser history. Instead, coords live in
`sessionStorage` (key `rastrum.community.gps`), cleared automatically
when the tab closes. Regression guarded by `tests/unit/community-url.test.ts`
("NEVER serializes GPS coords into the URL").

The new RPC `community_observers_nearby_at(lat, lng, …)` is a sibling
of the existing centroid RPC: same `community_observers_with_centroid`
view, same `authenticated`-only `GRANT EXECUTE`, same SECURITY INVOKER.
The lack of `GRANT TO anon` is the security gate; the function body is
unreachable for anon callers regardless of the UI sign-in check.

## Future work (v1.1)

- ~~Observer heatmap / community map view.~~ **Shipped** — see "Community Map" section below.
- Mod-curated featured-observer lists.
- Time windows beyond `7d` / `30d` / all-time (the rollup-table refactor in the
  spec's "C" option).
- Materialized rollup table when `users` exceeds ~100k rows.

## Community Map (v1.1)

The community map page (`/community/map/` EN, `/comunidad/mapa/` ES) renders an
aggregated heatmap of observer activity using MapLibre GL.

### How it works

- **Anonymous users** see the map with country-level data from `community_observers`
  (no centroid). A sign-in hint encourages authentication for the full heatmap.
- **Authenticated users** get centroid data from `community_observers_with_centroid`.
  Individual centroids are aggregated into ~0.5° hex cells before rendering.
- Filter chips (country, expert, sort metric) mirror the `/community/observers/`
  pattern and update the heatmap in real time.
- A count badge shows "X observers in view" based on the current filter state.

### Privacy invariants (min 3 per cell)

The heatmap enforces a **minimum of 3 observers per hex cell** before rendering
that cell. This prevents individual observer locations from being inferred via
the heatmap. The aggregation happens client-side after fetching from the
auth-gated `community_observers_with_centroid` view.

- The `community_observers_with_centroid` view is **never** granted to `anon`.
  Anonymous users cannot access centroid data at all.
- Even for authenticated users, individual centroids are never displayed — only
  aggregated hex cells meeting the minimum threshold.

### SQL view dependency

The heatmap reads from the same two views as the observers list:

- `community_observers` — anon + authenticated, no centroid
- `community_observers_with_centroid` — authenticated only, includes
  `centroid_lat` / `centroid_lng` (derived from `centroid_geog`)

No new SQL views, RPCs, or schema changes are required. The nightly
`recompute-user-stats` cron keeps centroids up to date.

### Component structure

- `src/components/CommunityMapView.astro` — shared EN+ES view component
- `src/pages/en/community/map.astro` — EN page
- `src/pages/es/comunidad/mapa.astro` — ES page
- Route: `routes.communityMap = { en: '/community/map', es: '/comunidad/mapa' }`
- MegaMenu + MobileDrawer links under the Community column
