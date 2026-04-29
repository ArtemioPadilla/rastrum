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
  Opted-out / private users add zero cost to anyone's query plan.
- `iso_countries` reference table seeded with 30 LatAm + common observer locales
  (idempotent `INSERT … ON CONFLICT DO UPDATE`). `pg_trgm` GIN indexes on
  `name_en` / `name_es` for fuzzy matching by `normalize_country_code(text)`.
- Two views with the same eligibility predicate
  (`profile_public = true AND hide_from_leaderboards = false`):
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

## Manual cron fire (PR3 backfill — operator action)

After PR2 merges and the Edge Function auto-deploys, the cron will start
populating counters and centroids for users who post new observations. To
backfill **all existing users** (including those who haven't posted recently) so
the page shows useful data on day 1:

```bash
# Local — uses SUPABASE_SERVICE_ROLE_KEY from .env.local
make db-cron-test
# That fires recompute-streaks + award-badges + recompute-user-stats.

# Or hit the Edge Function directly (CI / remote operator):
curl -X POST \
  -H "Content-Type: application/json" \
  -d '{}' \
  "https://reppvlqejgoqvitturxp.supabase.co/functions/v1/recompute-user-stats"
```

The function returns `{ ok, elapsed_ms, rows_updated }`. At the v1 scale this is
under 2 seconds; expect a few minutes once the table grows past 100k users.

**Sequencing:** Run this **before** the Profile → Edit country picker is
exposed (PR4) so users see the inferred country *and* the "inferred from your
region" badge from the start, instead of a NULL field that gets backfilled days
later.

## Privacy invariants — do NOT break

1. The eligibility predicate (`profile_public AND NOT hide_from_leaderboards`)
   lives in **one place per view**. Don't duplicate it elsewhere — adding new
   community queries should consume the views, not `users` directly.
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
| (operator) | planned | PR3 — manual cron fire to backfill (see "Manual cron fire" above) |
| #102 | merged 2026-04-29 | PR4 — Profile → Edit country picker + `hide_from_leaderboards` toggle + `country_code_source` |
| TBD | planned | PR5 — `/community/observers/` page + filter chips + URL-state serializer + tests |
| TBD | planned | PR6 — MegaMenu split + atomic i18n rewrite + roadmap entry + module status flip to "shipped" |

## Future work (v1.1)

- Observer heatmap / community map view.
- Mod-curated featured-observer lists.
- Time windows beyond `7d` / `30d` / all-time (the rollup-table refactor in the
  spec's "C" option).
- Materialized rollup table when `users` exceeds ~100k rows.
