# Module 25 — Profile Privacy & Public Profile

**Status:** Spec v1.0 — 2026-04-27
**Author:** Rastrum group
**Milestone:** v1.2
**Depends on:** modules 04 (auth), 07 (licensing), 08 (profile/activity/gamification), 22 (community validation), 23 (karma + expertise + rarity)
**Impacts:** module 08 (replaces the binary `profile_public` boolean with a granular matrix); module 23 (karma_total / expertise / pokédex are new facets gated by this matrix)
**Routes:** (canonical EN ↔ ES pairing — must match `src/i18n/utils.ts`)
- Public profile (new, canonical): `/en/u/<username>/` ↔ `/es/u/<username>/` (locale-paired; username slug is locale-neutral)
- Public profile (existing, deprecated): `/en/profile/u/?username=…` ↔ `/es/perfil/u/?username=…` — already shipped via `PublicProfileView.astro`. The v1.2.0 PR keeps this route working via a redirect to the new shape and updates internal links; remove after one release (v1.3).
- Privacy settings: **new 5th tab** on `SettingsShell.astro` at `/en/profile/settings/privacy/` ↔ `/es/perfil/settings/privacy/`. Joins the existing 4 tabs (Profile, Preferences, Data, Developer) shipped by the UX-revamp PR-2 (`feat/ux-revamp-pr2-account-hub`). The spec's earlier reference to `/profile/edit/?tab=privacy` is **obsolete** — `/profile/edit` was demoted to a legacy 301-redirect target by PR-2.

---

## Problem

Rastrum's current profile model has a single `profile_public` boolean
(module 08). This is too coarse for the realities of how observers
want to share:

- A field botanist wants their **observation map and validation
  reputation** publicly visible (it's the basis of the credentialed-
  researcher trust signal in module 22) but their **streak and goals**
  private (those are personal, not scientific).
- A grandmother observing in her backyard wants her **species list**
  visible to family but her **precise location heatmap** kept hidden.
- A student wants the entire profile invisible while learning, then
  to flip it open once they're confident.
- A researcher in a politically sensitive region needs to share
  identifications publicly without revealing where they live.

A single toggle forces an all-or-nothing choice. Real privacy is
per-facet.

The visitor side is also missing. Today there is no `/u/<username>`
route — visitors clicking a profile link from the validation queue
land on a 404. We need the public surface and the privacy controls
to ship together so each makes the other useful.

---

## Solution

Two coordinated pieces:

1. **A per-facet privacy matrix** stored on `users.profile_privacy`
   (JSONB), with three visibility levels (`public` / `signed_in` /
   `private`) and three quick presets ("Open scientist" / "Researcher"
   / "Private observer").
2. **A public profile route** at `/{lang}/u/<username>/` that renders
   only the facets the owner has unlocked for the viewer's auth
   context, with rich widgets (observation map, calendar heatmap,
   taxonomic donut, top species, validation reputation).

The privacy boundary is enforced **server-side** by RLS + a
`can_see_facet()` SQL function. Client-side rendering is a UX hint
only — it never decides what data is fetched.

---

## Privacy model

### Facets

The matrix has 19 keys today (16 base + 3 from module 23 karma).
New widgets added later append a key with a default visibility;
existing rows get the default via JSONB `COALESCE`-style merging.

| Key | Default | What it gates |
|---|---|---|
| `profile` | `public` | Whether the profile page is reachable at all |
| `real_name` | `signed_in` | `users.display_name` if it differs from `username` |
| `bio` | `public` | `users.bio` |
| `location` | `signed_in` | `users.region_primary` |
| `stats_counts` | `public` | Total observations, research-grade count, kingdoms-validated count |
| `observation_map` | `public` | MapLibre mini-map with clustered pins (obscure_level still applies) |
| `calendar_heatmap` | `public` | 12-month GitHub-style activity grid |
| `taxonomic_donut` | `public` | Kingdom/phylum breakdown |
| `top_species` | `public` | Top 6–12 species grid with thumbnails |
| `streak` | `signed_in` | Current + longest streak ring |
| `badges` | `public` | Unlocked badges grid |
| `activity_feed` | `signed_in` | Chronological feed of obs / IDs / suggestions |
| `validation_rep` | `public` | "47 IDs accepted · 8 promoted to research grade" chip |
| `obs_list` | `public` | Browse-all-observations link/page |
| `watchlist` | `private` | Watched taxa list |
| `goals` | `private` | Monthly observation goals + progress |
| `karma_total` | `public` | Module 23 karma score and karma section on profile |
| `expertise` | `public` | Module 23 per-taxon expertise scores (`user_expertise` rows) |
| `pokedex` | `public` | Module 23 Pokédex grid at `/profile/dex` (and visitor-side equivalent) |

> **Why these defaults?** Facets that *help science* (map, heatmap,
> donut, top species, validation rep, karma, expertise, pokédex) are
> public so the credentialed-researcher pipeline (module 22), the
> karma trust signal (module 23), and the discoverability surfaces
> (module 16, ExploreSpecies) keep working out of the box. Facets
> that *help the user personally* (streak, goals, watchlist) lean
> private. Identity facets (real name, location) lean `signed_in`
> because that's high-friction enough to deter scrapers without
> blocking other naturalists.
>
> **Karma facets default `public` deliberately.** Karma + expertise +
> pokédex are designed (module 23) as the public reputation surface
> that replaces the rejected leaderboard pattern with self-vs-self
> discovery and earned trust. Hiding them by default would defeat
> the design — a user who wants no karma surface flips it manually,
> or picks the *Private observer* preset which sets all three to
> `private` at once.

### Visibility levels

| Level | Who sees it |
|---|---|
| `public` | Anyone, including unauthenticated visitors and OG scrapers |
| `signed_in` | Any user with a valid Supabase session |
| `private` | Only the profile owner (`viewer = target`) |

A 4th level — `followers_only` — is feasible *immediately* because
the `public.follows` table already ships (see
`supabase-schema.sql:756`). It is intentionally **out of scope for
v1.2.0** to keep the matrix UI legible (3 segments fit in a row;
4 wraps on narrow screens) and to ship the simpler model first.
v1.2.2 or v1.3 can add it as a pure-additive change to
`can_see_facet()`:

```sql
WHEN 'followers_only' THEN viewer IS NOT NULL AND EXISTS (
  SELECT 1 FROM public.follows
  WHERE follower_id = viewer AND followee_id = target
)
```

### Presets

The Privacy tab opens with three preset buttons at the top. Clicking
a preset rewrites the entire matrix to a known shape; the user can
then override any individual row.

| Preset | Public | Signed-in | Private |
|---|---|---|---|
| **Open scientist** | every facet except `watchlist` and `goals` (incl. karma_total, expertise, pokedex) | — | `watchlist`, `goals` |
| **Researcher** *(default)* | profile, bio, stats, map, heatmap, donut, top species, badges, validation rep, obs list, karma_total, expertise, pokedex | real_name, location, streak, activity_feed | watchlist, goals |
| **Private observer** | — | profile only (so other validators can verify the account exists) | every other facet (incl. karma_total, expertise, pokedex) |

A 4th implicit "Custom" mode is what the matrix shows when the user
has overridden a preset; the preset row de-selects, and a "Custom"
chip appears.

---

## Data model

### Schema additions

Extend `public.users`:

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_privacy jsonb NOT NULL DEFAULT '{
    "profile":          "public",
    "real_name":        "signed_in",
    "bio":              "public",
    "location":         "signed_in",
    "stats_counts":     "public",
    "observation_map":  "public",
    "calendar_heatmap": "public",
    "taxonomic_donut":  "public",
    "top_species":      "public",
    "streak":           "signed_in",
    "badges":           "public",
    "activity_feed":    "signed_in",
    "validation_rep":   "public",
    "obs_list":         "public",
    "watchlist":        "private",
    "goals":            "private",
    "karma_total":      "public",
    "expertise":        "public",
    "pokedex":          "public"
  }'::jsonb,
  ADD COLUMN IF NOT EXISTS dismissed_privacy_intro_at timestamptz;

-- Index for facet-driven discovery (e.g. "users with public observation_map").
-- Path-ops opclass keeps the index small; we never query the values, only keys.
CREATE INDEX IF NOT EXISTS idx_users_profile_privacy
  ON public.users USING gin (profile_privacy jsonb_path_ops);
```

### Coexistence with the UX-revamp PRs (PR-1 through PR-5)

The UX-revamp 5-PR family (#22, #31, #32, #33, #34) **shipped to
main 2026-04-27/28** ahead of this module. Module 25 threads its
surfaces through the new chrome that's already in production:

| Revamp piece | Module 25 integration |
|---|---|
| **PR-1 — verb-first chrome + mobile bottom-bar** | New `/u/<username>/` route belongs in the **About** mega-menu (visitor-side discoverability); not in the persistent left action items. Mobile bottom-bar is unchanged. |
| **PR-2 — `SettingsShell.astro` + tabbed `/profile/settings/[tab]/`** | Privacy tab is the **5th** tab in `SettingsShell.astro`. Tab key is `privacy`; activeTab union widens from `'profile' \| 'preferences' \| 'data' \| 'developer'` → `… \| 'privacy'`. Two new dynamic-param matches at `/{en,es}/profile/settings/privacy/` and `/{en,es}/perfil/settings/privacy/` (the `[tab].astro` shell already supports this — only need to register the tab in the `tabs` array). The legacy 10× 301 redirects from PR-2 stay; this module adds **one more 301** for `/profile/u/?username=` → `/u/<username>/`. |
| **PR-2 — read-only `/profile` identity hub** | Karma section, observation map, calendar heatmap, donut, top-species widgets are reused on `/profile` (owner sees all) and `/u/<username>/` (visitor sees gated). Same components, different `viewer` prop. |
| **PR-3 — Breadcrumbs reading `routeTree`** | Add 4 entries to `routeTree`: `profileSettingsPrivacy`, `publicProfile`, `publicProfileDex`, plus an updated `profile` parent so the breadcrumb chain renders correctly on settings/privacy and visitor pages. |
| **PR-3 — 5-column footer** | No change. Footer already reads `routeTree`; new entries flow in automatically. The visitor `/u/<username>/` route should NOT appear in the footer (it's per-user, not a global page). |
| **PR-4 — Command palette ⌘K (`fuse.js`, build-time index)** | Add 4 entries to the build-time index emitter (`scripts/build-command-index.ts`): "Privacy settings", "Pokédex", "View my public profile", "Make profile private" (action — flips matrix to all-private with confirm). Index grows from 41 → 45 entries (~9% bigger; still well under the lazy-load threshold). |
| **PR-5 — 5-step spotlight onboarding tour** | Add a **6th step** between current step 4 ("install") and step 5 ("ready"): **"Pick your privacy preset"** with the 3 preset buttons. Default selection: Researcher. Replay event still works (skill from PR-5). The single-extra step keeps the tour under the perceptual-attention budget while making privacy a deliberate first-run decision. |
| **SEO: PR-B (per-page metadata) + PR-C (sitemap hreflang + JSON-LD) + PR-E (a11y → 100, sitemap completion)** | The new `/u/<username>/` route MUST: (1) emit `<link rel="canonical">` via `BaseLayout`'s metadata pipeline; (2) emit hreflang pairs `en` ↔ `es` (the username is locale-neutral so the alternate is just the other locale prefix); (3) emit a `Person` JSON-LD entity (`@type: 'Person'`, `name: display_name OR username`, `url: canonical`, `image: avatar_url`) **only** when `profile = public` — otherwise no JSON-LD; (4) be added to the sitemap generator's per-user enumeration step, with the same `profile = public` filter. Site-wide a11y bar (Lighthouse 100) means the matrix must pass keyboard nav + axe-core in CI. |

### Coexistence with existing public-profile implementation

A *partial* public-profile surface already ships today:

- Route shells at `src/pages/{en,es}/{profile,perfil}/u/index.astro`
  read `?username=` at runtime.
- `src/components/PublicProfileView.astro` queries `users` directly,
  filtered by RLS using the `profile_public = true` predicate.
- `src/components/ProfileEditForm.astro` has a `profile_public`
  checkbox; `StreakCard.astro` flips it to `true` when the user
  opts into gamification.
- `src/components/ExploreRecentView.astro` shows "Anonymous"
  authors when `profile_public = false`.

This module's v1.2.0 PR replaces the boolean-driven gate with the
matrix without breaking those callers:

1. The `profile` facet of `profile_privacy` is the new source of
   truth. Backfill maps `profile_public = true → profile = public`,
   `false → profile = signed_in`. `StreakCard`'s opt-in flow now
   sets `profile_privacy.profile = 'public'` alongside the existing
   `profile_public = true` write (kept for one release).
2. `PublicProfileView.astro` is rewritten to read from
   `can_see_facets()` for the target user and conditionally render
   each widget. Its query swaps `profile_public = true` for a
   `users` SELECT plus a `can_see_facet(id, 'profile', auth.uid())`
   check.
3. `ExploreRecentView.astro`'s "Anonymous" branch keys on
   `can_see_facet(observer_id, 'real_name', auth.uid())` instead of
   `profile_public`.
4. `ProfileEditForm.astro` removes its `profile_public` checkbox in
   favour of the Privacy tab. The column itself is dropped in v1.3.
5. The new `/u/<username>/` route ships with a 301 redirect from
   the legacy `/{lang}/profile/u/?username=…` shape, so external
   links keep working. Internal links in
   `MyObservationsView`, `ProfileView`, `ExploreRecentView`,
   `ValidationQueueView`, and the `share/obs` page get updated to
   the new shape in the same PR.

### Coexistence with module 23 (karma + expertise + rarity)

Module 23 **shipped Phase 1 to main 2026-04-28** (PR #36, commit
`c8af5ac`) and brings these tables / columns:

- `users.karma_total`, `users.karma_updated_at`, `users.grace_until`,
  `users.vote_count`
- `user_expertise(user_id, taxon_id, score, …)`
- `karma_events` (append-only ledger)
- `taxon_rarity` (nightly materialized)

Module 23 ships an *open* `user_expertise_public_read` policy
(`FOR SELECT USING (true)`) on the assumption that profile-privacy
gating doesn't exist yet. Module 25 **tightens it** in its own
migration, replacing that policy with a facet-aware one:

```sql
DROP POLICY IF EXISTS user_expertise_public_read ON public.user_expertise;
CREATE POLICY user_expertise_facet_read ON public.user_expertise
  FOR SELECT USING (
    public.can_see_facet(user_id, 'expertise', (SELECT auth.uid()))
  );
```

Same pattern for the karma surface — there is no public RLS-readable
table for `karma_total` (it lives on `users`, already filtered by
`users_public_read`'s column allow-list), so the gating happens
inside the new `profile_karma` view (see *Facet-gated views* below).
`karma_events` keeps its `karma_events_self_read` policy as-is —
it's owner-only by design and is not surfaced on public profiles.

The karma section on `/profile/` (own view) is unaffected: owner
always sees their own karma + expertise. The visitor view at
`/u/<username>` sees each according to the matrix.

### Coexistence with module 08's `profile_public`

`users.profile_public` (boolean from module 08) is **deprecated but
not dropped**. The migration sets `profile_privacy.profile` to
`public` if `profile_public = true`, else `signed_in`, for every
existing row. New code reads `profile_privacy` only; the old column
stays writable for one release as a safety net, then is dropped in
v1.3.

```sql
UPDATE public.users
SET profile_privacy = jsonb_set(
  profile_privacy,
  '{profile}',
  CASE WHEN profile_public THEN '"public"'::jsonb ELSE '"signed_in"'::jsonb END
)
WHERE profile_privacy ->> 'profile' IS DISTINCT FROM
      CASE WHEN profile_public THEN 'public' ELSE 'signed_in' END;
```

### `can_see_facet()` — the single source of truth

```sql
CREATE OR REPLACE FUNCTION public.can_see_facet(
  target uuid,
  facet  text,
  viewer uuid DEFAULT NULL
) RETURNS boolean
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT CASE
    -- Owner always sees their own facets.
    WHEN viewer IS NOT NULL AND viewer = target THEN true
    -- Read the level from the matrix; treat missing keys as 'public'
    -- (forward-compat: a new facet not yet in old rows defaults open).
    ELSE (
      SELECT CASE COALESCE(profile_privacy ->> facet, 'public')
        WHEN 'public'    THEN true
        WHEN 'signed_in' THEN viewer IS NOT NULL
        WHEN 'private'   THEN false
        ELSE false   -- unknown level → fail closed
      END
      FROM public.users
      WHERE id = target
    )
  END;
$$;

GRANT EXECUTE ON FUNCTION public.can_see_facet(uuid, text, uuid)
  TO anon, authenticated;
```

**Why `STABLE` and not `IMMUTABLE`:** the result depends on the
`users` row, which can change between transactions. `STABLE` lets
the planner cache the result within a single query, which is enough
since we typically call it once per facet per request.

### Facet-gated views

Every public-profile widget reads from a dedicated view that calls
`can_see_facet()` in its WHERE clause. The view is the privacy
gate; client code never sees a row it shouldn't.

```sql
-- Observation pins for the public observation_map facet.
-- Honours obscure_level (sensitive species → coarsened coords) and
-- the per-row obscure flag, regardless of facet visibility.
CREATE OR REPLACE VIEW public.profile_observation_pins AS
SELECT
  o.observer_id,
  o.id AS observation_id,
  CASE
    WHEN o.location_obscured
      THEN ST_SnapToGrid(o.location, 0.1)   -- ≈11 km grid
    ELSE o.location
  END AS location,
  i.scientific_name,
  i.is_research_grade,
  o.observed_at
FROM public.observations o
LEFT JOIN public.identifications i
  ON i.observation_id = o.id AND i.is_primary = true
WHERE
  o.sync_status = 'synced'
  AND o.obscure_level <> 'private'
  AND public.can_see_facet(o.observer_id, 'observation_map', (SELECT auth.uid()));

GRANT SELECT ON public.profile_observation_pins TO anon, authenticated;
```

Equivalent views for: `profile_calendar_buckets`, `profile_taxonomic_donut`,
`profile_top_species`, `profile_badges_visible`, `profile_activity_feed`,
`profile_stats_counts`, `profile_validation_reputation`,
`profile_karma`, `profile_pokedex`. Each follows the same pattern:
SELECT from base tables, AND in `can_see_facet()`.

```sql
-- Karma + expertise highlights for the public profile karma section.
CREATE OR REPLACE VIEW public.profile_karma AS
SELECT
  u.id AS user_id,
  u.username,
  u.karma_total,
  u.karma_updated_at,
  -- Top 5 expertise taxa, name + score.
  (SELECT jsonb_agg(jsonb_build_object(
            'taxon_id', e.taxon_id,
            'scientific_name', t.scientific_name,
            'score', e.score
          ) ORDER BY e.score DESC)
   FROM (SELECT * FROM public.user_expertise
         WHERE user_id = u.id ORDER BY score DESC LIMIT 5) e
   JOIN public.taxa t ON t.id = e.taxon_id
  ) AS top_expertise
FROM public.users u
WHERE public.can_see_facet(u.id, 'karma_total', (SELECT auth.uid()));

GRANT SELECT ON public.profile_karma TO anon, authenticated;

-- Pokédex: every taxon the user has observed, with rarity bucket.
CREATE OR REPLACE VIEW public.profile_pokedex AS
SELECT DISTINCT
  o.observer_id  AS user_id,
  i.taxon_id,
  t.scientific_name,
  t.kingdom,
  tr.bucket      AS rarity_bucket,
  MIN(o.observed_at) AS first_observed_at
FROM public.observations o
JOIN public.identifications i
  ON i.observation_id = o.id AND i.is_primary = true
JOIN public.taxa t          ON t.id = i.taxon_id
LEFT JOIN public.taxon_rarity tr ON tr.taxon_id = i.taxon_id
WHERE
  o.sync_status = 'synced'
  AND o.obscure_level <> 'private'
  AND public.can_see_facet(o.observer_id, 'pokedex', (SELECT auth.uid()))
GROUP BY o.observer_id, i.taxon_id, t.scientific_name, t.kingdom, tr.bucket;

GRANT SELECT ON public.profile_pokedex TO anon, authenticated;
```

The `expertise` facet protects the `user_expertise` rows directly
via the policy override above — the `profile_karma` view's
`top_expertise` aggregate is additionally gated by `karma_total`,
since hiding karma should also hide its sub-display of top expertise.
A user who wants karma public but expertise private gets the karma
number rendered with `top_expertise = []`.

`watchlist` and `goals` are NOT exposed via views at all — they're
read by the owner directly through the existing `users` /
`user_goals` row policies (`viewer = id`). A view would be a security
attractive nuisance.

### RLS on `profile_privacy` itself

Only the owner can update their own privacy matrix:

```sql
DROP POLICY IF EXISTS "users_update_self_privacy" ON public.users;
CREATE POLICY "users_update_self_privacy" ON public.users
  FOR UPDATE TO authenticated
  USING ((SELECT auth.uid()) = id)
  WITH CHECK ((SELECT auth.uid()) = id);
```

Anyone can SELECT a row's `profile_privacy` value indirectly via
`can_see_facet()`, but the column itself is filtered out of public
SELECTs by the existing `users_public_read` policy (modules 08 + 04
already restrict the public view to `username, display_name, avatar_url,
bio, joined_at`).

---

## Routes & components

### Public profile — `/{lang}/u/<username>/`

Astro page: `src/pages/{en,es}/u/[username]/index.astro` (a single
`getStaticPaths` + `prerender = false` setup, since usernames are
user-supplied and unbounded).

Component tree (all under `src/components/profile/`):

- **`PublicProfileView.astro`** — top-level orchestrator. Fetches the
  target user row by `username`, resolves `viewer = auth.getUser()`,
  runs `can_see_facet()` once per facet (single batched RPC call,
  see *Performance* below), and conditionally renders each child.
- **`ProfileHero.astro`** — avatar, display name (gated by `real_name`),
  bio (gated by `bio`), location (gated by `location`), member-since,
  `stats_counts` row, share button (Web Share API + OG card).
- **`ProfileObservationMap.astro`** — MapLibre mini-map (~280 px tall),
  clustered pins from `profile_observation_pins`. Pins clickable to
  `/share/obs/?id=<obs>`. Reuses the `ExploreMap` config and tile
  source.
- **`ProfileCalendarHeatmap.astro`** — 12-month grid (53 × 7 cells),
  one cell per day, linear-color-graded by `daily_count` from
  `profile_calendar_buckets`. Click a cell → `/u/<username>/?day=YYYY-MM-DD`
  filtered list. ~120 LOC of plain SVG; no library.
- **`ProfileTaxonomicDonut.astro`** — kingdom donut with hover tooltips.
  Click slice → `/explore/species/?kingdom=<…>&observer=<username>`.
- **`ProfileTopSpecies.astro`** — 6–12-species grid with thumbnails.
- **`ProfileStreakRing.astro`** — current streak as filled arc, longest
  streak as faded outer arc.
- **`ProfileBadgesGrid.astro`** — unlocked badges with hover descriptions.
- **`ProfileActivityFeed.astro`** — same component used on `/profile/`,
  filtered to public-safe events.
- **`ProfileValidationReputation.astro`** — reputation chip + linked-IDs
  count + research-grade-promoted count.
- **`ProfileKarmaSection.astro`** — karma_total + top-5 expertise taxa
  from `profile_karma`. Reuses the karma section component already
  shipping with module 23 (Phase 1 plan task 9), wrapped in a
  visibility guard.
- **`ProfilePokedexLink.astro`** — small "View Pokédex →" tile linking
  to the visitor view of the dex (`/u/<username>/dex/`). The full
  grid lives at the dedicated route, gated by the `pokedex` facet.
- **`ProfileEmptyState.astro`** — rendered when the matrix collapses to
  effectively nothing (e.g. visitor on a "Private observer" preset).
  Shows: avatar, display name, "This profile is private" line, and a
  link back to `/explore/`.

The orchestrator uses an **explicit visibility fallthrough**: if
`profile = private` AND `viewer ≠ owner`, return a 404-equivalent
(empty state with `noindex`). Anything less leaks the user's
existence.

### Privacy tab — `/{lang}/profile/settings/privacy/`

A new 5th tab in the existing `SettingsShell.astro` (shipped by
UX-revamp PR-2). Tabs are now: **Profile · Preferences · Data ·
Developer · Privacy**. The shell's `activeTab` union widens to
include `'privacy'`; the `tabs` array gets a 5th row. The dynamic
`[tab].astro` route already matches anything, so no new file —
just add the entry under `'privacy'` in the per-tab content
switch.

Component: `src/components/PrivacyMatrix.astro` (mounted inside
`SettingsShell.astro` when `activeTab === 'privacy'`).

Layout:

```
┌─────────────────────────────────────────────────────────┐
│  Privacy presets                                        │
│  [ Open scientist ] [ Researcher ] [ Private observer ] │
│                                                  Custom │
├─────────────────────────────────────────────────────────┤
│  Live preview                                           │
│  ┌─ Anonymous visitor ─┐  ┌─ Signed-in visitor ─┐       │
│  │  (mini-render)      │  │  (mini-render)      │       │
│  └─────────────────────┘  └─────────────────────┘       │
├─────────────────────────────────────────────────────────┤
│  Identity                                       (3)     │
│    Display name      [● Public  ○ Signed-in  ○ Private] │
│    Bio               [● Public  ○ Signed-in  ○ Private] │
│    Location          [○ Public  ● Signed-in  ○ Private] │
│  Activity                                       (5)     │
│    Observation map   [● Public  ○ Signed-in  ○ Private] │
│    Calendar heatmap  [● Public  ○ Signed-in  ○ Private] │
│    …                                                    │
│  Engagement                                     (4)     │
│    …                                                    │
│  Personal                                       (2)     │
│    Watchlist         [○ Public  ○ Signed-in  ● Private] │
│    Goals             [○ Public  ○ Signed-in  ● Private] │
├─────────────────────────────────────────────────────────┤
│           [ Make my entire profile private ]            │
└─────────────────────────────────────────────────────────┘
```

Each row has: an icon, a one-line description, the 3-state segmented
control, and an optional "Why this matters" disclosure that expands
the privacy implication ("Your map will show every public obs you've
ever made — sensitive species are still coarsened to ~11 km.").

On mobile (≤640 px), the four section groups become accordions
collapsed by default so the matrix isn't a wall of toggles.

The "Make my entire profile private" button at the bottom is a
nuclear option — it sets every facet to `private` except `profile:
signed_in` (so other naturalists can still verify the account exists
when reviewing community votes in module 22).

### Save semantics

- The matrix saves **on change**, not on a save button: each toggle
  fires a debounced (300 ms) `UPDATE users SET profile_privacy = …`.
  This matches user expectation of "switches that just work" and
  removes the dirty-state bookkeeping problem.
- Optimistic local update; rollback + toast on error.
- Live preview re-renders client-side using the same components in
  a dedicated `viewer-mode` prop; no server round-trip for the
  preview.
- The "Make entire profile private" button, by contrast, *does* show
  a confirm modal — it's destructive of public visibility.

### Visitor view of the OG card

`/u/<username>` needs an OG card. Gating logic lives in the existing
build-time / client-time OG pipeline (module 08 + post-launch
runbook):

- If `profile_privacy.profile = public`: render the rich card with
  avatar + stats (existing shape).
- If `profile_privacy.profile = signed_in`: render a generic
  "Rastrum profile" card with the logo only (no name, no stats).
- If `profile_privacy.profile = private`: serve `og/default.png`
  and add `<meta name="robots" content="noindex,nofollow">` to the
  page itself.

The OG card render path runs at profile-edit save time (per the
existing pipeline); changing the privacy facet re-renders the card.

### Robots / scraping

Pages with `profile = signed_in` or `private` add:

```html
<meta name="robots" content="noindex,nofollow">
```

And the `/u/<username>/` page is excluded from `sitemap-index.xml`
unless `profile = public`.

---

## Privacy boundary correctness

This is the part that has to be airtight. Treat the SQL views as the
only trusted boundary; everything client-side is decoration.

| Layer | Protects against | Mechanism |
|---|---|---|
| `can_see_facet()` SQL function | All clients lying about auth or facet | `STABLE`, schema-qualified, `SECURITY INVOKER`, `auth.uid()`-driven |
| Facet-gated views | RLS bypass, view-mutation tricks | Each view re-runs `can_see_facet()` in its WHERE clause |
| `obs_public_read` (existing) | Sensitive coords leak | Independent; runs on the underlying `observations` table |
| `users_public_read` (existing) | `profile_privacy` leaking | Filtered out in the column list of the public-read policy |
| OG card render gate | Public scrapers indexing private profiles | Build-time conditional + `noindex` meta |
| Sitemap exclusion | Search-engine surfacing | `profile = public` filter on sitemap query |
| Module 22 voter surfacing | Voters with private profiles being deanonymised | Validation-queue UI shows "anonymous expert" when `profile = private`; vote weight unchanged |

### Threat scenarios checked

1. **Visitor enumerates `/u/<username>` for many usernames.** — Server
   responds with a 404-equivalent for any profile with `profile =
   private` (or non-existent). No confirm/deny leak via timing
   because the empty-state and the 404 path do the same DB query.
2. **Visitor scrapes the API directly.** — All facet-gated views
   reject rows where `can_see_facet()` is false. The user's own row
   in `users` is filtered to only public columns by the existing
   `users_public_read` policy.
3. **Authenticated visitor switches between accounts.** — Each
   request runs `auth.uid()` independently in the views. There's no
   cross-request caching of facet results.
4. **A new facet is deployed before the migration runs.** —
   `can_see_facet()` returns `'public'` for missing keys (forward-
   compat). This is intentional: a new facet failing to default to
   public would silently hide live data for users who haven't
   touched their settings yet. The deploy order is "ship the facet
   default in code → run the migration that adds the key with the
   intended default" so `'public'` is only the fallback for the
   transition window.
5. **Module 22 voter list leaks a private profile.** — The
   ValidationQueueView already needs to render community-suggested
   IDs. When the voter has `profile = private`, the UI shows
   "anonymous expert" but keeps the displayed weight (so confidence
   isn't misleading). The link to `/u/<username>` is suppressed.
6. **Search engine indexes a profile that turned private.** — Old
   index entries persist briefly. The `noindex` meta + a 410 Gone
   response on private-profile fetches by Googlebot user-agents
   accelerate de-indexing. A `<link rel="canonical">` on private
   pages points to `/explore/` to disambiguate.

---

## Performance

The orchestrator needs facet visibility for ~14 keys per render.
Calling `can_see_facet()` 14 times in a single request is wasteful;
batch via a JSON-returning RPC:

```sql
CREATE OR REPLACE FUNCTION public.can_see_facets(
  target uuid,
  facets text[],
  viewer uuid DEFAULT NULL
) RETURNS jsonb
LANGUAGE sql STABLE SECURITY INVOKER AS $$
  SELECT jsonb_object_agg(f, public.can_see_facet(target, f, viewer))
  FROM unnest(facets) AS f;
$$;
GRANT EXECUTE ON FUNCTION public.can_see_facets(uuid, text[], uuid)
  TO anon, authenticated;
```

The orchestrator calls `can_see_facets()` once at the top of the
render; widget components receive a `Map<facet, visible>` from props.
Single round-trip.

For the heatmap (365 buckets), an explicit `profile_calendar_buckets`
view materializes daily counts. Given typical user obs counts (≤ 10k),
the underlying `observations` aggregate runs in <50 ms; we don't need
a materialized view yet. Revisit when a single profile crosses 50k
observations.

---

## i18n

New keys live under `privacy:` in `src/i18n/{en,es}.json`:

- `privacy.tab_label`
- `privacy.preset_open_scientist` / `…_researcher` / `…_private`
- `privacy.preset_custom`
- `privacy.section_identity` / `…_activity` / `…_engagement` / `…_personal`
- `privacy.facet.<key>.label` (16 entries)
- `privacy.facet.<key>.description` (16 entries)
- `privacy.level_public` / `…_signed_in` / `…_private`
- `privacy.preview_anonymous` / `…_signed_in`
- `privacy.nuclear_button` / `privacy.nuclear_confirm_title` / `…_body`
- `privacy.intro_banner_title` / `…_body` / `…_dismiss`
- `privacy.private_profile_empty_title` / `…_body`

EN/ES parity is enforced by the existing test
(`tests/i18n-parity.test.ts`).

---

## Edge cases

1. **Pre-existing users.** They get the JSONB defaults retroactively
   via the column default. On first sign-in after deploy, they see a
   one-time banner ("We added privacy controls — review your
   defaults") with [Review] / [Use recommended defaults] / [Dismiss]
   buttons. Dismissal is recorded in `users.dismissed_privacy_intro_at`.
2. **Username changes.** If a user changes their username, the old
   `/u/<old-username>` route 404s. We don't ship redirects in v1.2;
   stale external links break. Could add a `username_history` table
   in v1.3 if data shows this is a real problem.
3. **Account deletion.** Existing module 04 deletion flow already
   cascades. The public profile route 404s the moment the row is
   gone.
4. **Owner views their own public profile.** Owner always sees every
   facet, regardless of setting. Each private/signed-in widget gets
   a small "🔒 Only you see this" badge underneath so the owner
   knows what visitors actually see. To check the visitor view, the
   owner uses the live preview cards in the Privacy tab (or signs
   out — but the in-product preview avoids that round-trip).
5. **OG card cache.** Privacy changes invalidate the OG card. The
   render-on-edit-save pattern handles this; users who flip facets
   without saving the edit form trigger an explicit re-render via a
   small `og:render` toast/button.
6. **Module 22 cross-cutting.** When the validation queue surfaces a
   community vote, it must not link to a private profile. Solution:
   the queue view's voter-name cell wraps the link in a conditional
   that calls `can_see_facet(voter_id, 'profile', auth.uid())`.
7. **CSV / Darwin Core export (module 06).** The owner's own export
   always includes their own data regardless of privacy. Other
   users' obs in shared aggregates respect their `profile = public`
   AND `obs_list = public` settings. This is consistent with the
   existing rule that DwC-A respects per-record CC license, not
   profile visibility — privacy is one more filter, not a replacement.
8. **MCP server (module 15-mcp-server) profile queries.** AI agents
   hitting the MCP profile endpoint receive only public-facet data
   (treated as `viewer = anon` regardless of token). Owner-private
   data stays Edge-Function-invisible. The MCP token's user_id is
   not used as `viewer` because the agent isn't the user.
9. **Onboarding flow (module 18 + UX-revamp PR-5).** PR-5 turned the
   onboarding into a 5-step spotlight tour. Module 25 inserts a
   **6th step** as the new step 5 ("Pick your privacy preset"),
   pushing the previous step 5 ("ready") to step 6. The spotlight
   highlights the 3 preset buttons. Default selection: Researcher.
   Replay event from PR-5 (`rastrum:replay-onboarding`) flushes the
   privacy choice flag too so a re-tour can re-prompt.
10. **Module 23 deploy ordering.** Module 23 ships first with an
    open `user_expertise_public_read` policy. Module 25's migration
    drops it and re-creates as `user_expertise_facet_read`. The
    drop+create is idempotent, so re-running module 23's migration
    after module 25 lands does NOT regress the privacy gate (its
    policy creation is `DROP POLICY IF EXISTS … CREATE POLICY …`,
    same name); but if module 23 ever changes the policy name in a
    follow-up, the rename must be coordinated. Add a comment in
    `supabase-schema.sql` next to module 23's policy: `-- superseded
    by user_expertise_facet_read in module 25`.
11. **Karma intro banner (module 23).** Module 23 includes a karma
    grace-period banner on first visit. The banner respects the
    `karma_total` facet only for the visitor view of someone else's
    profile; on the user's own profile, the banner always shows.

---

## Slicing

| Phase | Ships | Cost | Depends on |
|---|---|---|---|
| **v1.2.0 — public profile MVP** | Schema migration (`profile_privacy` + `dismissed_privacy_intro_at`); `can_see_facet()` + `can_see_facets()` RPCs; `profile_observation_pins` view; 3 presets in Privacy tab; matrix UI for **all 19 facets**; `/u/<username>` route with hero, observation map, calendar heatmap, top species, validation reputation; OG-card gating; sitemap filter | ~1.5 days | none (matrix ships before karma views are wired) |
| **v1.2.1 — karma + remaining widgets** | `profile_taxonomic_donut`, `profile_streak_ring`, `profile_badges_grid`, `profile_activity_feed`, `profile_karma`, `profile_pokedex` views + components; `user_expertise` policy override; visitor `/u/<username>/dex/` route; intro banner; mobile accordion polish; module 22 voter-link gating | ~1 day | module 23 Phase 1 shipped (karma columns + tables exist) |
| **v1.2.2 / v1.3 — interactions** | `followers_only` level (uses existing `public.follows` table); per-observation visibility override; "who viewed your profile" audit log (off by default) | smaller than originally scoped — `follows` already exists | — |

The v1.2.0 PR ships the matrix UI for **every facet** even if the
backing widget hasn't shipped yet — the toggle for `taxonomic_donut`
is wired before the donut renders. This avoids a "your settings
suddenly mean something different" UX cliff when v1.2.1 lands; the
defaults and toggles are stable from day one.

---

## Acceptance criteria

1. **Schema applied:** `make db-apply` adds `profile_privacy` JSONB
   column with the documented default and the GIN index.
   `make db-verify` shows the column on `users` and the
   `users_update_self_privacy` policy enabled.
2. **`can_see_facet()` correct:** pgTAP test in
   `tests/sql/can_see_facet.test.sql` covers all 9 cells of the
   3-level × 3-viewer-state matrix (owner / signed-in stranger /
   anon), plus the missing-key fallback.
3. **Public profile renders:** `/en/u/<username>/` and `/es/u/<username>/`
   return 200 for any `profile = public` user, with widgets gated by
   their facet settings. Anonymous visitor sees no `signed_in` data.
4. **Privacy tab usable:** `/profile/edit/?tab=privacy` renders the
   matrix, presets work, toggles save on change with optimistic
   update, live preview reflects each toggle within 500 ms.
5. **Empty state:** anonymous visitor on a `profile = signed_in`
   profile sees a "Sign in to view" card; on `private` sees the same
   404-equivalent as a non-existent username.
6. **OG card:** private and signed-in profiles serve the generic
   card; only public profiles get the rich render.
7. **No regressions:** module 08 streaks, badges, activity still
   work for owner. Module 22 validation queue still works
   end-to-end. Module 16 MyObservations unchanged.
8. **A11y:** the matrix is keyboard-navigable (Tab through rows,
   Arrow keys to switch level), each toggle has an accessible name
   that includes the facet label and the current level, the live
   preview has `aria-live="polite"` on changes.
9. **i18n parity:** `tests/i18n-parity.test.ts` passes; both locales
   have all `privacy.*` keys.
10. **Sitemap:** `npm run build:sitemap` excludes any user with
    `profile_privacy.profile <> 'public'`. Verified by a unit test
    on the sitemap generator.

---

## Out of scope (this module)

- **Per-observation visibility override.** Owner picks public/obscured/
  private *per observation* in the form. Module 02 + 07 handle this
  today via `obscure_level`; the profile matrix doesn't replace it.
- **Followers / following social graph.** Deferred to v1.3.
- **"Who viewed my profile" audit log.** Privacy-violating in itself
  if not opt-in for both viewer and viewee; deferred indefinitely.
- **Custom domain on `/u/<username>`** (e.g. `nyx.rastrum.org`). Out
  of scope until Supabase Pro / custom-domain infra lands.
- **Profile-level search** (find naturalists in your bioregion). v1.5+;
  needs a curated index plus opt-in flag.

---

## Open questions

1. Do we want a `region_obscure_level` analogous to observations?
   Right now `location: signed_in` either shows the full
   `region_primary` string or hides it. No middle ground. Probably
   fine for v1.2; revisit if users complain.
2. Should `validation_rep` be a separate `public` setting, or always
   tied to `profile`? Today: separate, because the chip is the
   anchor of the credentialed-researcher pipeline (module 22) and
   should rarely be hidden. Decision stands unless feedback says
   otherwise.
3. Do we publish a "Privacy changelog" telling users what defaults
   shipped when? — yes, append to `docs/runbooks/privacy-defaults.md`
   on every default change. Out of scope for v1.2 itself.

---

## Cross-references

- Module 04 — Authentication: `auth.uid()` source.
- Module 07 — Licensing: per-record CC remains the license boundary;
  this module adds a *visibility* boundary on top.
- Module 08 — Profile/Activity/Gamification: this module *replaces*
  the binary `profile_public` boolean. Module 08 should be revised
  to reference `profile_privacy.profile` in its examples.
- Module 22 — Community Validation: voter-link gating is an explicit
  consumer of `can_see_facet()`.
- Module 23 — Karma + Expertise + Rarity: ships first; this module's
  v1.2.1 wraps karma's `user_expertise` policy and adds the
  `profile_karma` + `profile_pokedex` views. Karma section component
  is reused on `/u/<username>` behind the `karma_total` gate.
- Module 15-mcp-server — MCP server: agent queries treated as
  `viewer = anon`.
- `docs/runbooks/post-launch-improvements.md` — the existing OG
  pipeline is reused; this module adds the visibility gate.
