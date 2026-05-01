# Module 28 — Community discovery

**Status:** v1.0 — shipped 2026-04-29 (PR1 #92 + PR2 #96 + PR4 #102 + PR5+PR6 atomic landing)
**Spec source:** `docs/superpowers/specs/2026-04-29-community-discovery-design.md`
**Plan:** `docs/superpowers/plans/2026-04-29-community-discovery-plan.md`
**Runbook:** `docs/runbooks/community-discovery.md`
**Sequenced after:** Module 26 (social graph — provides `follows` table and `FollowButton`).

> **Numbering note.** The plan refers to this module as "Module 27", but
> `27-ai-sponsorships.md` was claimed first. This module ships under
> the next free number (`28`). The schema block below is labelled
> `Module 28` to match.

## Scope

- Discovery page at `/{en,es}/community/observers/` with composable filters: sort, country, taxon, experts-only, nearby.
- Schema deltas on `public.users`: `species_count`, `obs_count_7d`, `obs_count_30d`, `centroid_geog`, `country_code`, `country_code_source`, `hide_from_leaderboards`.
- Two views: `community_observers` (anon-safe) and `community_observers_with_centroid` (authenticated only, gates the Nearby feature at the SQL layer).
- New Edge Function `recompute-user-stats`, scheduled nightly (deferred to PR2).
- ISO-3166 reference table `iso_countries`, seeded with the Latin American countries plus common observer locales (US, CA, ES, PT, FR, GB, DE, IT). The seed is idempotent — additional codes can be appended later.
- Profile → Edit: country picker + `hide_from_leaderboards` opt-out toggle (deferred to PR4).
- Rewrite the two shipped "no leaderboards" i18n strings (en.json line 349, line 959, plus es.json mirrors) (deferred to PR5).

## Out of scope (parked to v1.1)

- Observer heatmap / community map view.
- Mod-curated featured-observer lists.
- Time windows beyond `7d`, `30d`, all-time.
- Cross-platform follow imports.

## Privacy invariants

- Eligibility predicate `hide_from_leaderboards = false` lives in exactly one place per view; both views read it live (no caching, no propagation delay). _As of 2026-04-30, the predicate no longer requires `profile_public = true`; M28 visibility decoupled from M08 binary privacy and is governed solely by its dedicated opt-out._
- Centroid is exposed only via the authenticated view; anon callers cannot read it via any path. The lack of a `GRANT SELECT … TO anon` on `community_observers_with_centroid` is the security gate.
- The Nearby feature is sign-in gated in the UI; the SQL gate is enforced regardless.
- `country_code` setter never overwrites a user-set value (the cron only writes when `country_code IS NULL`).
- `country_code_source` distinguishes auto-inferred from user-set values: defaults to `'auto'`; Profile → Edit save flips it to `'user'`. Used by the "inferred from your region" badge so the user can see when the country wasn't their choice and override it.

## PR sequence

| PR | Status | Scope |
|---|---|---|
| **PR1** (#92) | shipped | Schema deltas + dual views + 7 partial indexes + ISO countries seed + `normalize_country_code` |
| **PR2** (#96) | shipped | Edge Function `recompute-user-stats` + nightly cron + `recompute_user_stats()` SECURITY DEFINER wrapper |
| PR3 | operator-pending | Manual cron fire to backfill all users (`make db-cron-test` or curl POST against the Edge Function) |
| **PR4** (#102) | shipped | Profile → Edit: country picker + `hide_from_leaderboards` opt-out + `country_code_source` 'auto'/'user' badge |
| **PR5+PR6** | shipped (this PR) | `/community/observers/` page (CSR) + filter chips + URL-state serializer + `community_observers_nearby` SQL RPC + MegaMenu split (Biodiversity / Community columns) + MobileDrawer subheading + atomic i18n rewrite of the two production "no leaderboards" strings + OG card + tests + roadmap flip |

## Risks

See "Open questions" in the design spec; the plan resolves the SSR question (client-rendered) and the thumbnail question (deferred to v1.1).
