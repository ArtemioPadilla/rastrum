# Rastrum Architecture

> One page. The repo tree lives in [`AGENTS.md`](../AGENTS.md); module
> design lives under [`specs/modules/`](specs/modules/00-index.md). This
> file is for "how do the pieces fit together" — block diagram + the
> four critical-path flows + decision rationale.
>
> Last sync: 2026-04-26 (v1.0 + chrome revamp).

---

## Block diagram

```
        ┌──────────────────────────────────────────────────────────────────┐
        │                          rastrum.org                             │
        │   Astro 5 static site + PWA shell + service worker (cached)      │
        │   ─ pages/{en,es}/  routes paired by locale (EN/ES parity)       │
        │   ─ components/*View.astro  shared bodies between locales        │
        │   ─ public/sw.js  cache-first for same-origin GETs               │
        └────────────┬───────────────────────────────────────┬─────────────┘
                     │                                       │
                     │  edge functions (Deno)                │  client-side
                     ▼                                       ▼
   ┌─────────────────────────────────────┐   ┌─────────────────────────────────────┐
   │  Supabase project                    │   │  In-browser AI (opt-in)             │
   │  ─ Edge Functions:                   │   │  ─ WebLLM Phi-3.5-vision  (vision)  │
   │      identify, enrich-environment,   │   │  ─ WebLLM Llama-3.2-1B    (text)    │
   │      recompute-streaks, award-       │   │  ─ EfficientNet-Lite0 ONNX (base)   │
   │      badges, share-card,             │   │  ─ BirdNET-Lite ONNX     (audio)    │
   │      get-upload-url, export-dwca,    │   │  Cached in Cache API + OPFS         │
   │      api, mcp                        │   └─────────────────┬───────────────────┘
   │  ─ Postgres + PostGIS + RLS          │                     │
   │      observations, identifications,  │                     │ identifier plugins
   │      media_files, users, taxa,       │                     │ via cascade.ts
   │      activity_events, badges,        │                     │
   │      events, follows, watchlists,    │   ┌─────────────────▼───────────────────┐
   │      user_api_tokens, …              │   │  Dexie outbox  (RastrumDB)          │
   │  ─ pg_cron schedules                 │   │  ─ observations (drafts)             │
   └────────────┬─────────────────────────┘   │  ─ mediaBlobs   (resized JPEGs/WAV)  │
                │                              │  ─ idQueue      (failed cascade)    │
                │ media uploads                └─────────────────┬───────────────────┘
                ▼                                                │ syncOutbox()
   ┌─────────────────────────────────────┐                       │
   │  Cloudflare R2  media.rastrum.org   │◀──────────────────────┘
   │  ─ observations/<id>/<n>.jpg         │   put via presigned URLs from
   │  ─ models/birdnet-lite-v2.4.onnx     │   get-upload-url Edge Function
   │  ─ models/efficientnet-lite0-int8…   │
   │  ─ tiles/mexico-overview-v1.pmtiles  │
   └─────────────────────────────────────┘
```

External services Rastrum depends on (none of which we self-host):

- **PlantNet API** for plant ID — `https://my-api.plantnet.org`.
- **Anthropic Claude Haiku** for vision fallback — server-side or BYO.
- **OpenMeteo** for weather backfill — no key required.
- **OpenFreeMap** for the base map style (until pmtiles loads).
- **MegaDetector / SpeciesNet** — operator-hosted endpoint, optional.

The MCP server (`/functions/v1/mcp`) sits inline with the REST API
(`/functions/v1/api/*`) — same `rst_*` token, same scope strings, same
RLS gates. AI agents (Claude Desktop, Cursor, Copilot Coding Agent)
call the MCP surface; shell scripts call the REST surface.

---

## Frontend chrome

The app shell uses a verb-first IA introduced in the UX-revamp PR 1
(2026-04-26). Three action items sit on the left of the header — **Observe**,
**Explore ▾**, **Chat** — and a reference cluster (**About**, **Docs ▾**) on
the right. On mobile, a bottom bar with a center camera FAB replaces the
header actions; a right-side drawer handles reference links and account
settings. Each top-level section has a named accent colour (Observe = emerald,
Explore = teal, Chat = sky, About/Docs = stone) rendered via a dynamic
`railClass()` in `Header.astro` — those classes are safelisted in
`tailwind.config.mjs`. New explore subroutes `/explore/{recent,watchlist,species}`
are placeholder pages as of this sync; `/profile/watchlist` issues a 301 to
`/explore/watchlist`.

---

## Critical-path data flows

### 1. Observation submit (online)

```
ObservationForm.astro (browser)
    │ exifr extracts GPS + DateTimeOriginal
    │ navigator.geolocation refines (two-pass, fast → high-accuracy)
    ▼
src/lib/db.ts (Dexie)
    │ insert observation + mediaBlobs (resized to ≤1200 px JPEG q=0.85)
    ▼
src/lib/sync.ts → syncOutbox()
    │ (a) get-upload-url Edge Function → R2 presigned PUT
    │ (b) supabase-js insert into observations + media_files
    │ (c) fire-and-forget identify + enrich-environment
    ▼
identify Edge Function (cascade.ts)
    │ parallel race: PlantNet ∥ Claude Haiku ∥ on-device
    │ first past confidence threshold wins
    ▼
sync_primary_id_trigger (Postgres)
    │ denormalises obscure_level + location_obscured for RLS
    ▼
activity_events row (visible in /profile/ feed)
```

### 2. Photo identification — two cascade modes {#identifier-cascade}

The identification pipeline runs differently depending on where it's triggered. See [`docs/specs/modules/21-identify.md`](specs/modules/21-identify.md) for the full contract.

**Client-side (Identify page — `/en/identify/`):** PlantNet, Claude, and Phi-vision fire in parallel. The first provider to return a result above its confidence threshold wins and cancels the others. If all fail, Phi-vision prompts the user to opt in to the local model download.

**Server-side (sync.ts → `identify` Edge Function):** the same parallel race via `cascade.ts`. Available providers are sorted by license cost and fired concurrently; the first result above the accept threshold wins:

```
runCascade() — parallel race, cost-sorted
  ┌─────────────────────────────────────────────────────┐
  │  PlantNet API        (free-quota · cloud)           │
  │  Claude Haiku 4.5    (byo-key · cloud)              │  run concurrently
  │  EfficientNet-Lite0  (free-nc · on-device ONNX)     │  via Promise.race
  │  Phi-3.5-vision      (free-nc · on-device WebLLM)   │
  └──────────────────────────┬──────────────────────────┘
                             │
                  first confidence ≥ 0.7 wins
                  others cancelled (AbortController)
                             │
                  if none above threshold →
                  best-of-all returned (needs_review)
```

The cascade is deterministic by license cost: free plugins go first; BYO-key
plugins run when keys are present. The `force_provider` knob bypasses
the race for testing. All confidence < 0.4 results are blocked
from research-grade by the `enforce_research_grade_quality` trigger.

When offline at submit time, the outbox holds the row plus the binary;
the cascade is deferred. On `online` event or `visibilitychange` returning
to visible, `registerSyncTriggers()` runs `syncOutbox()`, which fires the
server-side cascade via the `identify` Edge Function.

### 3. Audio identification (BirdNET)

```
ObservationForm.astro
    │ MediaRecorder ≤ 30 s WAV
    ▼
sync.ts uploads .wav to R2 with media_type=audio
    ▼
runCascade() with kind='audio' → birdnet-lite plugin
    │ fetches ONNX from PUBLIC_BIRDNET_WEIGHTS_URL (R2)
    │ Meyda spectrogram preprocessing in JS
    │ onnxruntime-web inference, top-3 species
    ▼
identification row written by client + sync trigger
```

The model is shipped from R2 rather than bundled (~50 MB) so the static
PWA stays small. The Cornell Lab license is non-commercial; the v2.0
B2G dashboard would require a separate commercial license.

#### In-browser AI {#in-browser-ai}

EfficientNet-Lite0 ONNX and Phi-3.5-vision are the on-device fallbacks at the
bottom of both cascade modes. EfficientNet is always available (preloaded ONNX
via `onnxruntime-web`). Phi-3.5-vision requires a first-run download
(~2.7 GB cached via the Cache API) and is gated by `localStorage.rastrum.localAiOptIn`.
Both run entirely in the browser — no server round-trip, no key needed.
See `src/lib/local-ai.ts` and `src/lib/identifiers/phi-vision.ts`.

### 4. Sync after offline

```
visibilitychange / online event
    └─> syncOutbox():
        1. authenticated?  if no, leave queue alone
        2. for each pending observation:
             upload mediaBlobs to R2 (parallel)
             insert observation + media_files
             trigger identify (fire-and-forget)
             trigger enrich-environment (fire-and-forget)
        3. resolve idQueue retries
        4. emit storage event so other tabs refresh
```

`registerSyncTriggers()` is idempotent — re-registering doesn't double
listeners. The cascade engine retries with exponential backoff inside
the Edge Function rather than at the client to keep the outbox simple.

---

## Where each piece lives

| Concern | Path |
|---|---|
| UI shells and routes | `src/layouts/` + `src/pages/{en,es}/` |
| Shared per-feature views | `src/components/*View.astro` |
| Forms | `src/components/*Form.astro` |
| i18n strings | `src/i18n/{en,es}.json` |
| i18n helpers | `src/i18n/utils.ts` (`t()`, `routes`, `routeTree`, `docPages`) |
| Auth (magic link, OAuth, OTP, passkey) | `src/lib/auth.ts` |
| BYO key store | `src/lib/byo-keys.ts` |
| Identifier plugin platform | `src/lib/identifiers/` |
| Cascade engine | `src/lib/identifiers/cascade.ts` |
| Outbox / sync | `src/lib/db.ts` + `src/lib/sync.ts` |
| Upload (R2 + Supabase Storage) | `src/lib/upload.ts` |
| Darwin Core mapping | `src/lib/darwin-core.ts` + `src/lib/dwca.ts` |
| In-browser AI bootstrap | `src/lib/local-ai.ts` |
| Chrome mode helper | `src/lib/chrome-mode.ts` (`resolveChromeMode`) |
| Chrome accent / FAB helpers | `src/lib/chrome-helpers.ts` (`getFabTarget`, `isActiveSection`) |
| Edge Functions | `supabase/functions/<name>/index.ts` |
| Schema (idempotent SQL) | `docs/specs/infra/supabase-schema.sql` |
| Module specs | `docs/specs/modules/NN-*.md` |
| Roadmap source of truth | `docs/progress.json` (do not hand-edit if you mean the JSON) |
| Subtask source of truth | `docs/tasks.json` |

---

## Key trade-offs

- **Static site, no Node server.** Rastrum builds to plain HTML/JS via
  Astro and deploys to GitHub Pages. All dynamic logic runs either in
  the browser or in Supabase Edge Functions (Deno). This rules out
  SSR-only patterns but keeps hosting cost at zero.
- **Cascade by license cost, not by accuracy.** Cloud APIs run first
  when keys exist (PlantNet > Claude Haiku); on-device runs when they
  don't. Users who BYO a key see better results without changing UX;
  users who don't get correct-shaped fallback IDs they can manually
  refine.
- **R2 over Supabase Storage for media.** Egress is free on R2 and
  metered on Supabase Storage. Same code path supports both via
  `src/lib/upload.ts` for self-hosters.
- **One outbox, one cascade engine.** The Dexie outbox stores
  observations regardless of online state; `syncOutbox()` handles the
  trip. The cascade engine is the same code on the client (offline
  fallback) and the Edge Function (online). Less drift, fewer bugs.
- **EN/ES from day one, no third locale yet.** Adding Zapoteco / Mixteco
  is a v2.5 governance-track item, not a code task. The structure
  supports it (per-record `_es` suffix; per-string i18n JSON), but
  shipping requires community FPIC consent first — see module 07.
- **Sensitive species obscuration is denormalised.** RLS reads from
  `observations.location_obscured` rather than recomputing per-row, so
  the policy is fast and indexable. The trigger `sync_primary_id_trigger`
  keeps it in lockstep with the primary identification.
- **No mobile-native build yet.** Capacitor iOS is a v1.2 plan. The PWA
  installs to home-screen on iOS Safari and Android Chrome already; the
  native wrapper is for App Store discoverability and background sync.

---

## Community validation (Module 22, v1.1)

Reuses the existing identification engine instead of adding a parallel
votes table:

```
Signed-in user (not the observer)
  └─ /share/obs/?id=<obs-id>         (or /explorar/validar/)
      └─ Suggest CTA → SuggestIdModal
          └─ INSERT identifications  (validated_by = auth.uid(),
                                      is_primary = false)
          └─ rpc('recompute_consensus', { p_observation_id })
              └─ weighted aggregation: 3× for is_expert AND
                 kingdom = ANY(expert_taxa); else 1×
              └─ when winning_score ≥ 2.0 AND ≥ 2 distinct
                 voters AND no tie → flips primary row to
                 is_research_grade = true
                  └─ existing fire_research_grade_trigger fires an
                     'observation_research_grade' activity_event
                     for the observer
```

Server-side eligibility lives in a single view
(`public.validation_queue`) so the frontend can't drift from policy.
The view includes only synced, non-fully-redacted observations whose
primary identification is missing or low-confidence and not yet
research-grade.

## Console (privileged surfaces)

Three role tiers — admin, moderator, expert — share one chrome surface
under `/console/`. Privileged writes flow through one Edge Function with
an atomic write+audit transaction:

```
Browser ──POST {action,payload,reason}──▶ /functions/v1/admin
                                              │
                                              ├─ verifyJwtAndLoadRoles()
                                              ├─ requireRole(action.required)
                                              ├─ payloadSchema.parse()
                                              ├─ handler.execute()       ┐
                                              ├─ insertAuditRow()        ├ logical tx
                                              └─ return {audit_id}        ┘
```

RLS predicates use `has_role(auth.uid(), <role>)`. The `users.is_expert`
and `users.credentialed_researcher` columns are denormalised caches kept
in sync via `user_roles_sync_flags` trigger; consensus computation and
the `obs_credentialed_read` RLS policy continue to read those columns
on the hot path.

Phased rollout: foundation (PR1), high-pain (PR2), operator value (PR3),
on-demand (PR4+). See [Module 24](specs/modules/24-admin-console.md).

## Atomic delete

The `/share/obs` Manage-panel **Delete** button calls the
`delete-observation` Edge Function (not a direct PostgREST DELETE) so
that R2 photo blobs and the OG card are removed in lockstep with the
DB row. The function:

1. Verifies the caller's JWT and observation ownership
2. Lists `media_files.url` → R2 keys via host-match against `R2_PUBLIC_URL`
3. `DeleteObjects` to R2 (batched, includes `og/<obs-id>.png`)
4. `DELETE FROM observations` with the service-role key
   (FK cascades to identifications + media_files)

The two halves are coupled inside the Edge Function so a partial
failure leaves at most orphaned R2 blobs — never the inverse (DB rows
that point at missing photos).

## OG card pipeline (zero per-request server compute)

Static pages: `npm run build` runs `scripts/generate-og.ts` which
satori-renders one PNG per surface to `public/og/<slug>.png`.
GitHub Pages CDN serves them; meta tags point at them via the
`BaseLayout` path → slug mapping.

User-generated cards (per observation, per profile): rendered
client-side at sync time via `src/lib/og-card.ts` (lazy-imported
satori → SVG → OffscreenCanvas → PNG) and PUT to R2 at
`og/<obs-id>.png` / `og/u/<username>.png` next to the photos.
Cloudflare CDN serves them; no per-request compute, no Edge Worker
to maintain.

Manifest carries `screenshots` (1280×720 + 750×1334) so Chrome
shows the richer install UI. `related_applications` + the
`isPwaInstalled()` helper combine display-mode + a localStorage memo
+ `getInstalledRelatedApps()` to suppress the install banner across
browser-tab visits, not just inside the standalone session.

---

## Social graph (Module 26)

Asymmetric-follow social layer added in v1.2. Composes against the
existing privacy mechanics — no parallel `visibility` enum on
observations.

**Tables (all RLS-enabled):**
- `follows(follower_id, followee_id, tier ∈ {follower,collaborator}, status ∈ {pending,accepted}, requested_at, accepted_at)`
- `observation_reactions(user_id, observation_id, kind, …)` — kinds
  `fave`/`agree_id`/`needs_id`/`confirm_id`/`helpful`
- `photo_reactions(user_id, media_file_id, kind, …)` — kinds `fave`/`helpful`
- `identification_reactions(user_id, identification_id, kind, …)` —
  kinds `agree_id`/`disagree_id`/`helpful`
- `blocks(blocker_id, blocked_id)` — read-symmetric: hide rows in
  both directions
- `reports(reporter_id, target_type, target_id, reason, note, status)`
- `notifications(user_id, kind, payload jsonb, read_at, created_at)` —
  pruned daily by `pg_cron` at 04:30 UTC for `read_at < now() - 90 days`

**Counter columns** (denormalised, trigger-maintained):
`users.follower_count` / `users.following_count`. Updated by
`tg_follows_counter` only when `status='accepted'` is gained or lost.

**Privacy helpers** (STABLE SQL, inlined into RLS predicates):
- `social_visible_to(viewer, owner)` — owner-or-accepted-follower
- `is_collaborator_of(viewer, owner)` — accepted collaborator-tier
  follower; gives the same coord-precision unlock on obscured obs that
  `is_credentialed_researcher` does

**Edge Functions** (deployed via auto-deploy on push to `main`):
- `follow` — request/accept/reject + collaborator-tier upgrades; rate
  limits 30 follows/hr, 5 collab requests/day
- `react` — idempotent (target, kind) toggle on the per-target tables;
  rate limit 200/hr
- `report` — inserts into `reports`, best-effort operator email via
  Resend; rate limit 10/day

**Fan-out triggers** (skip blocked recipients before insert):
- `tg_follow_notify` on `follows` insert/update → `notifications`
  (kinds `follow` / `follow_accepted`)
- `tg_obsreact_notify` on `observation_reactions` insert →
  `notifications` (kind `reaction`)

**RLS pattern for reactions** (illustrative):

```
reaction is readable
  iff observation is readable
       AND not block-symmetric to viewer.

observation is readable
  iff o.observer_id = auth.uid()
       OR (o.obscure_level <> 'full'
           AND can_see_facet(o.observer_id, 'observations', auth.uid()))
       OR is_collaborator_of(auth.uid(), o.observer_id)
```

**UI surfaces (chrome integration in v1.2):**
- Header bell → `/inbox` ↔ `/bandeja` with unread badge
- Public profile: follower / following pills + overflow ⋮ menu (Block /
  Report)
- `/share/obs/` observation viewer: interactive `ReactionStrip` + Report
  button next to Follow / Share
- Settings → Privacy: blocked users list

Full spec + plan: [`docs/superpowers/specs/2026-04-28-social-features-design.md`](superpowers/specs/2026-04-28-social-features-design.md), [`docs/superpowers/plans/2026-04-28-m26-social-graph.md`](superpowers/plans/2026-04-28-m26-social-graph.md).

---

## Community discovery (Module 28, v1.2 shipped 2026-04-29)

Adds a Community surface to the Explore MegaMenu — Observers / Top / Nearby /
Experts by taxon / By country — backed by denormalized counters refreshed
nightly into 6 new `users` columns (`species_count`, `obs_count_7d`,
`obs_count_30d`, `centroid_geog`, `country_code`, `hide_from_leaderboards`).
Walks back the shipped "no leaderboards" stance with explicit, granular
consent. Privacy gate at the SQL layer via two views with the same
eligibility predicate (`profile_public AND NOT hide_from_leaderboards`):
`community_observers` (anon-safe, no centroid) and
`community_observers_with_centroid` (authenticated only — Nearby's UI
sign-in requirement is mirrored at the data layer).

The nightly `recompute-user-stats` Edge Function (08:00 UTC) calls a
`SECURITY DEFINER` SQL wrapper because supabase-js can't run multi-statement
CTE+UPDATE. Country backfill uses `normalize_country_code(region_primary)`
with `pg_trgm` fuzzy matching against an in-DB ISO-3166 reference table;
`country_code_source = 'auto'|'user'` distinguishes inferred values from
user-set ones so Profile → Edit can show an "inferred from your region"
badge.

Full spec + plan: [`docs/superpowers/specs/2026-04-29-community-discovery-design.md`](superpowers/specs/2026-04-29-community-discovery-design.md),
[`docs/superpowers/plans/2026-04-29-community-discovery-plan.md`](superpowers/plans/2026-04-29-community-discovery-plan.md).
Operator runbook: [`docs/runbooks/community-discovery.md`](runbooks/community-discovery.md).

---

## Observation detail page redesign (M03 viewer + owner edit, v1.2 shipped 2026-04-29)

`/share/obs/?id=<uuid>` rebuilt as a two-column desktop / stacked mobile
layout. Three reusable components extracted: `MapPicker.astro` (mode='view'|'edit',
per-instance HTML IDs, modal a11y preserved), `PhotoGallery.astro` (native
lightbox — keyboard ←/→/Esc + swipe + per-photo share + dynamic "Photo N of M"
aria-labels), and `ShareObsView.astro` (the new layout body, with all
view-side strings under `obs_detail.view.*` i18n).

Material-edit semantics: a BEFORE UPDATE trigger on `observations` flags
`last_material_edit_at` when location moves > 1 km (PostGIS `ST_Distance`),
`observed_at` moves > 24 h, or `primary_taxon_id` changes (propagated from
`identifications` by the existing `sync_primary_id_trigger`). The "Edited
after IDs" badge in the community-IDs section is shown only when both
`last_material_edit_at IS NOT NULL` and at least one community ID exists.

Photo deletion is always atomic via the `delete-photo` Edge Function (PR6 of
the redesign): soft-delete (`media_files.deleted_at = now()`) + ID demote
(`validated_by`/`validated_at`/`is_research_grade` cleared) + `last_material_edit_at`
bump in one transaction. R2 blobs are left as orphans for v1; the
`gc-orphan-media` cron is a v1.1 follow-up.

Full spec + plan: [`docs/superpowers/specs/2026-04-29-obs-detail-redesign-design.md`](superpowers/specs/2026-04-29-obs-detail-redesign-design.md),
[`docs/superpowers/plans/2026-04-29-obs-detail-redesign-plan.md`](superpowers/plans/2026-04-29-obs-detail-redesign-plan.md).
Operator runbook: [`docs/runbooks/obs-detail-redesign.md`](runbooks/obs-detail-redesign.md).

---

## Projects + research workflow (M29 / M30 / M31, v1.2 shipped 2026-04-30)

A polygon-anchored monitoring stack for ANP / DRFSIPS / PROREST 2026 use:

```
                          ┌──────────────────────────┐
                          │  projects                │
                          │   (geography MultiPolygon)│
                          │   visibility, owner,     │
                          │   bilingual name + desc  │
                          └─────────┬────────────────┘
                                    │ FK + auto-tag trigger
                  ┌─────────────────┼──────────────────────┐
                  │                 │                      │
                  ▼                 ▼                      ▼
       ┌──────────────────┐  ┌──────────────────┐  ┌────────────────────┐
       │  observations    │  │  camera_stations │  │  CLI batch import  │
       │    project_id    │  │    project_id +  │  │   (cli/, M30)      │
       │    camera_       │  │    station_key   │  │                    │
       │    station_id    │  │    (UNIQUE per   │  │  walks SD card →   │
       │                  │  │    project)      │  │  /api/upload-url → │
       └──────────────────┘  └──────────────────┘  │  /api/observe      │
                                                   └────────────────────┘
```

- **Auto-tagging**: `assign_observation_to_project_trigger` runs `BEFORE
  INSERT OR UPDATE OF location` on `observations`; if `project_id` is null
  and a location is set, it picks the first project (by `created_at ASC`)
  whose polygon `ST_Covers` the point.
- **Geography writes** go through `upsert_project()` SECURITY DEFINER —
  PostgREST has no WKB encoder for the `geography(MultiPolygon, 4326)`
  column, so the client posts GeoJSON to the RPC.
- **Trap-night counts** for camera stations come from
  `station_trap_nights(station_id, p_from, p_to)` SQL function. NULL
  `end_date` is counted up to `current_date` (or `p_to`).
- **CLI** (`cli/`) is a separate Node 20+ TypeScript package with its own
  `package.json` so the PWA never picks up Node-only deps; it uses
  `rst_*` API tokens against `POST /api/upload-url` (added in M30) for
  batch upload of camera-trap photos.

Specs: [`docs/specs/modules/29-projects-anp.md`](specs/modules/29-projects-anp.md),
[`docs/specs/modules/30-cli-batch-import.md`](specs/modules/30-cli-batch-import.md),
[`docs/specs/modules/31-camera-stations.md`](specs/modules/31-camera-stations.md).
Runbooks: [`projects-anp.md`](runbooks/projects-anp.md),
[`cli-batch-import.md`](runbooks/cli-batch-import.md),
[`camera-stations.md`](runbooks/camera-stations.md).

---

## Multi-provider vision + platform pool (M32, v1.2 shipped 2026-04-30)

The original cascade in `identify/index.ts` called `api.anthropic.com`
directly with a hard-coded model. M32 replaces that with a `VisionProvider`
abstraction so the same call site can route through any of six providers,
plus adds a platform-wide call pool that sponsors donate to.

```
                ┌─────────────────────┐
   image bytes  │  identify/index.ts  │
   ──────────► │   parallel cascade   │
                │   ─────────────────  │
                │   PlantNet runner    │
                │   Vision runner ────┤
                │   ONNX (placeholder) │
                └──────────┬───────────┘
                           │ resolve credential:
                           │   1. BYO key (client_keys)
                           │   2. Personal sponsorship
                           │   3. consume_pool_slot() ─┐ FOR UPDATE SKIP LOCKED
                           │   4. skip                  │ atomic per-user cap
                           ▼                            │
              ┌─────────────────────────────┐           │
              │  buildProvider(credential)  │           │
              ├─────────────────────────────┤           │
              │ AnthropicProvider           │           │
              │ BedrockProvider (Sig V4)    │           │
              │ OpenAIProvider              │           │
              │ AzureOpenAIProvider         │           │
              │ GeminiProvider              │           │
              │ VertexAIProvider            │           │
              └─────────────────────────────┘           │
                                                        ▼
                                              ┌──────────────────┐
                                              │  sponsor_pools   │
                                              │  pool_consumption│
                                              │  (atomic ledger) │
                                              └──────────────────┘
```

- **`buildProvider()` exhaustive switch** — adding a new
  `CredentialKind` without updating the dispatcher fails the
  TypeScript build via the `never`-typed default case.
- **Bedrock Sig V4 hand-rolled** (~70 LOC) instead of bundling
  `@aws-sdk/client-bedrock-runtime` (~3 MB) into the EF.
- **`bedrockModelId(model)` translation** — the column default
  `claude-haiku-4-5` (Anthropic shorthand) auto-converts to
  `us.anthropic.claude-haiku-4-5-v1:0` so a Bedrock credential
  configured without an explicit Bedrock model still works.
- **Pool privacy**: `pool_consumption (user_id, day, count)` is
  service-role-write / self-read. No RPC joins it to `auth.users`;
  sponsors see only aggregate stats.

UI for credential creation + pool donation lands in v1.1; until
then, register credentials via Supabase Vault + SQL.

Spec: [`docs/specs/modules/32-multi-provider-vision.md`](specs/modules/32-multi-provider-vision.md).
Runbooks: [`multi-provider-vision.md`](runbooks/multi-provider-vision.md),
[`sponsor-pools.md`](runbooks/sponsor-pools.md).

---

## Karma + expertise + rarity (Module 23, v1.1 shipped)

Karma is a per-user reputation primitive used for ranking, badging, and
moderation weight. It's not a leaderboard surface — it's an input to
other modules' decisions:

- `compute_user_karma(uid)` SECURITY DEFINER returns a 0–1000 number
  derived from observation count, ID accuracy on community-validated
  records, validator track record, and rarity-weighted contributions.
- `users.karma_cache` is the denormalised hot-path column refreshed
  nightly by `recompute-karma` (cron 09:00 UTC).
- Phase 1 (foundation) is shipped — schema + recompute + cache. Phase 2
  (engagement bonuses) and Phase 3 (conservation bonuses) are tracked
  in `progress.json` as v1.1 follow-ups.

Spec: [`docs/specs/modules/23-karma-expertise-rarity.md`](specs/modules/23-karma-expertise-rarity.md).
Runbook: [`docs/runbooks/karma-phase-1-post-merge-verification.md`](runbooks/karma-phase-1-post-merge-verification.md).

---

## AI sponsorships (Module 27, v1.1 shipped — extended by M32)

Any user can share their Anthropic credential (API key OR long-lived
OAuth token) with a specific list of beneficiaries. The `identify`
Edge Function resolves the call in this order: BYO key → personal
sponsorship → platform pool → skip Claude (PlantNet-only). The original
operator-key fallback was removed in PR #78.

Three load-bearing rules:

1. **Credentials live in Supabase Vault**, never in `users` columns.
   `sponsor_credentials.vault_secret_id` is the FK; the Edge Function
   reads via `vault.read_secret()` SECURITY DEFINER wrapper.
2. **Caps are enforced atomically.** `consume_sponsor_slot()` SECURITY
   DEFINER uses `FOR UPDATE SKIP LOCKED` to claim a slot, increments
   `monthly_calls`, and flips `paused=true` when the cap is hit. Resend
   email fires at 80% and 100% thresholds.
3. **Heartbeat probes catch revoked credentials.** A daily cron pings
   each active credential with `max_tokens:1`; failures auto-pause the
   sponsorship and email the sponsor.

UI: `/profile/sponsoring/`, `/profile/sponsored-by/`, banner on
`/identify`, header dropdown entry, mobile drawer entry, sponsor +
reciprocal badges on public profile, request-to-be-sponsored flow
(5 endpoints + dialogs), abuse-report button per beneficiary.

Spec: [`docs/specs/modules/27-ai-sponsorships.md`](specs/modules/27-ai-sponsorships.md).
M32 (multi-provider vision + platform pool) is the natural extension —
see the section above.

---

## Further reading

- [`AGENTS.md`](../AGENTS.md) — conventions, pitfalls, pre-PR checklist.
- [`docs/specs/modules/00-index.md`](specs/modules/00-index.md) — module
  catalog with shipped status.
- [`docs/runbooks/00-index.md`](runbooks/00-index.md) — operator runbook
  index (admin console, research workflow, observation flow, ops hygiene).
- [`docs/specs/infra/supabase-schema.sql`](specs/infra/supabase-schema.sql)
  — the canonical schema. Apply with `make db-apply`.
- [`docs/gbif-ipt.md`](gbif-ipt.md) — GBIF publishing flow.
