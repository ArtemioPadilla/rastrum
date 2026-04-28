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
    │ PlantNet → Claude Haiku → on-device fallbacks
    ▼
sync_primary_id_trigger (Postgres)
    │ denormalises obscure_level + location_obscured for RLS
    ▼
activity_events row (visible in /profile/ feed)
```

### 2. Photo identification — two cascade modes {#identifier-cascade}

The identification pipeline runs differently depending on where it's triggered. See [`docs/specs/modules/21-identify.md`](specs/modules/21-identify.md) for the full contract.

**Client-side (Identify page — `/en/identify/`):** PlantNet, Claude, and Phi-vision fire in parallel. The first provider to return a result above its confidence threshold wins and cancels the others. If all fail, Phi-vision prompts the user to opt in to the local model download.

**Server-side (sync.ts → `identify` Edge Function):** the classic serial waterfall via `cascade.ts`:

```
PlantNet API (cloud, when key present)
  ├─ score ≥ 0.7 → write identification, done
  └─ score < 0.7 → fallthrough
      Claude Haiku 4.5 (cloud, server key or BYO)
        ├─ confidence ≥ 0.4 → write, done
        └─ confidence < 0.4 → fallthrough
            EfficientNet-Lite0 ONNX (in-browser, base classifier)
              └─ Phi-3.5-vision (in-browser, last resort, capped at 0.35)
```

The serial cascade is deterministic by license cost: cloud first when keys are
present, on-device when they aren't. The `force_provider` knob bypasses
the waterfall for testing. All confidence < 0.4 results are blocked
from research-grade by the `enforce_research_grade_quality` trigger.

When offline at submit time, the outbox holds the row plus the binary;
the cascade is deferred. On `online` event or `visibilitychange` returning
to visible, `registerSyncTriggers()` runs `syncOutbox()`, which fires the
server-side waterfall via the `identify` Edge Function.

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

## Further reading

- [`AGENTS.md`](../AGENTS.md) — conventions, pitfalls, pre-PR checklist.
- [`docs/specs/modules/00-index.md`](specs/modules/00-index.md) — module
  catalog with shipped status.
- [`docs/specs/infra/supabase-schema.sql`](specs/infra/supabase-schema.sql)
  — the canonical schema. Apply with `make db-apply`.
- [`docs/gbif-ipt.md`](gbif-ipt.md) — GBIF publishing flow.
