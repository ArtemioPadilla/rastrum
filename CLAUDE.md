# AGENTS.md

> Briefing for AI coding agents (Claude Code, Copilot, Cursor, Codex, …)
> working in this repo. Read this before making changes.
>
> **Last full doc sync:** 2026-04-30 (v1.2 — research workflow M29/M30/M31, multi-provider vision + pool M32).

---

## What this is

**Rastrum** is an open-source biodiversity observation PWA targeting Latin
America. Astro + Tailwind frontend, Supabase backend (Postgres + PostGIS +
RLS), Cloudflare R2 for media, Edge Functions (Deno) for AI identification.
Bilingual EN/ES from day one.

- **Public site:** https://rastrum.org
- **Repo:** https://github.com/ArtemioPadilla/rastrum
- **License:** MIT (code), AGPL-3.0 (server per README), per-observation CC
  (BY / BY-NC / CC0)

---

## Project orientation (in priority order)

| Read first | Why |
|---|---|
| [`docs/progress.json`](docs/progress.json)              | Source of truth for the roadmap. Bilingual labels (`_es` suffix). |
| [`docs/tasks.json`](docs/tasks.json) + [`docs/tasks.md`](docs/tasks.md) | Per-roadmap-item subtask breakdown. Check current status before starting work. |
| [`docs/specs/modules/00-index.md`](docs/specs/modules/00-index.md) | Catalog of ~29 module specs. Each module has its own design doc. |
| [`docs/architecture.md`](docs/architecture.md)            | High-level architecture diagram + critical-path flows. |
| [`docs/specs/infra/supabase-schema.sql`](docs/specs/infra/supabase-schema.sql) | Idempotent SQL — apply with `make db-apply`. |
| `Makefile`                                                | Run `make help` to see every dev workflow. |

---

## Quick commands

```bash
make help                     # list every target with descriptions
make install                  # npm ci
make dev                      # astro dev — http://localhost:4321
make build                    # static build into dist/
make test                     # vitest run (~465 tests today)
make typecheck                # tsc --noEmit
make db-apply                 # apply supabase-schema.sql (idempotent)
make db-verify                # show tables, RLS, triggers, extensions
make db-seed-badges           # seed 39-badge catalogue
make db-cron-schedule         # apply pg_cron schedules
make db-cron-test             # fire both cron jobs once + show responses
make db-psql                  # interactive psql shell
```

Edge Function deploys go through CI (the local `supabase` CLI 2.90.0
is broken on this project's config). **As of PR #62 this is automatic**
on push to `main` when any file under `supabase/functions/**` changes —
the workflow detects the changed function set via `git diff` and only
redeploys those (mirrors the `db-apply.yml` symmetry). The workflow's
"all functions" list is derived from `ls supabase/functions/` at
runtime so it can't drift from disk.

Manual dispatch is still available for surgical rollback / redeploy /
secrets resync:

```bash
gh workflow run deploy-functions.yml --ref main \
  -f function=identify       # or all / follow / react / report / etc.
gh run watch <run-id>
```

---

## Architecture cheatsheet

```
src/
├── components/             Astro components — both pages + shared widgets
│   ├── *View.astro         Shared per-feature views (RoadmapView, TasksView,
│   │                       ProfileView, ExploreMap, ExportView, …)
│   ├── *Form.astro         Forms (ObservationForm, ProfileEditForm, SignInForm)
│   ├── Header.astro        Verb-first chrome (Observe/Explore ▾/Chat | About/Docs ▾)
│   ├── MegaMenu.astro      3-col dropdown shell, used by Docs ▾
│   ├── MobileBottomBar.astro 5-slot bottom bar with center camera FAB (signed-in)
│   └── MobileDrawer.astro  Right-side hamburger overlay (mobile only)
├── i18n/{en,es}.json       Translations. ANY new UI string lives here.
├── i18n/utils.ts           t(lang) helper, routes + routeTree, docPages list.
├── layouts/                BaseLayout (PWA, theme, SW reg) + DocLayout (sidebar)
├── lib/
│   ├── chrome-mode.ts      resolveChromeMode(path) → 'app' | 'read'
│   ├── chrome-helpers.ts   getFabTarget, isActiveSection
│   ├── supabase.ts         Singleton supabase-js client
│   ├── auth.ts             Magic link, OAuth, OTP, passkey, signOut
│   ├── byo-keys.ts         Per-plugin user-supplied API keys (localStorage)
│   ├── db.ts               Dexie IndexedDB outbox (RastrumDB)
│   ├── sync.ts             Outbox → R2 → Supabase + cascade engine
│   ├── upload.ts           R2 (preferred) / Supabase Storage upload helper
│   ├── local-ai.ts         WebLLM (Phi-3.5-vision, Llama-3.2-1B)
│   ├── darwin-core.ts      DwC mapping (CSV + SNIB + CONANP presets)
│   ├── identifiers/        Plugin platform — see `13-identifier-registry.md`
│   │   ├── types.ts        Identifier interface + KeySpec + IdentifyInput
│   │   ├── registry.ts     Singleton registry (collision-detected)
│   │   ├── cascade.ts      runCascade() — license-cost-sorted waterfall
│   │   ├── index.ts        bootstrapIdentifiers() registers built-ins
│   │   └── *.ts            One file per plugin
│   └── types.ts            ObserverRef, Observation, MediaFile, …
├── pages/{en,es}/          Locale-paired routes. /en/observe ↔ /es/observar;
│                           explore subroutes: /explore/{recent,watchlist,species}
├── pages/auth/callback.astro  Language-neutral OAuth/PKCE landing page
├── pages/share/obs/        Public OG-card observation viewer
└── env.d.ts                Typed import.meta.env

supabase/
├── functions/<name>/index.ts    Deno Edge Functions (deploy via CI)
│   ├── identify              Photo cascade entry point
│   ├── enrich-environment    Lunar phase + OpenMeteo backfill
│   ├── recompute-streaks     Nightly cron
│   ├── award-badges          Nightly cron
│   ├── share-card            Public OG card renderer
│   ├── get-upload-url        R2 presigned upload URLs
│   ├── export-dwca           Darwin Core Archive ZIP
│   ├── api                   REST API (rst_* token auth)
│   └── mcp                   MCP server for AI agents (rst_* token auth, JSON-RPC over HTTP)
└── config.toml             Local CLI config (deploy via CI, not local)

cli/                            M30 — batch import CLI for camera-trap memory cards
├── bin/rastrum-import.js   Node entry point (loads compiled dist/cli.js)
├── src/cli.ts              Orchestrator + parseArgs (pure helper, unit-tested)
├── src/walker.ts           Recursive async-generator file walker
├── src/exif.ts             exifr wrapper, parity with PWA's fillFromExif
├── src/api-client.ts       /api/upload-url + /api/observe + /api/identify client
├── src/log.ts              Resumable import-log.json
└── test/                   Node native test runner (--import tsx --test)

docs/
├── progress.json           Roadmap (60+ items, bilingual labels)
├── tasks.json              Per-item subtask breakdown (rendered at /docs/tasks/)
├── tasks.md                Phase summary (regenerated from tasks.json)
├── architecture.md         High-level architecture + critical-path flows
├── gbif-ipt.md             Operator notes for GBIF IPT publishing
├── runbooks/               Operator playbooks per module (M29 projects, M30 CLI,
│                           M31 camera stations, M32 multi-provider + pools, …)
└── specs/
    ├── infra/              SQL schema, cron, testing, future migrations, CI yml
    └── modules/            32+ module specs + 00-index.md (see numbering note)
```

---

## Conventions

### Code style
- **TypeScript strict mode.** `any` is a smell; prefer `unknown` + narrowing.
- **Default to no comments.** Only add a comment when *why* is non-obvious.
  Never explain what the code does — well-named identifiers do that.
- **No emoji in code or commits unless asked.** UI emoji are fine when
  intentional (icons, brand marks).
- **No `console.log` in shipped code.** `console.warn` for genuinely
  exceptional ignored errors only.
- **Below-fold images use `loading="lazy"`.** The hero / first-paint image stays default-loaded for LCP; everything below the fold (doc screenshots, observation thumbnails, profile avatars in lists) gets `loading="lazy"`.

### Astro JSX gotcha — `Record<…>` is parsed as a tag
Inline TypeScript casts like `(foo as Record<string, unknown>).bar` inside
JSX expressions get parsed as opening tags by Astro's esbuild integration.
**Always extract these casts to typed local variables in the frontmatter:**

```astro
---
// ✓ Good — cast in frontmatter
const map = data as unknown as Record<string, MyShape>;
const item = map[key];
---
<div>{item.label}</div>
```

```astro
<!-- ✗ Bad — build error -->
<div>{(data as Record<string, MyShape>)[key].label}</div>
```

### EN/ES parity is a hard rule
- Every public-facing string lives in `src/i18n/en.json` AND `src/i18n/es.json`.
- Doc pages (`/{en,es}/docs/*`) must be **structurally identical** —
  enforce by extracting the body into a shared `*View.astro` component.
- The `_es` suffix pattern in `progress.json` and `tasks.json` provides
  per-record translation; the `loc()` helper in views picks the right one.
- New routes get a slug pair: `routes.signIn = { en: '/sign-in', es: '/ingresar' }`.

### Idempotent everything
- SQL: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS … ; CREATE POLICY …`,
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- Seed data: `INSERT … ON CONFLICT (key) DO UPDATE SET …`.
- Cron schedules: `cron.unschedule()` then `cron.schedule()` by name.
- Migrations: replay-safe so `make db-apply` is callable any time.

### RLS and privacy invariants
- **Every public table has RLS enabled.** No exceptions.
- **`obs_public_read`** depends on the denormalised `obscure_level` +
  `location_obscured` columns on `observations` — kept in sync by the
  `sync_primary_id_trigger` whenever the primary identification changes.
- **BYO API keys** (`localStorage[rastrum.byoKeys]`) are forwarded
  per-call to the Edge Function as `client_keys.<provider>`. Never
  persisted server-side, never logged.
- **Sensitive species** (NOM-059 / CITES) use the `obscure_level` enum
  to coarsen public coordinates; precise coords only readable by the
  observer or a credentialed researcher.

### Module spec convention
- Implementation specs live at `docs/specs/modules/NN-*.md`, numbered
  sequentially. **The module spec wins** when it disagrees with
  `rastrum-v1.md` (the older monolithic spec, now vision-only).
- New modules: claim the next `NN-*.md`, register in
  `modules/00-index.md`, link from any consuming module.

### Identifier plugin contract
Adding a new model/service for species ID is a 3-step recipe:
1. Write `src/lib/identifiers/<plugin>.ts` exporting an `Identifier`.
2. `import` + `register()` in `src/lib/identifiers/index.ts`.
3. (Server-side only) extend the Edge Function's `force_provider` switch.
The registry has runtime collision detection on `id`. See
`docs/specs/modules/13-identifier-registry.md` for the full contract.

### Chrome / IA conventions

The app chrome is verb-first. Three action items on the left of the header
— **Observe**, **Explore ▾** (dropdown), **Chat** — and a reference cluster
on the right — **About**, **Docs ▾**. Identify is hub-spoke off the home
hero and is intentionally absent from persistent nav.

Mobile uses a bottom bar (`MobileBottomBar.astro`) with a center camera FAB;
when the user is on `/observe`, the FAB shifts to `/identify` with a
"⚡ Quick ID" badge. A right-side drawer (`MobileDrawer.astro`) handles
reference links, account, and preferences.

Per-section accent rail: Observe = emerald (brand), Explore = teal, Chat =
sky, About/Docs = stone. The dynamic `railClass()` helper in `Header.astro`
builds these class names at runtime, so they must be **SAFELISTED** in
`tailwind.config.mjs`. Adding a new top-level section with its own accent
colour requires extending that safelist or the classes will be purged in
production builds.

Full design rationale: `docs/superpowers/specs/2026-04-26-ux-revamp-design.md`.

### Social surfaces (M26)

The header bell (`BellIcon.astro`) is the entry to the social inbox at
`/{en,es}/{inbox,bandeja}/`. It polls `notifications` every 60s while
visible, uses `getSession()` (no server round-trip) to decide whether
to render itself, and shows a numeric badge capped at "9+". The legacy
m08 watchlist activity remains accessible from the profile page; a
unified inbox is a v1.1 follow-up.

Reports use `ReportDialog.astro` — a single global modal mounted in
`BaseLayout.astro`. Other surfaces open it by setting
`#rastrum-report-dialog` dataset (`target` / `targetId` /
`targetLabel`) and removing `.hidden`. Submit calls `reportTarget()`
from `src/lib/social.ts`. The dialog has a focus trap, restores
previous focus on close, and closes on Esc / backdrop click.

Public profile (`PublicProfileViewV2.astro`) renders follower/following
pills under the bio and an overflow ⋮ menu (Block + Report) for non-self
signed-in viewers. Block uses `confirm()` for v1; Report opens
`ReportDialog`. The follower/following pages live at
`/{en,es}/{profile,perfil}/u/{followers,following | seguidores,siguiendo}/`.

`FollowButton.astro` calls the `follow` Edge Function via
`followUser()` / `unfollowUser()` from `src/lib/social.ts` so
rate-limits and profile-privacy gating fire server-side. It paints
4 states: `signin` / `follow` / `following` / `requested` (amber
pill for follows in `pending` against private profiles).

`ReactionStrip.astro` is self-hydrating: it queries the relevant
`<target>_reactions` table on mount and listens for the
`rastrum:reactions-ready` event so dynamic surfaces (e.g.
`/share/obs/`) can set `data-reaction-target-id` after the
observation loads. Wired interactive on `/share/obs/`; feed-card
overlays are a v1.1 follow-up gated on an aggregate RPC to avoid
N+1 fetches.

i18n: m26 strings live under the `socialgraph.*` namespace —
`social.*` was already taken by the m08 flat namespace consumed by
six shipping components, so we added a parallel namespace rather than
rewriting consumers.

Full design rationale: `docs/superpowers/specs/2026-04-28-social-features-design.md`.

### Console / privileged surfaces

The `'console'` chrome mode (third value of `ChromeMode`) renders the
admin / moderator / expert dashboard at `/{en,es}/{console,consola}/*`.
Three load-bearing rules:

1. **`console-tabs.ts` is the single source of truth.** Sidebar, role
   pills, and the route table are pure projections. Adding a tab = one
   entry. Never hand-roll a route or a sidebar item.
2. **Every privileged write goes through `supabase/functions/admin/`.**
   The dispatcher re-verifies the JWT, enforces the action's required
   role, runs the handler, and inserts an `admin_audit` row in the same
   logical commit. No direct browser-side writes to privileged tables.
3. **`has_role(uid, role)` is the RLS predicate.** Don't check
   `users.is_expert` for new privilege checks — that's a denormalised
   cache for the consensus hot-path. Use `has_role()` in any new
   policy that gates console-relevant data.

The `console` accent rail uses slate-500 (top header pill, sidebar active
state). The classes are safelisted in `tailwind.config.mjs`; adding a
new console-related accent class requires extending the safelist or
production builds will purge it.

Bootstrap docs: `docs/runbooks/admin-bootstrap.md`. Role model:
`docs/runbooks/role-model.md`. Audit log: `docs/runbooks/admin-audit.md`.
Per-action runbook: `docs/runbooks/admin-ops.md`.

**Status:** 36 of 39 console tabs functional, 36 admin Edge Function handlers deployed, all admin write affordances live, CORS tightened to rastrum.org + dev/preview ports, token-bucket rate limit + pgTAP RLS suite enforced in CI. PR12 (observability) added Anomalies + Forensics tabs backed by hourly `detect_admin_anomalies()` cron, weekly `compute_admin_health_digest()` snapshot, and a structured `function_errors` sink wired into the dispatcher. PR13 (future-proofing) added Proposals + Webhooks tabs, time-bounded role grants (`expires_at` + daily `auto_revoke_expired_roles()` cron), a two-person-rule `admin_action_proposals` table with hourly expiry sweep, HMAC-SHA256 outbound webhook signing (`dispatch_admin_webhooks()`), and a v1 placeholder `compute_moderator_trust_score()` primitive. PR14 (deferred cleanup) closed the v1.1 follow-ups: per-admin timezone for the off_hours rule (`users.timezone`), webhook replay protection (`_meta` envelope + nonce + reconcile cron writing back async `pg_net` status_code), the real moderator trust score formula (anomaly + overturn + active-days + recency, clamped 0–100), the dispatcher-level `enforce_two_person_irreversible` enforcement gate (feature flag-gated), and the "Require approval (two-person rule)" toggle on irreversible slide-overs. PR15 (observability UI) shipped `/console/health/` (weekly-digest hero card with directional Δ pills + 12-week sparklines, manual `health.recompute`), `/console/errors/` (function_errors browser with severity-coloured pills + URL-driven filters + auto-refresh + single + bulk ack via `error.acknowledge[_bulk]`), and per-webhook deliveries drilldown on `/console/webhooks/` with click-to-replay (`webhook.replay_delivery`) + nonce copy. PR16 (entity browsers) shipped seven read-only paginated browsers — Identifications, Notifications, Media, Follows, Watchlists, Projects, Taxon changes — built on a shared `ConsoleEntityBrowser.astro` template + `src/lib/entity-browser.ts` runtime. Server-side paginated (50/page), URL-driven filter state, lazy FK lookups, auto-populated dropdown facets; runbook at `docs/runbooks/admin-entity-browsers.md`. Deferred stubs (no concrete users): License disputes, Identification overrides, Taxon notes, Bioblitz.

### Onboarding events + CI smoke

The onboarding tour exposes two public DOM events:
- **`rastrum:replay-onboarding`** (consumer → tour) re-opens the modal
  and resets the `localStorage.rastrum.onboardingV2` flag. Wired from
  Profile → Edit's "Replay tour" button.
- **`rastrum:onboarding-event`** (tour → consumer) fires at every state
  change with `{type, step, …}`. No analytics provider is wired by
  default — operators attach a listener in `BaseLayout.astro` to send
  to whatever backend they want.

`src/lib/anthropic-key.ts` exports `validateAnthropicKey()` for any UI
that takes an Anthropic key — it's a `max_tokens:1` probe that costs
≈ nothing per call. Reuse it before persisting any BYO key.

Full notes: [`docs/runbooks/onboarding-events.md`](docs/runbooks/onboarding-events.md).

CI runs **`infra/smoke-model-assets.sh`** after every deploy and during
the nightly smoke run. It curls every operator-configured `PUBLIC_*_URL`
(BirdNET, EfficientNet, pmtiles MX, MegaDetector) and asserts HTTP 200
+ `access-control-allow-origin` + a sane minimum content-length.
Failure modes + fixes in [`docs/runbooks/ci-smoke-checks.md`](docs/runbooks/ci-smoke-checks.md).

### Community discovery (M28)

The Explore MegaMenu is split into two columns: **Biodiversity** (the
existing flat dropdown — Map / Recent / Watchlist / Species / Validate)
and **Community** (Observers / Top / Nearby / Experts by taxon / By
country). All Community items land on `/{en,es}/{community,comunidad}/observers/`
with composable filter chips; the MegaMenu items just preset different
URL params.

Three load-bearing rules:

1. **Privacy gate at the SQL layer.** Two views with the same
   eligibility predicate (`profile_public AND NOT hide_from_leaderboards`):
   `community_observers` (anon + authenticated, no centroid) and
   `community_observers_with_centroid` (authenticated only, includes
   centroid). The lack of `GRANT TO anon` on the centroid view is the
   security gate — Nearby's UI sign-in requirement is mirrored at the
   data layer.
2. **`recompute-user-stats` cron writes via `SECURITY DEFINER` wrapper.**
   `public.recompute_user_stats()` is `REVOKE ALL FROM PUBLIC` +
   `GRANT EXECUTE TO service_role`. The cron-only Edge Function
   (`--no-verify-jwt`, runs nightly 08:00 UTC) calls it via
   `db.rpc('recompute_user_stats')`. Don't try to run the multi-statement
   CTE+UPDATE directly from supabase-js — PostgREST won't accept it.
3. **`country_code_source` distinguishes user-set from inferred.** The
   cron sets `country_code` from `region_primary` only when NULL;
   Profile → Edit save flips `country_code_source` to `'user'`. Badge
   shows in the picker when `source='auto' AND country_code IS NOT NULL`.
4. **GPS coords for "Use my location" Nearby live in `sessionStorage`
   only — NEVER the URL querystring.** Putting them in `?lat=…&lng=…`
   would leak via the `Referer` header and the browser's history. The
   storage key is `rastrum.community.gps`; cleared on tab close. The
   `community_observers_nearby_at(lat, lng, …)` RPC takes coords
   per-call, never persisting server-side. Regression guard:
   `tests/unit/community-url.test.ts` asserts the serializer drops
   any `lat`/`lng`/`gps` keys.

Cron + manual fire: [`docs/runbooks/community-discovery.md`](docs/runbooks/community-discovery.md).

### Observation detail page (M03 redesign)

`/share/obs/?id=<uuid>` was rebuilt as a two-column desktop / stacked
mobile layout. Three reusable components fell out:

1. **`MapPicker.astro`** — `mode='view'|'edit'`, `pickerId` per instance
   (HTML IDs are suffixed `-${pickerId}` so multiple instances coexist).
   Consumed by `ObservationForm.astro` (edit), `ShareObsView.astro` (view),
   and `ObsManagePanel.Location` (edit; PR5).
2. **`PhotoGallery.astro`** — native lightbox (~106 lines: keyboard ←/→/Esc
   + swipe + per-photo share + `canShare` probe + dynamic "Photo N of M"
   aria-labels). `mode='owner'` renders a delete button per photo whose
   onClick dispatches `rastrum:photogallery-delete`; PR6's `delete-photo`
   Edge Function wires the handler.
3. **`ShareObsView.astro`** — extracted from `share/obs/index.astro`
   (slimmed from 524 → ~15 LOC wrapper). All view-side strings under
   `obs_detail.view.*` i18n.

Material-edit semantics: a BEFORE UPDATE trigger on `observations` flags
`last_material_edit_at` when `ST_Distance(NEW.location, OLD.location) > 1000`
(1 km), `observed_at` moves > 24 h, or `primary_taxon_id` changes
(propagated by the existing `sync_primary_id_trigger` on `identifications`
that cascades into `observations.primary_taxon_id`). The "Edited after IDs"
badge in the community-IDs section is shown only when both
`last_material_edit_at IS NOT NULL` and at least one community ID exists.

Photo deletion is **always atomic via the `delete-photo` Edge Function**
(PR6): soft-delete + ID demote (`validated_by`/`validated_at`/`is_research_grade`
all nulled/false) + `last_material_edit_at` bump in one transaction.
Client-side two-call has a real race window. R2 blobs are left as
orphans for v1; `gc-orphan-media` cron is a v1.1 follow-up.

Full notes: [`docs/runbooks/obs-detail-redesign.md`](docs/runbooks/obs-detail-redesign.md).

### Projects (M29)

A *project* is a named polygon (typically an ANP or sampling grid)
under `/{en,es}/projects/`. Three load-bearing rules:

1. **Polygon is the routing key.** `assign_observation_to_project_trigger`
   runs `BEFORE INSERT OR UPDATE OF location` on `observations` —
   if `project_id IS NULL` and a location is set, the trigger picks
   the first project (by `created_at ASC`) whose polygon `ST_Covers`
   the point. Manual assignments via direct UPDATE are honoured.
2. **Geography writes go through `upsert_project()` SECURITY
   DEFINER**, not direct `INSERT INTO projects`. PostgREST has no
   WKB encoder for the `geography(MultiPolygon, 4326)` column, so
   the client posts GeoJSON to the RPC which parses + enforces
   `owner_user_id = auth.uid()`.
3. **Reads use `projects_with_geojson` view (SECURITY INVOKER).** RLS
   on the underlying table gates rows by visibility (`public` →
   anon; `private` → owner + members). Don't `SELECT polygon`
   directly from `projects` — base64 WKB is what comes back.

Spec: [`docs/specs/modules/29-projects-anp.md`](docs/specs/modules/29-projects-anp.md).
Runbook: [`docs/runbooks/projects-anp.md`](docs/runbooks/projects-anp.md).

### CLI batch import (M30)

Lives at [`cli/`](cli/) — a separate Node 20+ TypeScript package
with its own `package.json` so the PWA bundle never picks up
Node-only deps (`exifr`, AWS SDK). The CLI authenticates with an
`rst_*` token (scope: `observe`) against the `/api/upload-url` and
`/api/observe` endpoints in the existing `api` Edge Function.

Two contracts that must stay aligned:

1. **EXIF parsing parity with the PWA** — `cli/src/exif.ts` mirrors
   `ObservationForm.fillFromExif()` for property-name fallback
   (`latitude` / `Latitude` / `GPSLatitude`) and the (0,0)
   null-island rejection.
2. **Project auto-tagging happens server-side** via M29's trigger.
   The CLI doesn't pass `--project-slug`; observations whose EXIF
   GPS lands in a project polygon are tagged automatically.

Spec: [`docs/specs/modules/30-cli-batch-import.md`](docs/specs/modules/30-cli-batch-import.md).
Runbook: [`docs/runbooks/cli-batch-import.md`](docs/runbooks/cli-batch-import.md).

### Camera stations (M31)

Schema-only in v1 — a `camera_station` is a fixed deployment with
one or more `camera_station_periods` (start/end dates). Standardised
indices like RAI / detection-rate-per-100-trap-nights need to know
*how long the camera was sampling*, not just *what it captured*.

- Station uniqueness is **per project** (`UNIQUE(project_id,
  station_key)`), so two projects can both have a `SJ-CAM-01`.
- Station assignment to observations stays **explicit**
  (`observations.camera_station_id`); two stations within one
  polygon need different trap-night counts so the polygon trigger
  doesn't auto-fill it.
- Use `station_trap_nights(station_id, p_from, p_to)` for trap-night
  counts. NULL `end_date` is counted up to `current_date` (or
  `p_to`).

UI is a v1.1 follow-up; until then, create stations via SQL (see
runbook).

Spec: [`docs/specs/modules/31-camera-stations.md`](docs/specs/modules/31-camera-stations.md).
Runbook: [`docs/runbooks/camera-stations.md`](docs/runbooks/camera-stations.md).

### Multi-provider vision + platform pool (M32)

`supabase/functions/_shared/vision-provider.ts` exports a
`VisionProvider` interface with a `buildProvider(credential)`
dispatcher. Six concrete providers: Anthropic-direct (api_key /
oauth_token), AWS Bedrock, OpenAI, Azure OpenAI, Google Gemini,
Vertex AI.

Three load-bearing rules:

1. **Don't add a new provider class without updating
   `buildProvider`'s exhaustive switch.** The `never`-typed default
   case is the compiler hook that catches missing dispatch.
2. **Bedrock secrets are JSON envelopes**
   `{ region, accessKeyId, secretAccessKey, sessionToken? }`. The
   AWS Sig V4 signer is hand-rolled (~70 LOC) instead of bundling
   `@aws-sdk/client-bedrock-runtime` (~3 MB) into the EF.
   `bedrockModelId(model)` auto-translates Anthropic shorthand
   (`claude-haiku-4-5` → `us.anthropic.claude-haiku-4-5-v1:0`).
3. **Pool resolution is atomic via `consume_pool_slot()` SECURITY
   DEFINER + FOR UPDATE SKIP LOCKED.** It picks an active pool with
   capacity, enforces `daily_user_cap` per beneficiary, increments
   both counters, and marks `exhausted` when the pool fills — all
   in a single PL/pgSQL transaction. The `identify` EF wraps the
   call after the personal-sponsorship resolution fails.

Resolution order: BYO key → personal sponsorship → platform pool →
skip Claude (PlantNet only).

UI for credential creation + pool donation is a v1.1 follow-up;
until then, register credentials via Supabase Vault + SQL.

Spec: [`docs/specs/modules/32-multi-provider-vision.md`](docs/specs/modules/32-multi-provider-vision.md).
Runbooks: [`docs/runbooks/multi-provider-vision.md`](docs/runbooks/multi-provider-vision.md),
[`docs/runbooks/sponsor-pools.md`](docs/runbooks/sponsor-pools.md).

---

## Known pitfalls (things that bit me)

| Symptom | Cause | Fix |
|---|---|---|
| `supabase functions deploy` → "Missing required field: db.port" | CLI 2.90.0 has a regression on this project's config | Deploy via `gh workflow run deploy-functions.yml`. Never local. |
| Astro build: `Expected ")" but found <string,…>` | Inline `Record<…>` cast in JSX | Pull the cast into the frontmatter as a typed const |
| Astro page renders `[object Object]` for translation keys | `t(lang)` returns a translation **tree**, not a getter — the tokens.astro pages tripped on this | Drill into the tree directly: `const tr = t(lang); tr.profile.tokens.heading`. Don't call it like a function on a key path. |
| Vitest: `localStorage.clear is not a function` | Node 22's experimental localStorage shadows happy-dom's | Map-backed shim at top of test file (see `byo-keys.test.ts`) |
| Magic link redirects to `localhost:3000` | Supabase Site URL still default | Dashboard → Authentication → URL Configuration → set Site URL + allow-list `/auth/callback/` |
| Email auth "rate limit exceeded" after 3 sends | Supabase free tier built-in SMTP cap | Custom SMTP (Gmail App Password or Resend) — see module 04 |
| 403 from `/rest/v1/users` even with valid JWT | "Auto-expose new tables" was disabled at project creation | Schema includes explicit `GRANT SELECT/INSERT/UPDATE/DELETE` to anon + authenticated; replay `make db-apply` |
| OAuth provider returns no email | GitHub user has private email | `signInWithGitHub('read:user user:email')` scope requested in `auth.ts` |
| Edge Function 401 from cron | publishable `sb_publishable_…` key not accepted as Bearer by Edge Functions | Cron-only functions are deployed `--no-verify-jwt` |
| Custom OAuth domain (`auth.rastrum.org`) fails | Requires Supabase Pro plan ($25/mo) | **Resolved by deferring** (2026-04-26): default Supabase callback host is fine for v1.0; revisit if billing changes. Out of scope for the zero-cost target. |
| `/es/share/obs/?id=…` 404s on production | `src/pages/share/obs/index.astro` is the **only** share-obs page (locale-neutral); building it as `/${lang}/share/obs/` from a list view 404s | All explore / profile / observation views must use `/share/obs/?id=` — never prefix the locale. Regression covered by `tests/e2e/smoke.spec.ts` ("share/obs/ is locale-neutral"). Bit us in MyObs first (fixed), then again in PublicProfile/ExploreSpecies/ExploreRecent (fixed 2026-04-27). |
| 404 on `media.rastrum.app/...` after domain migration | Old hostname `media.rastrum.app` retired | **Resolved 2026-04-26:** use `https://media.rastrum.org/...`. Service worker pass-through list and env vars updated. |
| Test file imports `phi-vision.ts` directly and panics in Node | WebLLM bundle pulls WebGPU APIs at import time | Mock at the module boundary in your test, not at the WebLLM SDK level (see `local-ai.test.ts`). |
| `gh` CLI deploys still hit `rastrum.artemiop.com` in docs | Old canonical domain | **Resolved 2026-04-26:** all docs migrated to `rastrum.org`; the old domain redirects but new content goes to `rastrum.org`. |

---

## Things you should NOT do without asking

- **Don't run destructive git** (`git reset --hard`, `git push --force`,
  `git checkout --` against unstaged changes, `branch -D`) without explicit
  user permission. This repo is solo-developed but the user occasionally
  pushes from another machine.
- **Don't skip hooks** (`--no-verify`). Investigate the failure instead.
- **Don't commit `.env.local`, `supabase/config.toml.bak`, or anything in
  `.claude/`**. These are gitignored for a reason.
- **Don't enable a Supabase RLS policy without testing it.** A broken
  policy is a silent data leak. Use `make db-policies` to inspect.
- **Don't add new dependencies** without justifying. The bundle is
  performance-sensitive; every package adds to the PWA install size.
- **Don't auto-deploy Edge Functions on every push.** They use shared
  secrets; intentional `workflow_dispatch` keeps deploys deliberate.

---

## How to add new work

### A new doc page
1. Create EN page at `src/pages/en/docs/<name>.astro`.
2. Mirror at `src/pages/es/docs/<name>.astro` — same component, only the
   `lang` prop differs. Body lives in a shared `<NameView lang />`.
3. Add the slug to `docPages` in `src/i18n/utils.ts`.
4. Add `sections.<name>` and `descriptions.<name>` to both i18n files.
5. Run `make build` and confirm both pages render identically.

### A new top-level route (with social-share preview)
For routes that get linked from outside (homepage, observe, explore, share
pages, profile sub-pages, etc.), add a localized OG card so scrapers don't
fall back to `default.png`:

1. Add EN + ES copy entries to `PAGES` in `scripts/generate-og.ts`. Slugs
   are language-neutral (e.g. `profile-dex`); copy is per-locale.
2. Add the path → slug mapping in `ogSlugForPath()` in
   `src/layouts/BaseLayout.astro`. Match BOTH the EN and ES path forms.
3. Run `npm run build:og`. Cards land at `public/og/{en,es}/<slug>.png`,
   plus a legacy `public/og/<slug>.png` (ES content) for cached scrapers.
4. Verify in `dist/` after `npm run build` — `/en/<route>/index.html`
   should reference `/og/en/<slug>.png` and `/es/<route>/` the ES one.

Routes that aren't shareable (auth flows, dynamic share/obs, etc.) can
fall back to `default.png` — no need to wire them up.

### A new identifier plugin
See "Identifier plugin contract" above. Use the existing plugins
(`plantnet.ts`, `claude.ts`, `phi-vision.ts`) as templates.

### A new module spec
1. Find the next free number in `modules/00-index.md` (currently `20-`).
2. Create `docs/specs/modules/NN-<slug>.md`. Use the structure of an
   existing spec (`07-licensing.md` is a good template).
3. Add the row to `00-index.md` under the right phase section.
4. Cross-link from any consuming module.

### A new schema change
1. Edit `docs/specs/infra/supabase-schema.sql` directly. Make every
   statement idempotent.
2. Apply via `make db-apply`. Verify with `make db-verify` and
   `make db-policies`.
3. **Pre-merge gate** (`.github/workflows/db-validate.yml`) — fires on
   any PR touching the schema. Spins up an ephemeral Postgres 17 +
   PostGIS 3.4 service container, applies the schema TWICE (the second
   pass enforces idempotency), and runs the sentinel-table check. If
   anything errors — syntax, type mismatch (e.g., `MIN(uuid)`), missing
   `IF NOT EXISTS`, forward references — the PR fails. Required status
   check; do not bypass.
4. **CI auto-apply** (`.github/workflows/db-apply.yml`) fires on push to
   main when either SQL file changes. Requires `SUPABASE_DB_URL` Actions
   secret. The workflow can be fired manually via `gh workflow run
   db-apply.yml` with an optional `run_rarity_refresh=true` input to
   seed `taxon_rarity` immediately. Hardened with `fetch-depth: 0`,
   loud failure on unresolvable diff bases, and a sentinel-verify step
   that asserts critical tables/functions exist after apply.
5. If the change affects `progress.json` items, update the relevant
   item's subtasks in `docs/tasks.json` too.

**Why the validate gate exists.** PR #42 (admin console) merged with a
clean db-apply "success" status — but the apply step had silently
skipped because `actions/checkout@v4`'s shallow clone made `git diff
<before> <sha>` fail, and the script's `|| true` masked the error. A
later schema bug (`MIN(o.id)` on a UUID column from a different PR)
then made every subsequent apply fail mid-stream. Both issues survived
because nothing tested the schema against a real Postgres before merge.
The validate gate is the fix.

### A new roadmap item
1. Add to `docs/progress.json` (the right phase, with `_es` translation).
2. Add a corresponding entry to `docs/tasks.json` with subtasks.
3. Optionally add to `docs/tasks.md` for the prose narrative.
4. The `/docs/roadmap/` and `/docs/tasks/` pages re-render automatically.

---

## Pre-PR checklist

```bash
npm run typecheck   # tsc --noEmit, zero errors
npm run test        # vitest run — ~465 tests today, all green
npm run build       # zero errors, 57 pages today, EN/ES paired
git status -s       # nothing untracked except .claude/ or .env.local
```

Optional but encouraged when touching the UI shell, identifier UX, or
service worker:

```bash
npm run test:e2e        # Playwright on chromium + mobile-chrome
npm run test:lhci       # Lighthouse CI against ./dist
npm run test:audit      # build + e2e + lhci end-to-end
```

If touching SQL: `make db-apply` then `make db-verify`. If touching Edge
Functions: deploy via `gh workflow run deploy-functions.yml -f function=<name>`.

---

## When to ask vs when to just do

- **Just do**: refactors, bug fixes, doc updates, parity work, test
  additions, new components that don't change UX, performance fixes.
- **Ask first**: new external dependencies, schema changes that aren't
  additive, deleting code, anything that touches RLS, anything that
  changes the BYO-key privacy model, anything that bills the operator.

---

## Useful URLs while working

| What | URL |
|---|---|
| Production | https://rastrum.org |
| Supabase project | https://supabase.com/dashboard/project/reppvlqejgoqvitturxp |
| GitHub Actions | https://github.com/ArtemioPadilla/rastrum/actions |
| R2 bucket settings | https://dash.cloudflare.com/?to=/:account/r2/default/buckets/rastrum-media |
| Roadmap | https://rastrum.org/en/docs/roadmap/ |
| Tasks | https://rastrum.org/en/docs/tasks/ |
| MCP server | https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp |
| API tokens | https://rastrum.org/en/profile/tokens |

---

## Audit / E2E

End-to-end browser tests run via Playwright; performance and a11y budgets
via Lighthouse CI. Both are wired into GitHub Actions
(`.github/workflows/e2e.yml`, `.github/workflows/lhci.yml`).

```bash
npm run test:e2e            # Playwright on chromium + mobile-chrome
npm run test:e2e:ui         # Playwright UI mode (debug locally)
npm run test:e2e:mobile     # mobile-chrome project only
npm run test:lhci           # Lighthouse CI against ./dist
npm run test:audit          # build + e2e + lhci end-to-end
```

Reports land in:
- `playwright-report/` — HTML report, opened with `npx playwright show-report`
- `test-results/` — failure traces, screenshots, videos
- `.lighthouseci/` — JSON + HTML for each URL audited

The suite is **intentionally minimal** — smoke + nav + docs + observe form +
PWA + a11y + mobile + offline. Total runtime under a minute locally on
chromium. Add tests sparingly; if you need a complex flow, ask whether
mocking is cheaper than a real test, and skip it if it depends on a real
Supabase session. See the per-spec comments for what's deliberately out of
scope (auth flows, identifier cascade, real SW caching).

The Playwright preview server uses port `4329` to avoid colliding with a
stray `astro dev` on `4321`. Override with `E2E_PORT=…` if needed.
