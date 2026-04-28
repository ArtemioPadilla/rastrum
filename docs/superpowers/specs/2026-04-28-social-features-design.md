# Social features: follow, reactions, comments, notifications

**Date:** 2026-04-28
**Status:** Design — pending user review
**Owner:** Artemio Padilla
**Phasing:** ships as three sequential modules — **M26** (social graph + reactions), **M27** (comments + mentions), **M28** (real-time + per-target mute + ID-help). Groups are deferred to a possible **M29**.
**Related modules:** 04 (auth/users), 22 (community validation), 25 (profile privacy + public profiles), karma/expertise/rarity (`2026-04-27-karma-expertise-rarity-design.md`).

---

## Goals

1. Move Rastrum from a solo-observer experience to a **scientific-collaboration network** — observers can follow experts, surface observations that need IDs, and discuss findings — while preserving the privacy ladder shipped in module 25.
2. Layer **engagement primitives** (reactions, follower counts, inbox) on top so the science loop has the dopamine hooks of a modern social product, without becoming generic social.
3. Lay groundwork for **community / groups** (region-bound, taxon-bound) without committing to ship them in v1.
4. Maintain Rastrum's **zero-cost / privacy-first** posture: every social action respects per-observation `obscure_level`, every public-facing string is bilingual, every table has RLS, abuse surface is minimized through composable primitives (block + report + Edge-Function rate-limits) rather than a moderation team.

## Non-goals

- Real-time chat, DMs, or groups in v1. Groups are parked as M29 pending demand signal.
- Bidirectional friendship UX (friend requests, mutual confirmation). Replaced by asymmetric follow + opt-in close-collaborator tier.
- Cross-platform social import (iNaturalist follow graph, etc.). Rastrum-local only.
- Mod queues with human moderators. Reports persist to a queue and email the operator; no moderator-role UI in v1.
- Algorithmic feed ranking. Feeds are reverse-chronological in v1; ranking is out of scope.
- Generic search over the social graph. Discovery happens through profile pages, ID-help queue, and the existing `/explore/*` views.

---

## Decisions captured (brainstorming outcome)

| Axis | Decision | Rationale |
|---|---|---|
| Primary intent | **All three goals, sequenced** (engagement, science, community) | Don't pick one tribe; sequence reduces risk |
| Graph shape | **Asymmetric follow + opt-in close-collaborator tier** | Matches expert/observer asymmetry; collaborator tier is the privacy upgrade for precise-coord access |
| Reactions schema | **Per-target tables** (`observation_reactions`, `photo_reactions`, `identification_reactions`, `comment_reactions`) with `kind` enum | Real FKs, `ON DELETE CASCADE`, simpler RLS — rejected polymorphic table after audit |
| Reactions UX (v1) | **One or two reaction kinds per surface** (fave on observations/photos, agree/disagree on identifications, helpful on comments) | Schema is flexible (D); UI surface is disciplined (A) to prevent cognitive overload |
| Comments schema | **Polymorphic-by-target** (single `comments` table) | Body/author/moderation columns identical across targets; soft-delete via `deleted_at` instead of FK cascade |
| Comments UX | **Flat threads, chronological, no nesting** | Matches iNaturalist; avoids Reddit-style derailments |
| Notifications | **In-app + email digests + real-time + per-kind + per-target mute** | "All available" depth — but defaults are conservative (email only for `@mention`; everything else opt-in) |
| Privacy composition | **Inherits the existing four-tier privacy matrix** via `social_visible_to(viewer, owner)` SQL function | Don't introduce a parallel social-privacy axis |
| Moderation | **Block + report + Edge-Function rate-limits** | Minimum viable abuse kit; defer auto-heuristics and mod roles |
| Rate-limit storage | **No `rate_limits` table — windowed `count(*)` in Edge Function** | Avoids doubling write traffic; sufficient at v1 scale |
| Phasing | **M26 → M27 → M28 (groups parked as M29)** | Front-load lowest-abuse primitive (follow); defer heaviest moderation surface (comments-everywhere) until graph proves itself |

---

## Module 26 — Social graph + reactions

### Data model

All additions are additive. No existing table or column is dropped or renamed.

#### `follows`
```sql
CREATE TABLE public.follows (
  follower_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  followee_id   uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  tier          text        NOT NULL DEFAULT 'follower'
                            CHECK (tier IN ('follower', 'collaborator')),
  status        text        NOT NULL DEFAULT 'accepted'
                            CHECK (status IN ('pending', 'accepted')),
  requested_at  timestamptz NOT NULL DEFAULT now(),
  accepted_at   timestamptz,
  PRIMARY KEY (follower_id, followee_id),
  CHECK (follower_id <> followee_id)
);
CREATE INDEX idx_follows_followee_status ON public.follows(followee_id, status);
CREATE INDEX idx_follows_follower_status ON public.follows(follower_id, status);
```

`status='pending'` is used for two cases: (a) the followee's profile privacy requires approval for any follower; (b) a follower-tier user has requested an upgrade to collaborator-tier. The Edge Function `follow` decides which.

#### Per-target reaction tables
```sql
CREATE TABLE public.observation_reactions (
  id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id        uuid        NOT NULL REFERENCES public.users(id)        ON DELETE CASCADE,
  observation_id uuid        NOT NULL REFERENCES public.observations(id) ON DELETE CASCADE,
  kind           text        NOT NULL
                             CHECK (kind IN ('fave','agree_id','needs_id','confirm_id','helpful')),
  created_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, observation_id, kind)
);
CREATE INDEX idx_obsreact_obs_kind ON public.observation_reactions(observation_id, kind);

CREATE TABLE public.photo_reactions (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL REFERENCES public.users(id)  ON DELETE CASCADE,
  photo_id    uuid NOT NULL REFERENCES public.photos(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('fave','helpful')),
  created_at  timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, photo_id, kind)
);
CREATE INDEX idx_photoreact_photo_kind ON public.photo_reactions(photo_id, kind);

CREATE TABLE public.identification_reactions (
  id                uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id           uuid NOT NULL REFERENCES public.users(id)            ON DELETE CASCADE,
  identification_id uuid NOT NULL REFERENCES public.identifications(id)  ON DELETE CASCADE,
  kind              text NOT NULL CHECK (kind IN ('agree_id','disagree_id','helpful')),
  created_at        timestamptz NOT NULL DEFAULT now(),
  UNIQUE(user_id, identification_id, kind)
);
CREATE INDEX idx_idreact_id_kind ON public.identification_reactions(identification_id, kind);
```

`comment_reactions` is defined identically and ships with M27 (when comments themselves ship).

**Schema-D / UX-A discipline:** the `CHECK (kind IN …)` enums permit five reaction kinds per surface, but the v1 UI surfaces only `fave` on observations + photos, `agree_id`/`disagree_id` on identifications, `helpful` on comments. Adding more reactions later is a UX change, not a migration.

#### `blocks`
```sql
CREATE TABLE public.blocks (
  blocker_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  blocked_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  created_at  timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (blocker_id, blocked_id),
  CHECK (blocker_id <> blocked_id)
);
CREATE INDEX idx_blocks_blocked ON public.blocks(blocked_id);
```

`blocks` is read-symmetric: if A blocks B, neither A nor B sees the other's reactions, comments, or follows in any feed.

#### `reports`
```sql
CREATE TABLE public.reports (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  reporter_id  uuid        NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  target_type  text        NOT NULL
                           CHECK (target_type IN ('user','observation','photo','identification','comment')),
  target_id    uuid        NOT NULL,
  reason       text        NOT NULL
                           CHECK (reason IN ('spam','harassment','wrong_id','privacy_violation','copyright','other')),
  note         text,
  status       text        NOT NULL DEFAULT 'open'
                           CHECK (status IN ('open','triaged','resolved','dismissed')),
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_reports_status_created ON public.reports(status, created_at DESC);
```

#### `notifications`
```sql
CREATE TABLE public.notifications (
  id          uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind        text        NOT NULL
                          CHECK (kind IN ('follow','follow_accepted','reaction','comment','mention',
                                          'identification','badge','digest')),
  payload     jsonb       NOT NULL DEFAULT '{}',
  read_at     timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_notifications_user_unread ON public.notifications(user_id, read_at) WHERE read_at IS NULL;
CREATE INDEX idx_notifications_user_created ON public.notifications(user_id, created_at DESC);
```

A nightly `pg_cron` job (`prune_old_notifications`) deletes rows where `read_at < now() - interval '90 days'`.

#### Counters on `users`
```sql
ALTER TABLE public.users
  ADD COLUMN IF NOT EXISTS follower_count   integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS following_count  integer NOT NULL DEFAULT 0;
```

Maintained by trigger (`tg_follows_counter`) on `follows` insert/delete, only when `status='accepted'`.

### Privacy composition

The existing schema gates observation visibility through two orthogonal mechanisms:
- `observations.obscure_level` (coord-precision coarsening for sensitive species, gated row-level by `obs_public_read`).
- `users.profile_privacy` JSONB + `can_see_facet(target, facet, viewer)` (per-user facet visibility from module 25).

There is **no** per-observation `visibility` column with `public/followers/collaborators/private` values; we don't add one. Instead, social actions inherit those mechanisms:

```sql
-- Is the actor a follower or the owner themselves?
CREATE OR REPLACE FUNCTION public.social_visible_to(viewer uuid, owner uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT
    viewer IS NOT NULL AND (
      viewer = owner
      OR EXISTS (
        SELECT 1 FROM public.follows f
         WHERE f.follower_id = viewer
           AND f.followee_id = owner
           AND f.status      = 'accepted'
      )
    );
$$;

-- Is the actor an accepted close-collaborator? Collaborators get the same
-- coord-precision unlock as `is_credentialed_researcher` does today.
CREATE OR REPLACE FUNCTION public.is_collaborator_of(viewer uuid, owner uuid)
RETURNS boolean
LANGUAGE sql STABLE PARALLEL SAFE AS $$
  SELECT viewer IS NOT NULL AND EXISTS (
    SELECT 1 FROM public.follows f
     WHERE f.follower_id = viewer
       AND f.followee_id = owner
       AND f.tier        = 'collaborator'
       AND f.status      = 'accepted'
  );
$$;
```

Both functions are `STABLE` and `PARALLEL SAFE` so the planner can inline them into RLS USING clauses. No `PLPGSQL` in the hot path.

**RLS on reactions** (illustrative; mirror across all four reaction tables) — a reaction is readable iff the *observation* is readable AND the reactor is not block-symmetric to the viewer:

```sql
ALTER TABLE public.observation_reactions ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS obsreact_read ON public.observation_reactions;
CREATE POLICY obsreact_read ON public.observation_reactions FOR SELECT
  USING (
    EXISTS (
      SELECT 1 FROM public.observations o
       WHERE o.id = observation_reactions.observation_id
         AND (
           o.observer_id = auth.uid()
           OR (
             o.obscure_level <> 'full'
             AND public.can_see_facet(o.observer_id, 'observations', auth.uid())
           )
           OR public.is_collaborator_of(auth.uid(), o.observer_id)
         )
    )
    AND NOT EXISTS (
      SELECT 1 FROM public.blocks b
       WHERE (b.blocker_id = auth.uid() AND b.blocked_id = observation_reactions.user_id)
          OR (b.blocked_id = auth.uid() AND b.blocker_id = observation_reactions.user_id)
    )
  );

DROP POLICY IF EXISTS obsreact_write ON public.observation_reactions;
CREATE POLICY obsreact_write ON public.observation_reactions FOR INSERT
  WITH CHECK (user_id = auth.uid());

DROP POLICY IF EXISTS obsreact_delete ON public.observation_reactions;
CREATE POLICY obsreact_delete ON public.observation_reactions FOR DELETE
  USING (user_id = auth.uid());
```

**Collaborator coord-precision unlock.** Extend the existing `obs_credentialed_read` analog so collaborators see precise coords on obscured observations of users they collaborate with — same shape as the credentialed-researcher policy that already exists.

**Reaction-count visibility on obscured observations.** Counts are exposed via the `observation_reaction_counts` view; the *list* of reactors goes through the gated `observation_reactions` table (RLS above). When `obscure_level <> 'none'` AND total reactions < 3, the count is also gated to prevent identity inference (see Risks).

### Edge Functions

| Name | Purpose | `verify_jwt` | Rate-limit |
|---|---|---|---|
| `follow`   | Insert/accept/reject follow; tier upgrade requests; throttle | yes | ≤ 30 follows/hour, ≤ 5 collaborator requests/day |
| `react`    | Idempotent toggle of a (target, kind) reaction; throttle | yes | ≤ 200 reactions/hour |
| `report`   | Insert into `reports`; email operator | yes | ≤ 10 reports/day |

Throttling is implemented inline: each function runs `SELECT count(*) FROM <table> WHERE user_id = auth.uid() AND created_at > now() - interval '<window>'` and rejects with HTTP 429 if over. No `rate_limits` table.

### Frontend surfaces

| Route (EN ↔ ES) | Purpose |
|---|---|
| `/{en,es}/profile/[handle]/followers` ↔ `/seguidores` | Followers list (visibility per profile privacy) |
| `/{en,es}/profile/[handle]/following` ↔ `/siguiendo` | Following list |
| `/{en,es}/inbox` ↔ `/bandeja` | Notifications |
| Profile header (existing) | Follow/Unfollow/Request Collaborator buttons |
| Observation cards (existing) | Reaction icon + count |
| Settings (existing) | Per-kind notification preferences, blocked users list |

Views extracted into `FollowersView.astro`, `InboxView.astro`, etc., consumed by both EN and ES pages (parity rule).

### Counters and triggers

`tg_follows_counter` on `follows` after insert/update/delete, only fires when `status='accepted'` is gained or lost. Increments/decrements `users.follower_count` and `users.following_count` in a single statement to avoid deadlocks.

Per-target reaction count columns (`fave_count`, etc.) are added to `observations` and `photos` only if the existing aggregate views become a hot read path — defer until measured.

---

## Module 27 — Comments + mentions

### Data model

#### `comments`
```sql
CREATE TABLE public.comments (
  id           uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  author_id    uuid        NOT NULL REFERENCES public.users(id) ON DELETE SET NULL,
  target_type  text        NOT NULL
                           CHECK (target_type IN ('observation','photo','identification')),
  target_id    uuid        NOT NULL,
  body         text        NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
  body_html    text,                                  -- cached, server-rendered
  edited_at    timestamptz,
  deleted_at   timestamptz,                            -- soft delete
  created_at   timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX idx_comments_target ON public.comments(target_type, target_id, created_at);
CREATE INDEX idx_comments_author ON public.comments(author_id, created_at DESC);
```

**Why polymorphic here but not for reactions:** body+author+moderation columns are identical across targets, and soft-delete (`deleted_at`) replaces FK cascade. The trade-off (no FK to target) is acceptable because comments outlive reactions and we want a single moderation surface.

#### `comment_mentions`
```sql
CREATE TABLE public.comment_mentions (
  comment_id          uuid NOT NULL REFERENCES public.comments(id) ON DELETE CASCADE,
  mentioned_user_id   uuid NOT NULL REFERENCES public.users(id)    ON DELETE CASCADE,
  PRIMARY KEY (comment_id, mentioned_user_id)
);
CREATE INDEX idx_mentions_user ON public.comment_mentions(mentioned_user_id);
```

#### `notification_prefs`
```sql
CREATE TABLE public.notification_prefs (
  user_id   uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  kind      text NOT NULL,
  channel   text NOT NULL CHECK (channel IN ('in_app','email')),
  enabled   boolean NOT NULL,
  PRIMARY KEY (user_id, kind, channel)
);
```

Defaults loaded by trigger on user insert, keyed against the `notifications.kind` enum:
- in_app: all kinds enabled
- email: only `mention` enabled by default; users can opt into others

This keeps the prefs schema in lock-step with the notification kinds enum (no synthetic kinds). Smarter "follow-from-known-user" filtering can be layered on later as a payload heuristic in the digest function without a schema change.

### Edge Functions

| Name | Purpose | Rate-limit |
|---|---|---|
| `post-comment`           | Parse mentions, write comment + comment_mentions, fan out notifications | ≤ 60 comments/hour |
| `digest-notifications`   | Daily aggregator; batches per user; sends via Resend | run via `pg_cron` 14:00 UTC |

### Mention parser

Server-side in `post-comment`:
1. Tokenize body for `@<handle>` patterns (regex `@([a-z0-9_]{3,32})`).
2. Look up handles against `users.handle`.
3. For each match, write `comment_mentions` row.
4. Render `body_html` with `<a href="/profile/<handle>">@handle</a>`.
5. Fan out: insert one `notifications` row per mentioned user, respecting `blocks` and `notification_prefs`.

Autocomplete on the frontend pulls from `(users I follow) ∪ (users following me)` with a 300ms debounce.

### Email digests

Daily Edge Function, runs via `pg_cron`:
- Aggregate unread `notifications` per user since last digest.
- Skip users with no unread notifications.
- Group by kind; render via Mustache template, locale-aware.
- Send via Resend API (free tier 100/day → upgrade signal at ~80/day).
- Mark dispatched notifications with a sentinel `payload.digested_at`.

---

## Module 28 — Real-time + per-target mute + ID-help

### Data model

```sql
CREATE TABLE public.mutes (
  user_id      uuid        NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  target_type  text        NOT NULL CHECK (target_type IN ('observation','comment_thread')),
  target_id    uuid        NOT NULL,
  created_at   timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (user_id, target_type, target_id)
);
```

### Real-time

Frontend subscribes to `notifications` via Supabase Realtime, filtered by `user_id = auth.uid()`. Service worker handles web-push for installed PWAs. Push payloads contain only summary data — never coordinates, never observation-specific locality.

### ID-help workflow

Reuses the existing `needs_id` reaction (already in `observation_reactions.kind` enum from M26):
- New route `/{en,es}/identify/help` ↔ `/identificar/ayuda`.
- Lists observations with at least one `needs_id` reaction, filterable by region (PostGIS bbox) + taxon prefix.
- Reuses `ExploreSpecies.astro` shell.

No new schema for ID-help.

### Groups (parked as M29)

Provisional schema, not shipped in M28:
```
groups          (id, slug, name, kind ∈ {region, taxon, custom}, scope jsonb, owner_id, visibility, created_at)
group_members   (group_id, user_id, role ∈ {member, mod, owner}, joined_at)
```

Ship only if observed demand justifies it after M27 ships.

---

## Cross-cutting concerns

### i18n

Every user-visible string under a new `social.*` namespace in `src/i18n/{en,es}.json`:
- `social.follow.button`, `social.follow.requested`, `social.follow.collaborator_request`
- `social.reactions.fave`, `social.reactions.agree_id`, `social.reactions.helpful`, …
- `social.notifications.kind.follow`, `social.notifications.kind.mention`, …
- `social.report.reasons.spam`, `social.report.reasons.harassment`, …
- `social.inbox.empty`, `social.inbox.mark_all_read`, …

Per-record `_es` suffix pattern for any seeded data (report reason catalog, default group names if M29 ships).

### Routing (locale-paired)

| EN | ES |
|---|---|
| `/profile/[handle]/followers` | `/profile/[handle]/seguidores` |
| `/profile/[handle]/following` | `/profile/[handle]/siguiendo` |
| `/inbox` | `/bandeja` |
| `/identify/help` | `/identificar/ayuda` |

Existing `/share/obs/?id=…` is locale-neutral and stays that way; reactions and comments render inline.

### Tests

**Unit (Vitest):**
- `social_visible_to` privacy ladder (8 cases: owner/follower/collaborator/stranger × public/follower/collaborator/private)
- Reaction toggle idempotence (insert, re-insert, delete, re-delete)
- Mention parser (no mention, one mention, multiple, blocked target, deleted target, locale-folded handle)
- Block enforcement (A reacts → B blocked → A doesn't see B's reactions and vice versa)

**E2E (Playwright):** one happy-path per module —
- M26: follow → see reaction in feed
- M27: comment with @mention → mentioned user sees inbox row
- M28: real-time toast appears within 2s of upstream insert; per-target mute hides subsequent notifications

**RLS:** `tests/sql/social-rls.sql` covers the privacy ladder × every reaction/comment/follow read path.

### Edge Function deploys

All deploy via `gh workflow run deploy-functions.yml -f function=<name>` per existing convention. Cron-driven functions (`digest-notifications`, `prune_old_notifications`) deploy `--no-verify-jwt` because they run as service-role.

### Migration safety

All schema changes additive. `users.follower_count` and `users.following_count` default `0` — backfilled by a one-shot statement in `supabase-schema.sql`:
```sql
UPDATE public.users u SET
  follower_count  = (SELECT count(*) FROM follows WHERE followee_id = u.id AND status='accepted'),
  following_count = (SELECT count(*) FROM follows WHERE follower_id = u.id AND status='accepted')
WHERE follower_count = 0 AND following_count = 0;
```

### Observability

`social_metrics` view aggregating daily `follow`, `reaction`, `comment`, `report` counts. No PII. Surfaced on the operator dashboard (existing module).

### OG cards

`/inbox` and `/identify/help` are auth-gated → no OG card. `/profile/[handle]/{followers,following}` reuses the existing profile OG card. No new entries in `scripts/generate-og.ts` needed for M26/M27. M28 ID-help may want one — defer until shipped.

### Roadmap + tasks updates

- `docs/progress.json`: three new items — `social-graph`, `comments-mentions`, `realtime-mutes-id-help` — with `_es` translations under the appropriate phase.
- `docs/tasks.json`: subtask breakdown per item.
- `docs/specs/modules/00-index.md`: register `26-social-graph.md`, `27-comments-mentions.md`, `28-realtime-mutes-id-help.md`. Note `29-groups.md` as future work, not registered yet.

---

## Risks and open questions

1. **Reaction-count visibility on obscured observations.** Spec says count is public, list is gated. Edge case: a user with one follower could have their identity inferred from a single-reaction count on a private observation. Mitigation: hide list AND count when `obscure_level > 0` AND total reactions < 3. Implement as an additional view-level filter.
2. **Block-symmetry leaking through legacy data.** If A blocks B after B has already reacted to A's observation, the reaction is hidden on read but still exists. Acceptable for v1. Re-evaluate if it becomes a vector.
3. **Notification-row growth.** 90-day prune may not be enough if a popular user accrues thousands of follows per week. Add a per-user cap (keep last 500 unread) as a follow-up if observed.
4. **Real-time scaling on free tier.** Supabase Realtime free tier: 200 concurrent connections. v1 is fine; flag for upgrade at ~150 concurrent active users.
5. **Resend free tier exhaustion.** 100 email digests/day. Once exceeded, either upgrade ($20/mo) or implement a weekly-digest fallback for low-activity users.
6. **Groups (M29) demand signal.** Don't build until users explicitly ask for region/taxon-bound spaces — easy to over-engineer here.

---

## Future work (post-M28)

- M29 — Groups (region, taxon, custom)
- Algorithmic feeds (recommend observations based on follow graph + taxon affinity)
- Cross-platform follow import (iNaturalist mapping)
- Comment editing history / version log (currently single `body`)
- Moderator role + queue UI (when volume justifies it)
- Activity-pub federation (longer-term, if community grows)
