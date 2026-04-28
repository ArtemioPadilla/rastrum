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

### 2. Photo identification — two cascade modes

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

## Further reading

- [`AGENTS.md`](../AGENTS.md) — conventions, pitfalls, pre-PR checklist.
- [`docs/specs/modules/00-index.md`](specs/modules/00-index.md) — module
  catalog with shipped status.
- [`docs/specs/infra/supabase-schema.sql`](specs/infra/supabase-schema.sql)
  — the canonical schema. Apply with `make db-apply`.
- [`docs/gbif-ipt.md`](gbif-ipt.md) — GBIF publishing flow.
