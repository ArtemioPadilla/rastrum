# Community discovery in Explore (observers, leaderboards, nearby)

**Date:** 2026-04-29
**Status:** Design — pending user review
**Owner:** Artemio Padilla
**Related modules:** 04 (auth/users), 08 (profile / activity / gamification), 25 (profile privacy + public profiles), `2026-04-26-ux-revamp-design.md` (chrome / IA), `2026-04-28-social-features-design.md` (M26 follow + privacy ladder).

---

## Goals

1. Add a **community discovery surface** to Rastrum so signed-in users can find other observers — by activity, taxon expertise, country, or proximity — and follow them.
2. **Walk back** the shipped "no leaderboards" stance with explicit, granular consent. Discovery is opt-out at the user level, opt-out at the profile-visibility level, and never surfaces precise location.
3. Stay **zero-cost** on infrastructure — no new paid services, no new compute beyond the existing Supabase free tier, no new external dependencies. All ranking is precomputed nightly into denormalized columns; queries hit partial indexes.
4. Reuse the existing `MegaMenu.astro`, the existing pmtiles map stack, and the existing follow / privacy primitives shipped in M26.

## Non-goals

- Real-time / streaming leaderboards. Nightly refresh is enough for community discovery; "top this week" doesn't need minute-level freshness.
- An observer **heatmap** or community map view. Tempting, but punted to v1.1 ("Community Map") so this spec stays scoped.
- Cross-platform discovery (importing iNaturalist follow graphs etc.). Rastrum-local only.
- Mod-curated featured-observer lists. v1.0 is purely algorithmic + opt-out; editorial picks are v1.1.
- New gamification mechanics — no new badges, points, or competitive UX. This is *discovery* infrastructure, not a game.
- Time-window slicing beyond `7d` and `30d` denorm counters. "All time" remains the default; arbitrary windows are out of scope.

---

## Decisions captured (brainstorming outcome)

| Axis | Decision | Rationale |
|---|---|---|
| Principle | **Walk back "no leaderboards"** with explicit consent | User wants full discovery surface incl. ranked lists; principle preserved as opt-out |
| IA | **Promote `Explore ▾` to MegaMenu**, two columns: Biodiversity / Community | Reuses existing `MegaMenu.astro`; clean conceptual divider; scales to future Community surfaces |
| Surface | **One page, composable filter chips**, not separate pages per lens | Filters compose ("top in Mexico filtering Aves"); single ranking algorithm; one route to maintain |
| Time windows | **Include 7-day and 30-day** as denorm counters; no arbitrary windows | "Top this week" is a real UX win; cheap on denorm columns; broader windows are v1.1 |
| Ranking architecture | **Denorm columns + nightly cron** (not live aggregates, not materialized rollup) | Cheapest at zero-cost target; scales fine through 100k obs; staleness of 24 h acceptable for discovery |
| Privacy gate | **Single `hide_from_leaderboards` opt-out**, AND requires `profile_public` | Honors existing visibility setting; new toggle separates "ranked" consent from "visible" consent |
| Nearby gate | **Sign-in required** | Sidesteps anonymous geolocation cost + privacy ick; "log an observation to see nearby observers" is a healthy CTA |
| Country source | **`country_code` column on `users`**, backfilled from `region_primary` once via in-Postgres ISO-3166 normalizer; user-editable on Profile → Edit | Avoids per-request geocoding; single source of truth; fixable by user when normalizer guesses wrong |

---

## Information architecture

### MegaMenu shape (`src/components/Header.astro` + `MegaMenu.astro`)

```
Explore ▾
┌─────────────────────────────────┬─────────────────────────────────┐
│ BIODIVERSITY                    │ COMMUNITY                       │
│   • Map                         │   • Observers (all)             │
│   • Recent                      │   • Top observers               │
│   • Watchlist                   │   • Nearby     (sign-in gated)  │
│   • Species                     │   • Experts by taxon            │
│   • Validate                    │   • By country                  │
└─────────────────────────────────┴─────────────────────────────────┘
```

- The Biodiversity column is the existing flat dropdown's contents — no behavior change.
- The Community column items all link into a single page with different default filters (see "Filter presets" below).
- The Nearby item is **disabled with a tooltip** for signed-out viewers ("Sign in to find observers near you").

### Mobile drawer (`src/components/MobileDrawer.astro`)

Single grouped section with two sub-headings (`Biodiversity`, `Community`) and a thin divider between them. Same items as desktop, no Nearby gating in the drawer (taps fall through to the page's own empty state).

### Routes

| EN | ES |
|---|---|
| `/en/community/observers/` | `/es/comunidad/observadores/` |
| `/en/community/observers/?sort=obs_count_7d` | `/es/comunidad/observadores/?sort=obs_count_7d` |
| `/en/community/observers/?nearby=true` | `/es/comunidad/observadores/?nearby=true` |
| `/en/community/observers/?taxon=Aves` | `/es/comunidad/observadores/?taxon=Aves` |
| `/en/community/observers/?country=MX` | `/es/comunidad/observadores/?country=MX` |

Add to `src/i18n/utils.ts`:

```ts
community: { en: '/community', es: '/comunidad' },
communityObservers: {
  en: '/community/observers',
  es: '/comunidad/observadores',
},
```

### Filter presets per MegaMenu link

| MegaMenu link | URL params |
|---|---|
| Observers (all) | `?sort=observation_count` |
| Top observers | `?sort=obs_count_30d` |
| Nearby | `?nearby=true&sort=distance` |
| Experts by taxon | `?expert=true` (opens taxon-facet picker if no taxon param) |
| By country | `?country=` (opens country-facet picker if blank) |

---

## Page design — `/community/observers/`

### Layout

```
┌──────────────────────────────────────────────────────────────────┐
│ H1: Community observers      [ Profile → Edit ↗ opt-out link ]   │
│ Sub: Find observers by activity, expertise, location, or country │
├──────────────────────────────────────────────────────────────────┤
│ Filter chips (sticky):                                           │
│ [ Sort: Most species ▾ ] [ Country: Any ▾ ]                      │
│ [ Taxon: Any ▾ ] [ Experts only ☐ ] [ Nearby ☐ ]                 │
├──────────────────────────────────────────────────────────────────┤
│ Result list (paginated, 20 per page):                            │
│ ┌──────────────────────────────────────────────────────────────┐ │
│ │ [avatar] @username · Display Name                  Follow ▸  │ │
│ │ 🇲🇽 Mexico · Birds, Plants                                    │ │
│ │ 1,247 obs · 312 species · last seen 2d ago                   │ │
│ └──────────────────────────────────────────────────────────────┘ │
│ ...                                                              │
└──────────────────────────────────────────────────────────────────┘
```

### Sort options

| Value | Label (EN) | Underlying column | Index |
|---|---|---|---|
| `observation_count` | Most observations (all-time) | `observation_count` | `idx_users_lb_obs_count` |
| `species_count` | Most species | `species_count` | `idx_users_lb_species` |
| `obs_count_7d` | Most active this week | `obs_count_7d` | `idx_users_lb_obs_7d` |
| `obs_count_30d` | Most active this month | `obs_count_30d` | `idx_users_lb_obs_30d` |
| `last_observation_at` | Recently active | `last_observation_at` | (existing) |
| `joined_at` | Newest | `joined_at` | (existing) |
| `distance` | Nearest to me | `centroid_geog` `<->` viewer | `idx_users_lb_centroid` (GIST) |

### Composable filters

- `country=MX` — single ISO-3166-alpha-2 code; partial index on `country_code` makes this fast.
- `taxon=Aves` — matches against `expert_taxa text[]` (GIN index). Multiple taxa supported via `taxon=Aves,Plantae`.
- `expert=true` — restricts to `is_expert = true`.
- `nearby=true` — adds `ST_DWithin(centroid_geog, viewer_centroid, 200000)` (200 km) clause; requires viewer's centroid (sign-in + at least one obs). Also forces `sort=distance` if no other sort given.

All filters compose via `WHERE` AND across the partial-indexed view `community_observers` (defined below).

### Empty states

- No results match filters: *"No observers match these filters. Try removing one."*
- Nearby with no viewer centroid: *"Log an observation to find observers near you."* + CTA → `/{en,es}/observe/`.
- Anonymous viewer hits Nearby URL directly: *"Sign in to find observers near you."* + CTA → `/{en,es}/sign-in/`.

---

## Schema — additive, idempotent

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS species_count          int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS obs_count_7d           int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS obs_count_30d          int  NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS centroid_geog          geography(POINT, 4326),
  ADD COLUMN IF NOT EXISTS country_code           text CHECK (country_code ~ '^[A-Z]{2}$'),
  ADD COLUMN IF NOT EXISTS hide_from_leaderboards boolean NOT NULL DEFAULT false;

-- Partial indexes — every list query operates on an already-filtered set,
-- so opted-out / private users add zero cost to anyone's query plan.
CREATE INDEX IF NOT EXISTS idx_users_lb_obs_count ON public.users (observation_count DESC)
  WHERE NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_species   ON public.users (species_count     DESC)
  WHERE NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_obs_7d    ON public.users (obs_count_7d      DESC)
  WHERE NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_obs_30d   ON public.users (obs_count_30d     DESC)
  WHERE NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_country   ON public.users (country_code)
  WHERE country_code IS NOT NULL AND NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_centroid  ON public.users USING GIST (centroid_geog)
  WHERE centroid_geog IS NOT NULL AND NOT hide_from_leaderboards AND profile_public;

CREATE INDEX IF NOT EXISTS idx_users_lb_expert_taxa ON public.users USING GIN (expert_taxa)
  WHERE NOT hide_from_leaderboards AND profile_public;

-- Single view consumed by the community page. Centralizing the eligibility
-- predicate (`profile_public AND NOT hide_from_leaderboards`) means the
-- predicate appears in exactly one place in application code and exactly
-- one place in the SQL.
-- Two views: an anon-safe one without geographic data, and an authenticated-
-- only one that adds the centroid for the Nearby feature. This addresses the
-- privacy concern that even a coarse 200 km centroid could narrow location
-- for low-obs-count users when exposed without authentication.
CREATE OR REPLACE VIEW public.community_observers AS
SELECT
  id, username, display_name, avatar_url, country_code,
  expert_taxa, is_expert,
  observation_count, species_count, obs_count_7d, obs_count_30d,
  last_observation_at, joined_at
FROM public.users
WHERE profile_public = true
  AND hide_from_leaderboards = false;

GRANT SELECT ON public.community_observers TO anon, authenticated;

-- Same eligibility predicate, plus centroid_geog. Authenticated only.
-- The Nearby feature is sign-in-gated in the UI, and this view enforces
-- the gate at the SQL layer too — anon callers cannot read centroid even
-- if they bypass the UI.
CREATE OR REPLACE VIEW public.community_observers_with_centroid AS
SELECT
  id, username, display_name, avatar_url, country_code,
  expert_taxa, is_expert,
  observation_count, species_count, obs_count_7d, obs_count_30d,
  centroid_geog, last_observation_at, joined_at
FROM public.users
WHERE profile_public = true
  AND hide_from_leaderboards = false;

GRANT SELECT ON public.community_observers_with_centroid TO authenticated;

-- ISO-3166 reference table seeded once; used by the country-code normalizer
-- in recompute-user-stats and by the Profile → Edit country picker.
CREATE TABLE IF NOT EXISTS public.iso_countries (
  code text PRIMARY KEY CHECK (code ~ '^[A-Z]{2}$'),
  name_en text NOT NULL,
  name_es text NOT NULL
);

GRANT SELECT ON public.iso_countries TO anon, authenticated;
```

### Why a view, not direct queries against `users`?

1. The eligibility predicate has two parts (`profile_public` + `NOT hide_from_leaderboards`); centralizing it in a view prevents drift if either rule evolves.
2. RLS on `users` already exposes only-self for many columns; the view exposes only the discovery-safe columns (no email, no streak counters, no admin flags).
3. The community page can `select('*')` against the view and trust the predicate.

### Why two views?

`community_observers` (anon + authenticated) supports the public list, sort, country filter, taxon filter, and experts filter — none of which need the centroid. `community_observers_with_centroid` (authenticated only) is consumed exclusively by the Nearby feature, which already requires sign-in for product reasons (a viewer needs at least one observation to compute their own centroid). Splitting the views means anon callers cannot read `centroid_geog` even via direct PostgREST traffic. The cost is one extra view definition; the benefit is the privacy gate is enforced at the SQL layer, not just in the UI.

### Behavior when a user toggles `profile_public = false`

Because both views read `profile_public` live (no caching, no nightly cron involvement on this column), a user who flips their profile from public to private drops out of `community_observers` and `community_observers_with_centroid` on their next request — no propagation delay. This matters for the rollout plan (step 4 below) and for the user mental model: privacy changes are immediate, not eventually-consistent.

### RLS

- View `community_observers` inherits the `users` table's RLS but the predicate filters at the view level. No new policies needed.
- `iso_countries`: enable RLS, single `SELECT TO PUBLIC` policy, no writes from the application.

---

## Cron — `recompute-user-stats`

New Edge Function `supabase/functions/recompute-user-stats/index.ts`. Deno, deployed via the existing `deploy-functions.yml` workflow (auto-deploys on push to main). Scheduled via pg_cron in `docs/specs/infra/supabase-schema.sql` alongside `recompute-streaks` and `award-badges`.

### Schedule

Nightly at 08:00 UTC, slotted after the existing `streaks-nightly` (07:00 UTC) and `badges-nightly` (07:30 UTC) cluster in `docs/specs/infra/cron-schedules.sql`. The 30-minute gap after badges-nightly is enough headroom; the recompute job is read-mostly with one bulk UPDATE so contention with badges (which writes user_badges) is minimal even if badges runs long.

The schedule registration goes into `docs/specs/infra/cron-schedules.sql` alongside the existing entries, in the same `DO $$ ... v_base := … $$` block. Match the existing cron pattern verbatim — `recompute-user-stats` is deployed `--no-verify-jwt` (cron-only, not user-facing), so no Authorization header is needed and no Bearer token / vault read is involved.

```sql
PERFORM cron.unschedule('recompute-user-stats')
  FROM cron.job WHERE jobname = 'recompute-user-stats';

PERFORM cron.schedule('recompute-user-stats', '0 8 * * *', format($body$
  SELECT net.http_post(
    url     := %L,
    headers := '{"Content-Type":"application/json"}'::jsonb,
    body    := '{}'::jsonb
  );
$body$, v_base || '/recompute-user-stats'));
```

### Function logic

Single SQL block executed by the function:

```sql
WITH stats AS (
  SELECT
    o.observer_id AS uid,
    COUNT(*)::int                                          AS obs_total,
    COUNT(DISTINCT i.taxon_id)::int                        AS species_total,
    COUNT(*) FILTER (WHERE o.observed_at >= now() - interval '7 days')::int  AS obs_7d,
    COUNT(*) FILTER (WHERE o.observed_at >= now() - interval '30 days')::int AS obs_30d,
    ST_Centroid(ST_Collect(o.location::geometry))::geography AS centroid
  FROM public.observations o
  LEFT JOIN public.identifications i
    ON i.observation_id = o.id AND i.is_primary = true
  WHERE o.sync_status = 'synced'
    AND o.location IS NOT NULL
  GROUP BY o.observer_id
)
UPDATE public.users u
SET
  observation_count = COALESCE(s.obs_total, 0),
  species_count     = COALESCE(s.species_total, 0),
  obs_count_7d      = COALESCE(s.obs_7d, 0),
  obs_count_30d     = COALESCE(s.obs_30d, 0),
  centroid_geog     = s.centroid,
  country_code      = COALESCE(u.country_code, public.normalize_country_code(u.region_primary))
FROM stats s
WHERE u.id = s.uid;
```

`public.normalize_country_code(text)` is a stable function that does a case-insensitive lookup against `iso_countries.name_en` / `name_es` first, then a fuzzy match (`pg_trgm` similarity > 0.6). Returns NULL on miss; only sets `country_code` when currently NULL (so user-set values are never overwritten).

### Performance

Estimated cost at 10k users / 100k obs:
- Aggregate scan: ~200 ms (already indexed on `observer_id`).
- Centroid: ~500 ms.
- UPDATE: ~300 ms.
- **Total: under 2 seconds.** Well within the free-tier compute budget.

At 100k users / 1M obs the cron is still under a minute; rollup-table refactor (option C from brainstorming) becomes attractive only well beyond v1 scale.

---

## Profile → Edit changes

Add two controls to `ProfileEditForm.astro`:

1. **Country** — select bound to `iso_countries`, options labeled per locale. Sets `users.country_code`. Empty option allowed (for users who don't want to declare).
2. **"Show me in community discovery and leaderboards"** — toggle bound to `users.hide_from_leaderboards` (inverted: on = visible). Helper text: *"When on, your public profile can appear on the Community page and in leaderboards. Turn off any time."*

Toggle is only enabled when `profile_public = true`. When `profile_public = false`, the toggle is rendered disabled with helper text *"Make your profile public to enable community discovery."*

---

## i18n updates

The two shipped strings explicitly stating "no leaderboards" must be rewritten before this surface ships. They contradict the new product direction.

`src/i18n/en.json` line 349 (`gamification_hint`):

```diff
- "Enable badges, streaks, and activity feed. Quality-gated. No leaderboards."
+ "Enable badges, streaks, and activity feed. Quality-gated. Community leaderboards are opt-in."
```

`src/i18n/en.json` line 959 (`streak_enable_body`):

```diff
- "Track your daily observation streak. Quality-gated, opt-in, no leaderboards."
+ "Track your daily observation streak. Quality-gated and opt-in. Community leaderboards are a separate opt-in."
```

Mirror in `src/i18n/es.json`.

New i18n namespace `community.*` in both locales:

```jsonc
"community": {
  "page_title": "Community observers",
  "page_subtitle": "Find observers by activity, expertise, location, or country.",
  "sort": { "obs": "Most observations", "species": "Most species", "active_7d": "Most active this week", "active_30d": "Most active this month", "recent": "Recently active", "newest": "Newest", "distance": "Nearest to me" },
  "filter": { "country": "Country", "taxon": "Taxon", "nearby": "Nearby", "experts_only": "Experts only", "any": "Any" },
  "card": { "obs": "{n} obs", "species": "{n} species", "last_seen": "last seen {when}", "follow": "Follow", "following": "Following" },
  "empty": { "no_match": "No observers match these filters. Try removing one.", "nearby_no_centroid": "Log an observation to find observers near you.", "nearby_anon": "Sign in to find observers near you." },
  "leaderboards_optout_link": "Hide me from community leaderboards"
}
```

---

## Tests

### Vitest

- `tests/community/url-state.test.ts` — round-trip the filter state object → URLSearchParams → object. Covers all sort/filter combinations including unknown values (should drop, not crash).
- `tests/community/normalize-country.test.ts` — input/output table for `normalize_country_code` Postgres function via in-memory pglite (or a seeded test DB if pglite proves slow); covers: ISO codes pass through, `"Mexico"` → `MX`, `"México"` → `MX`, `"México DF"` → `MX`, gibberish → `NULL`.

### Playwright

- `tests/e2e/community.spec.ts` — visit `/en/community/observers/?sort=species`, assert the list is non-empty (seeded fixtures), click the first card, assert nav to `/en/u/<username>/`. Mobile project covers the drawer "Community" subheading appears.
- Smoke test for `?nearby=true` while signed out: expect the empty-state CTA, no list.

### Manual verification

- Confirm `make db-apply` is replay-safe with the new schema.
- Confirm `make db-cron-test` fires `recompute-user-stats` and the `users` table updates as expected.
- Confirm the `hide_from_leaderboards` toggle on Profile → Edit immediately removes the user from the page on next load (no caching issues).

---

## Rollout

1. Schema deltas + view + indexes via `make db-apply`. Pre-merge `db-validate.yml` enforces idempotency.
2. Deploy `recompute-user-stats` Edge Function via `deploy-functions.yml` (auto on push to main).
3. Manually trigger the cron once via `make db-cron-test` to backfill all users' stats before the page goes live.
4. Ship Profile → Edit changes (country picker + opt-out toggle) **before** the Community page link is exposed in the MegaMenu — gives users a chance to opt out before they appear in any list.
5. Ship the Community page itself + MegaMenu changes.
6. Update the two "no leaderboards" i18n strings as part of the same PR as step 5 (atomic with surfacing the feature).

---

## Open questions for the implementation plan

(These are deliberately **not** decided here — they're for the planning step.)

- Does the Community page support server-side rendering (SSR) for SEO, or stay client-rendered like other PWA shells? The latter is simpler, the former marginally better for discoverability.
- Should the Community card show the user's most recent observation thumbnail? Adds visual richness; costs an extra column on the view + nightly thumbnail materialization. Decide in planning.
- Backfill of `country_code` for existing users — the normalizer will catch most. Stragglers can be left NULL and prompted on next visit. Decide in planning whether to send a one-shot prompt email.
