# Module 08 — Profile, Activity & Gamification

**Version target:** v0.1 (profile basics) → v0.3 (activity feed) → v0.5 (badges + quality gates) → v1.0 (streaks, BioBlitz, shareables)
**Status:** spec (policy locked; staged implementation)
**Depends on:** modules 01 (photo ID), 02 (observation), 04 (auth), 07 (licensing)
**Impacts:** monolithic spec § "Module: Community & Gamification"

> **v1.2 supersession notice.** The binary `users.profile_public` boolean
> introduced here is **deprecated** by module 25 (`25-profile-privacy.md`,
> v1.2 milestone), which replaces it with a 19-key `profile_privacy`
> JSONB matrix. The column stays writable for one release as a safety
> net and is dropped in v1.3. New code should call
> `public.can_see_facet(target, facet, viewer)` instead of reading
> `profile_public` directly. The reputation surface (karma, expertise,
> pokédex) added by module 23 (`23-karma-expertise-rarity.md`, shipped
> Phase 1 in v1.1) is also gated by the same matrix.

---

## Design philosophy — read this first

Rastrum's gamification exists to **reward the observation behaviours scientists
actually want**, not to maximise session length. The default iNaturalist model —
"agreement count" + "identifier leaderboard" — already works; the Duolingo /
Strava model — streaks, points, push notifications — is the one we fear. We
adopt elements of both, but with hard guardrails:

1. **Everything is opt-in.** New accounts see no streak counter, no points, no
   rank, no badge progress. A single toggle in the profile enables the whole
   engagement layer. Legal consent to public visibility is a separate toggle
   (see module 07 for license interaction).
2. **No public leaderboards.** Ever. Period. Not even among friends. Private
   self-comparisons ("your 30-day observation count vs. your previous 30 days")
   are fine; "you rank #47 in Oaxaca" is not. Rationale: public ranks incentivise
   volume over quality and surface competitive behaviour that drives blurry
   throwaway photos into the dataset.
3. **Quality gates everything.** An observation with `identification.confidence < 0.4`
   or `identification.status = 'needs_review'` does not count toward streaks,
   badges, or activity. A research-grade observation (2/3 community consensus)
   counts double. This means the cheapest way to farm badges is also the most
   scientifically valuable.
4. **No push-notification streak nagging.** Streak reminders are inbox-digest
   only (one per day at most), and are opt-in on top of the gamification
   toggle. The streak *exists* on your profile; it never interrupts your day.
5. **No loot boxes, no chance mechanics, no collectible scarcity.** Badges are
   deterministic ("ID 10 research-grade plants in Oaxaca → receive badge").
   No random rewards. Complies with EU/MX digital consumer protection norms
   and avoids the slot-machine UX pattern.

The rest of this spec is the implementation of these rules. When the spec and
the rules disagree, the rules win — patch the spec.

---

## Profile (v0.1)

### Data model

Extends the existing `public.users` table (schema-wise) with additive,
non-breaking columns. Defaults keep existing rows valid.

```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS profile_public      boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS gamification_opt_in boolean  NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS streak_digest_opt_in boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS region_primary     text,              -- free-form, e.g. "Oaxaca, MX"
  ADD COLUMN IF NOT EXISTS joined_at          timestamptz NOT NULL DEFAULT now(),
  ADD COLUMN IF NOT EXISTS last_observation_at timestamptz,      -- updated by sync trigger
  ADD COLUMN IF NOT EXISTS stats_cached_at    timestamptz,
  ADD COLUMN IF NOT EXISTS stats_json         jsonb;             -- rolled-up counters
```

Policy: `stats_json` is denormalised from `observations` + `identifications`
on a scheduled refresh (Edge Function, once per hour). Its shape:

```typescript
interface UserStats {
  total_observations: number;              // synced only
  research_grade_count: number;
  species_count: number;                   // distinct taxon_id
  kingdom_breakdown: { Plantae: number; Animalia: number; Fungi: number };
  first_observation_at: string | null;
  last_observation_at: string | null;
  top_families: Array<{ family: string; count: number }>;  // top 5
  regions: Array<{ state_province: string; count: number }>;
  streak_days: number;                     // v1.0+ (see Streaks)
  streak_best: number;
}
```

### Profile page — `/{lang}/profile/{username}/`

Public read when `profile_public = true`. Private (404 to everyone but owner)
otherwise. The owner always sees their own.

Sections rendered:

1. **Header.** Avatar, display_name, username, bio, region_primary, joined_at,
   public/private badge.
2. **Top-line stats.** Total observations, species count, research-grade count,
   first observation date. Rendered from `stats_json`.
3. **Kingdom mix.** Horizontal bar: Plantae / Animalia / Fungi proportions.
4. **Top 5 families.** Names + counts.
5. **Activity feed (v0.3+).** See below.
6. **Badges (v0.5+).** See below.
7. **License preference.** "Observations published under: CC BY 4.0" — with
   a link to module 07 explaining what that means.
8. **Edit profile button** (owner only).

### Edit page — `/{lang}/profile/edit/`

Authenticated owner only. Fields: username, display_name, bio, avatar_url,
region_primary, preferred_lang, observer_license, profile_public,
gamification_opt_in, streak_digest_opt_in.

Client-side validation mirrors the `CHECK` constraints in the schema:
- `username`: `^[a-zA-Z0-9_]{3,30}$`
- `display_name`: ≤ 80 chars
- `bio`: ≤ 500 chars

Avatar upload goes to R2 bucket `media.rastrum.org/avatars/{user_id}/{ts}.jpg`
(see module 03 for R2 integration details).

### Header integration (v0.1)

The Sign In / Sign Out buttons in the Header already toggle via
`onAuthStateChange` (see module 04). Extend with an avatar dropdown when
authenticated:

- Click avatar → menu: `View profile` / `Edit profile` / `Sign out`
- Unread-count badge on avatar when activity feed has new items (v0.3+)

---

## Activity feed (v0.3)

### Data model

```sql
CREATE TABLE public.activity_events (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  actor_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  subject_id    uuid,                -- observation_id / identification_id / badge_id
  kind          text NOT NULL CHECK (kind IN (
    'observation_created',
    'observation_id_accepted',
    'observation_id_changed',
    'observation_research_grade',
    'badge_earned',
    'streak_milestone',
    'first_of_species_in_region',
    'first_observation_of_day',
    'comment_received',
    'validation_given',
    'validation_received'
  )),
  payload       jsonb,                -- kind-specific fields (species name, region, badge key, etc.)
  created_at    timestamptz NOT NULL DEFAULT now(),
  visibility    text NOT NULL DEFAULT 'self'
                CHECK (visibility IN ('self','followers','public'))
);

CREATE INDEX idx_activity_actor       ON activity_events(actor_id, created_at DESC);
CREATE INDEX idx_activity_public_feed ON activity_events(created_at DESC)
  WHERE visibility = 'public';
```

**Who writes:** server-side triggers (`AFTER INSERT` on `observations`,
`AFTER UPDATE OF is_primary` on `identifications`, etc.) enqueue events via
`INSERT INTO activity_events`. The PWA never writes here directly.

**Who reads:**
- Owner reads their full feed (everything with `actor_id = auth.uid()`).
- Public reads rows with `visibility = 'public'` AND the actor's `profile_public = true`.
- Followers tier deferred to v1.0 (requires a `follows` table).

### RLS policies

```sql
CREATE POLICY "activity_self_read" ON public.activity_events FOR SELECT
  USING ((SELECT auth.uid()) = actor_id);

CREATE POLICY "activity_public_read" ON public.activity_events FOR SELECT
  USING (
    visibility = 'public'
    AND actor_id IN (SELECT id FROM public.users WHERE profile_public = true)
  );
```

### UI — `/{lang}/profile/{username}/` activity section

Reverse-chronological list, grouped by day. Each event kind has a template:

- `observation_created` → "Observed *Quercus rugosa* in Oaxaca" + thumbnail
- `observation_research_grade` → "Reached research-grade on *Panthera onca*" + badge icon
- `first_of_species_in_region` → "First *Magnolia iltisiana* observation in Sierra Norte" + award icon
- `badge_earned` → "Earned *10 research-grade plants* badge" + badge art
- `streak_milestone` → "30-day observing streak" + flame icon

Pagination: cursor-based on `created_at`, page size 30.

---

## Badges (v0.5)

### Model

Two tables:

```sql
-- Catalogue of possible badges (seeded, rarely changes)
CREATE TABLE public.badges (
  key               text PRIMARY KEY,       -- e.g. 'research_grade_plants_10_oaxaca'
  name_es           text NOT NULL,
  name_en           text NOT NULL,
  description_es    text NOT NULL,
  description_en    text NOT NULL,
  category          text NOT NULL CHECK (category IN
    ('discovery','mastery','contribution','community','governance')),
  tier              text NOT NULL CHECK (tier IN ('bronze','silver','gold','platinum')),
  art_url           text NOT NULL,          -- R2 URL, 512×512 webp
  rule_json         jsonb NOT NULL,         -- eligibility predicate (see below)
  retired_at        timestamptz,
  created_at        timestamptz NOT NULL DEFAULT now()
);

-- Ledger of awards (append-only; never revoked except for policy violations)
CREATE TABLE public.user_badges (
  id            uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id       uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  badge_key     text NOT NULL REFERENCES public.badges(key),
  awarded_at    timestamptz NOT NULL DEFAULT now(),
  trigger_obs_id uuid REFERENCES public.observations(id), -- the specific observation that earned it
  revoked_at    timestamptz,
  revoke_reason text,
  UNIQUE (user_id, badge_key)
);
```

### Categories

| Category | Examples | Intent |
|---|---|---|
| **discovery**    | First-of-species-in-region, rarest species, new family observed | Reward finding things |
| **mastery**      | 10/50/100/500/1000 research-grade IDs of a taxon group | Reward depth |
| **contribution** | N observations exported to GBIF, N identifications given to others | Reward giving back |
| **community**    | BioBlitz participation, local event organiser | Reward co-operation |
| **governance**   | Completed FPIC training, Local Contexts consent workshop | Reward cultural work |

### Rules engine

`badges.rule_json` is a typed predicate evaluated by a nightly Edge Function.
Rules are *pure functions of the user's observation history* — no randomness,
no external state, no scarcity.

```typescript
// rule_json shape — discriminated union
type BadgeRule =
  | { type: 'research_grade_count'; taxon_group?: 'Plantae'|'Animalia'|'Fungi'; region?: string; threshold: number }
  | { type: 'species_count'; region?: string; threshold: number }
  | { type: 'first_of_species_in_region'; region: string }
  | { type: 'validation_given_count'; threshold: number }
  | { type: 'kingdom_diversity'; min_per_kingdom: number }
  | { type: 'governance_completion'; course_id: string };
```

Evaluator runs nightly (cheap — indexes are tuned for this):

```sql
-- Example: "10 research-grade plants in Oaxaca"
SELECT u.id
FROM public.users u
WHERE u.gamification_opt_in = true
  AND NOT EXISTS (SELECT 1 FROM user_badges WHERE user_id = u.id AND badge_key = 'rg_plants_10_oaxaca')
  AND (
    SELECT count(*)
    FROM observations o
    JOIN identifications i ON i.observation_id = o.id AND i.is_primary
    JOIN taxa t ON t.id = i.taxon_id
    WHERE o.observer_id = u.id
      AND o.sync_status = 'synced'
      AND i.is_research_grade = true
      AND t.kingdom = 'Plantae'
      AND o.state_province = 'Oaxaca'
  ) >= 10;
```

### Initial seed (v0.5)

Ship with ~40 badges covering the five categories. Examples:

- **Discovery**: `first_species_plantae`, `first_species_animalia`, `first_species_fungi`, `rare_nom059_p`, `cloud_forest_explorer`
- **Mastery**: `rg_plants_10`, `rg_plants_50`, `rg_plants_100`, `rg_birds_10`, `rg_mammals_10`, `endemic_oaxaca_10`
- **Contribution**: `gbif_published_1`, `gbif_published_50`, `validated_100`, `validation_given_100`
- **Community**: `bioblitz_participant`, `bioblitz_top_contributor` (attendees of one event, no cross-event ranking)
- **Governance**: `fpic_workshop`, `local_contexts_trained`, `nom059_sensitivity_training`

### Privacy

Badge awards are **private by default**. A user toggle "Show badges on my public
profile" controls whether they render on the public profile page. The ledger
row still exists either way — it only affects rendering.

---

## Streaks & quality gates (v1.0)

### Streak model

```sql
-- Per-user rolling streak; recomputed nightly from observations
CREATE TABLE public.user_streaks (
  user_id          uuid PRIMARY KEY REFERENCES public.users(id) ON DELETE CASCADE,
  current_days     integer NOT NULL DEFAULT 0,
  longest_days     integer NOT NULL DEFAULT 0,
  last_qualifying_day date,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
```

**Qualifying day** = the user has ≥ 1 synced observation whose primary
identification has `confidence ≥ 0.4` and is **not** flagged `needs_review`.
Observations still in `pending` sync state don't count; they're credited
retroactively when they reach the server.

This definition is the key anti-abuse defence: a user can't extend their
streak by uploading a pocket-photo. It has to have a plausible identification
to count.

### Grace window

One "freeze" per 30 days (soft-recorded, no UI action needed). If a user has
a 12-day streak and misses one day, they don't lose it — the nightly job
consumes the freeze and continues. Resets monthly.

Rationale: field biologists travel. Hard-reset streaks punish the user's
actual life and push them to farm observations on travel days, which is
the exact behaviour we're trying to avoid.

### Points (hidden, not shown to user)

We compute an internal score per observation — used for ranking the *quality*
of the feed we surface publicly ("trending observations this week"), not for
any user-visible points total.

```
score = base_value
      * (is_research_grade ? 2.0 : 1.0)
      * (nom059_status is not null ? 1.5 : 1.0)
      * (first_of_species_in_region ? 3.0 : 1.0)
      * (obs_quality_score >= 0.7 ? 1.2 : 0.8)

where base_value =
  0.5  if confidence < 0.4
  1.0  if 0.4 ≤ confidence < 0.7
  1.5  if confidence ≥ 0.7
```

**This score is never shown to the user.** It ranks the public explore feed
and powers the "featured observations" widget. Making it user-visible would
turn it into a point-chase and break the design philosophy.

---

## Events: BioBlitz (v1.0)

Time-boxed, location-boxed community observation pushes. Example: "Sierra Norte
BioBlitz, April 15–17, 2026, bounded polygon."

### Data model

```sql
CREATE TABLE public.events (
  id               uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  slug             text UNIQUE NOT NULL,              -- 'sierra-norte-2026'
  name             text NOT NULL,
  description_md   text,
  organiser_id     uuid REFERENCES public.users(id),
  starts_at        timestamptz NOT NULL,
  ends_at          timestamptz NOT NULL,
  region_geojson   geography(Polygon, 4326) NOT NULL,
  kind             text NOT NULL CHECK (kind IN ('bioblitz','survey','challenge')),
  created_at       timestamptz NOT NULL DEFAULT now()
);

-- Participation is implicit: an observation is "in the event" if its
-- geometry ∈ region AND observed_at ∈ [starts_at, ends_at]. No join table.
CREATE INDEX idx_events_time ON events(starts_at, ends_at);
```

### UI — `/{lang}/events/{slug}/`

Shows:
- Event description, dates, boundary on a map.
- Aggregate stats: total observations during the event, distinct species,
  distinct participants, kingdom breakdown. Aggregate-only — **no per-user
  leaderboard**. We list participants alphabetically with their count only
  if `gamification_opt_in = true` AND `profile_public = true`.
- "Most observed species during event" (a fun aggregate, not a ranking).

### Event badges

Participating (≥ 3 synced observations during event window and inside
boundary) earns `bioblitz_{event_slug}_participant`. Top 10% by synced
research-grade count earns `bioblitz_{event_slug}_top_contributor`. Top-10
naming is deliberately fuzzy — we don't show who made the top 10, only that
the user themselves did.

---

## Shareables (v1.0)

### Observation cards

Each observation has a canonical shareable card at
`https://rastrum.org/share/obs/{id}.png` generated on-demand by an
Edge Function. Layout: species thumbnail + scientific name + common name +
region + Rastrum logo + observer's display name (if profile_public).

Respects all the obscuration rules from module 02 — sensitive species get a
coarsened map; `obscure_level = 'full'` observations don't get shareables at
all.

### Badge cards

`https://rastrum.org/share/badge/{user_id}/{badge_key}.png`
Renders the badge art + name + "earned by @{username} on Rastrum".

Only available when the user's profile is public and `gamification_opt_in = true`.

### OpenGraph tags

Shareable pages set `og:image`, `og:title`, `og:description`, Twitter card
meta. Observation `og:description` includes sighted date, state/province,
and habitat (never precise coords).

---

## Privacy & consent flow

When a user enables `gamification_opt_in` for the first time, an explainer
modal runs:

> **Turning on badges, streaks, and activity**
>
> - Nothing changes in public. Your profile is still private unless you also
>   turn that on.
> - Streaks are counted in days you make an observation we can identify
>   (confidence ≥ 0.4). Blurry throwaway photos don't count — the dataset
>   comes first.
> - We never show leaderboards. Your streak, your badges, your stats: yours.
>   You can share what you want.
> - You can turn this off any time. Your badges stay earned but stop being
>   shown.

Three toggles, three consent dialogs. Nothing cascades without an explicit
click. Complies with the governance track principles even when FPIC isn't
directly relevant.

---

## Guardrails matrix (what prevents abuse)

| Abuse vector | Guardrail |
|---|---|
| Upload 100 blurry photos/day for streak | Streak requires confidence ≥ 0.4; blurry photos fail the Laplacian check before upload (module 01) |
| Self-validate your own observation to hit research-grade | Schema: `identifications.validated_by` cannot equal `observations.observer_id` (CHECK constraint) |
| Farm first-of-species by making 100 different "sp." IDs | Badge only fires when identification reaches research-grade (community consensus, not self) |
| Compete for fastest-1000-observations | There's no view that shows this. The feature simply doesn't exist. |
| Spam fake accounts to inflate validation count | `is_research_grade` requires 2/3 distinct accounts with minimum observation_count themselves (anti-sybil) |
| Stream-push notifications to re-engage | No push, only inbox digest, only opt-in on top of the gamification opt-in |

---

## Build sequence

| Version | Ships |
|---|---|
| **v0.1** | Profile page (basic: avatar, display_name, bio, license, preferred_lang, observation_count from existing trigger) • Avatar dropdown in Header • Edit profile page • `ALTER TABLE users` additive columns |
| **v0.3** | `activity_events` table + RLS + server-side triggers that insert on observation/id changes • Activity feed section on profile page • Unread-count badge on avatar |
| **v0.5** | `badges` + `user_badges` tables + seed of ~40 badges • Nightly badge-evaluator Edge Function • Badge display on profile page • Quality gates in badge evaluator |
| **v1.0** | `user_streaks` table + nightly evaluator • Streak section on profile • Inbox-digest streak reminders (opt-in) • `events` table + BioBlitz UI • Shareable observation cards + badge cards + OG tags |

---

## Testing requirements (added to infra/testing.md)

### RLS (pgTAP)
- A private profile is unreadable by an anonymous or other user.
- A public profile is readable by anonymous.
- Activity events respect the `visibility` + `profile_public` conjunction.
- A user cannot INSERT directly into `user_badges` (only the evaluator's service-role path can).

### Unit
- Badge rule evaluator produces identical results for equivalent `rule_json` shapes.
- Streak-day computation handles timezone edge cases (observation at 23:59 local
  on day N counts for day N, not day N+1 UTC).
- Grace window consumed at most once per 30-day rolling window.

### E2E
- New user enables `gamification_opt_in`; explainer modal shows; first qualifying
  observation increments the streak counter to 1.
- Observer with 10 research-grade plant observations in Oaxaca receives the
  `rg_plants_10_oaxaca` badge on the next nightly run.
- Public observation shareable loads with expected OG tags; obscured observation
  shareable shows coarsened region.

---

## Open questions

1. **Avatar abuse.** Default avatar upload opens user-controlled media URL on
   public profiles. Do we filter via an image-moderation API (OpenAI / Sightengine)
   or only on report? Recommend: on-report at v0.1, automatic at v1.0.
2. **Cross-account observation transfer** (guest → user migration in module 04):
   do migrated observations count retroactively toward streaks? Recommend: yes.
3. **Deleted observations.** If a user deletes an observation, does the related
   activity event get soft-deleted too? Recommend: yes — orphaned "observed X"
   feed rows are worse than silent gaps.
4. **Badge retirement.** We will retire badges that turn out to be gameable.
   Retired badges stay on the profile (historical) but no new user can earn them.
   Keep the `retired_at` column; UI grays retired badges.
