# Rastrum Tasks — Detailed Breakdown

> **Source of truth for execution.** Every item from `docs/progress.json`
> is broken down into concrete subtasks here. When a roadmap item is
> closed, every subtask under it must be checked.
>
> Format: `[x]` shipped (commit ref), `[~]` in progress, `[ ]` not started,
> `[!]` blocked on an external dependency.
>
> Status updated: 2026-04-25.

---

## v0.1 — Alpha MVP (online-first) · **shipped**

### `astro-skeleton` — Astro site skeleton + Tailwind + i18n  ✓
- [x] Astro 5 project with `output: 'static'` (`astro.config.mjs`)
- [x] Tailwind 3 + `@astrojs/tailwind` integration
- [x] EN/ES locales via `astro/i18n` + `prefixDefaultLocale: true`
- [x] `BaseLayout.astro` + `DocLayout.astro` shared shells
- [x] Header + Footer components with theme toggle, language switcher, mobile menu
- [x] Sitemap (`@astrojs/sitemap`)
- [x] Logo, favicon
**Files:** `astro.config.mjs`, `src/layouts/`, `src/components/Header.astro`, `src/components/Footer.astro`, `src/i18n/`
**Acceptance:** `npm run build` produces 30+ static pages cleanly.

### `supabase-schema` — Supabase schema with PostGIS + RLS  ✓
- [x] `users`, `taxa`, `taxon_usage_history`, `observations`, `identifications`, `media_files` tables
- [x] PostGIS `geography(Point, 4326)` for `observations.location`
- [x] RLS policies: owner full access + public read for synced non-sensitive rows
- [x] `obs_credentialed_read` policy for credentialed researchers
- [x] Triggers: `on_auth_user_created`, `update_obs_count_trigger`, `sync_primary_id_trigger`
- [x] `obscure_point()` helper + denormalised `obscure_level` on observations
- [x] Idempotent (`IF NOT EXISTS` everywhere; replayable via `make db-apply`)
- [x] Storage bucket `media` with public-read + authenticated-write policies
- [x] Role-level grants (anon SELECT, authenticated CRUD)
**Files:** `docs/specs/infra/supabase-schema.sql`, `Makefile` (`db-apply`, `db-verify`)
**Modules:** [`02-observation.md`](specs/modules/02-observation.md), [`05-map.md`](specs/modules/05-map.md), [`06-darwin-core.md`](specs/modules/06-darwin-core.md), [`07-licensing.md`](specs/modules/07-licensing.md)
**Acceptance:** `make db-verify` shows 6 tables, 5 RLS-on, 3 triggers, all seed extensions.

### `auth-magic-link` — Supabase magic-link auth + guest mode  ✓
- [x] `src/lib/supabase.ts` singleton client (publishable key)
- [x] `src/lib/auth.ts` helpers: `sendMagicLink`, `exchangeCode`, `signOut`
- [x] `src/pages/{en/sign-in,es/ingresar}.astro` magic-link request form
- [x] `src/pages/auth/callback.astro` handles BOTH PKCE (`?code=`) and implicit (`#access_token=`) flows
- [x] Header avatar dropdown swaps with sign-in link via `onAuthStateChange`
- [x] `ObserverRef` discriminated union (`{kind:'user'|'guest'}`)
- [ ] **Guest mode hard-cap** — code path exists, UI nudge after 3rd guest observation pending
**Files:** `src/lib/supabase.ts`, `src/lib/auth.ts`, `src/pages/{en,es}/...`, `src/pages/auth/callback.astro`, `src/components/Header.astro`
**Modules:** [`04-auth.md`](specs/modules/04-auth.md)
**Acceptance:** Sign in via magic link → land on `/{lang}/` authenticated; `auth.users` + `public.users` rows auto-created.

### `auth-multi` — Google + GitHub OAuth, OTP code, passkey, sign-out-everywhere  ✓
- [x] `signInWithGoogle()` + `signInWithGitHub('read:user user:email')` in `auth.ts`
- [x] OTP-code flow (`requestEmailOtp` + `verifyEmailOtp`) — pastes 6-digit code instead of clicking link
- [x] Passkey: `enrollPasskey()` + `verifyPasskey()` with b64url ↔ ArrayBuffer dance
- [x] WebAuthn feature detection (`passkeySupported()`)
- [x] `signOutEverywhere()` revokes refresh tokens globally
- [x] `SignInForm.astro` shared component used by both locales (one place to change UX)
- [x] Profile/edit Security section: register passkey + sign-out-all
- [ ] **MFA WebAuthn enrolment** — Supabase dashboard toggle still needs to be enabled (operator)
**Files:** `src/lib/auth.ts`, `src/components/SignInForm.astro`, `src/components/ProfileEditForm.astro`
**Modules:** [`04-auth.md`](specs/modules/04-auth.md)
**Acceptance:** Sign in via OAuth and OTP both succeed; passkey button hidden when WebGPU absent.

### `ci-cd` — CI/CD via GitHub Actions  ✓
- [x] `.github/workflows/ci.yml` — typecheck + test + build on PRs
- [x] `.github/workflows/deploy.yml` — typecheck + test + build + deploy to GH Pages on main push
- [x] `.github/workflows/deploy-functions.yml` — manual `workflow_dispatch` deploy of Edge Functions (CLI 2.90.0 broken locally; CI bypasses)
- [x] 4 PUBLIC_* secrets pushed via `gh secret set`
- [x] Vitest job runs in CI, fails the build on test failures
**Files:** `.github/workflows/ci.yml`, `.github/workflows/deploy.yml`, `.github/workflows/deploy-functions.yml`
**Modules:** [`infra/testing.md`](specs/infra/testing.md), [`infra/github-actions.yml`](specs/infra/github-actions.yml)
**Acceptance:** Every push to main triggers a successful deploy in <60s.

### `profile-basics` — Profile page + edit + avatar dropdown  ✓
- [x] `ALTER TABLE users` with 8 additive columns (`profile_public`, `gamification_opt_in`, `streak_digest_opt_in`, `region_primary`, `joined_at`, `last_observation_at`, `stats_cached_at`, `stats_json`) + 3 credential columns
- [x] `ProfileView.astro` shared component (read-only profile page)
- [x] `ProfileEditForm.astro` shared component (12+ editable fields, 3 opt-in toggles)
- [x] EN at `/profile/`, `/profile/edit/`, `/profile/export/`; ES at `/perfil/`, `/perfil/editar/`, `/perfil/exportar/`
- [x] Initials-SVG avatar fallback when no avatar URL
- [x] Avatar dropdown in Header replaces Sign-out button (View profile / Edit / Sign out)
- [x] Activity feed section (renders v0.3+ events when present)
- [x] Badges section (renders v0.5+ badges when gamification opted in)
**Files:** `src/components/ProfileView.astro`, `src/components/ProfileEditForm.astro`, `src/pages/{en,es}/profile/`, `src/pages/{en,es}/perfil/`
**Modules:** [`08-profile-activity-gamification.md`](specs/modules/08-profile-activity-gamification.md)
**Acceptance:** Sign in → Profile shows your stats; Edit → save → reflect.

### `gps-observation` — GPS observation form with EXIF auto-fill  ✓
- [x] `src/pages/{en/observe,es/observar}.astro` page
- [x] `ObservationForm.astro` shared component
- [x] Camera capture (`<input capture="environment">`) + multi-image gallery (`multiple`)
- [x] Live GPS via `navigator.geolocation.getCurrentPosition` with 10s timeout
- [x] EXIF GPS fallback via `exifr` library (auto-fills location from photo)
- [x] Manual coords input as last resort
- [x] Habitat dropdown (12 IUCN-aligned values)
- [x] Weather dropdown (7 values)
- [x] Notes textarea (2000 char limit)
- [x] Evidence type dropdown (track, scat, burrow, nest, feather, bone, sound, camera_trap)
- [x] Privacy notice (NOM-059/CITES warning) always visible
- [x] Audio capture via MediaRecorder (≤30s)
- [x] Submit validation: photo OR audio required; location required
- [x] Saves to Dexie outbox; immediate sync attempt when authenticated + online
**Files:** `src/components/ObservationForm.astro`, `src/lib/types.ts`
**Modules:** [`02-observation.md`](specs/modules/02-observation.md)
**Acceptance:** Take photo → GPS auto-fills → save → row in `observations`, blob in R2.

### `plantnet-id` + `claude-haiku-id` — Photo ID cascade  ✓
- [x] `supabase/functions/identify/index.ts` — Edge Function with PlantNet → Claude Haiku waterfall
- [x] `force_provider` field for cascade-engine routing
- [x] `client_keys: { plantnet?, anthropic? }` BYO key pass-through (never logged or persisted)
- [x] PlantNet 0.7 confidence threshold; Haiku fallback when below
- [x] Claude Haiku 4.5 with cached system prompt (90% token savings)
- [x] JSON-shape Claude response parsing with code-fence stripping
- [x] Identifications written via service-role client; trigger materialises denormalised columns
- [x] Plugin wrappers in `src/lib/identifiers/{plantnet,claude}.ts`
- [x] `testConnection()` probes for both providers
- [ ] **Operator: deploy** — `gh workflow run deploy-functions.yml -f function=identify` (done at least once already)
- [ ] **Operator: secrets** — `PLANTNET_API_KEY` set ✓, `ANTHROPIC_API_KEY` optional (users can BYO)
**Files:** `supabase/functions/identify/index.ts`, `src/lib/identifiers/{plantnet,claude}.ts`
**Modules:** [`01-photo-id.md`](specs/modules/01-photo-id.md), [`13-identifier-registry.md`](specs/modules/13-identifier-registry.md)
**Acceptance:** Photo of a plant → PlantNet returns species ≥0.7 → row in `identifications`; ambiguous photo → Claude attempt; either way stored with `source` set.

### `map-view` — MapLibre map with clustered observation pins  ✓
- [x] `src/components/ExploreMap.astro` shared component
- [x] EN at `/explore/map/`, ES at `/explorar/mapa/`
- [x] OpenFreeMap Liberty style as base (free, IPv4-only fine)
- [x] GeoJSON source from `observations` table (RLS-gated)
- [x] supercluster-style clustering at low zoom; individual pins at high zoom
- [x] Kingdom-coloured pins (Plantae=green, Animalia=red, Fungi=purple)
- [x] Click pin → popup with species name + thumbnail + view-observation link
- [ ] **pmtiles offline** — deferred to v0.3 (`offline-maps` item)
**Files:** `src/components/ExploreMap.astro`, `src/pages/{en/explore/map,es/explorar/mapa}.astro`
**Modules:** [`05-map.md`](specs/modules/05-map.md)

### `darwin-core-csv` — Darwin Core CSV export  ✓
- [x] `src/lib/darwin-core.ts` with full DwC mapping (`toDwCRecord`, `toCSV`, `downloadCSV`)
- [x] Three column presets: standard DwC, CONABIO SNIB subset, CONANP subset
- [x] Obscuration tier handling (none / 0.1deg / 0.2deg / 5km / full → uncertainty in metres)
- [x] `cf.` qualifier for confidence < 0.7
- [x] Rights / license / observer attribution from user profile
- [x] `src/components/ExportView.astro` with format selector
- [x] Filename includes ISO date + format suffix
- [x] 9 Vitest unit tests cover the mapping
**Files:** `src/lib/darwin-core.ts`, `src/lib/darwin-core.test.ts`, `src/components/ExportView.astro`
**Modules:** [`06-darwin-core.md`](specs/modules/06-darwin-core.md)

### `pwa-manifest` — PWA manifest + service worker  ✓
- [x] `public/manifest.webmanifest` with `display: standalone`, theme color, icons
- [x] `public/sw.js` cache-first for same-origin GETs
- [x] Service-worker registration in `BaseLayout.astro` (production-only, skipped on localhost)
- [x] Pass-through for Supabase, Anthropic, PlantNet, OpenFreeMap, unpkg URLs
- [x] Apple-mobile-web-app meta tags
- [ ] **Workbox-style sync queue** — deferred (we use the visibilitychange + online listeners on the page itself)
**Files:** `public/manifest.webmanifest`, `public/sw.js`, `src/layouts/BaseLayout.astro`

### `offline-queue` — Dexie outbox + sync engine + identify trigger  ✓
- [x] `src/lib/db.ts` — RastrumDB with `observations`, `mediaBlobs`, `idQueue` tables
- [x] `src/lib/sync.ts` — `syncOutbox`, `registerSyncTriggers`, fire-and-forget `triggerIdentify` + `triggerEnvEnrichment`
- [x] Cascade-engine integration (replaces hardcoded waterfall)
- [x] R2 + Supabase Storage dual upload paths via `lib/upload.ts`
- [x] Client-side image resize (≤1200px JPEG q=0.85) before upload
- [x] Sync triggers on `online` event + `visibilitychange`
- [x] Failed cascade leaves a queue entry for retry
- [x] Audio blob support — uploads with mime-type-derived `media_type`
**Files:** `src/lib/db.ts`, `src/lib/sync.ts`, `src/lib/upload.ts`
**Modules:** [`03-offline.md`](specs/modules/03-offline.md), [`10-media-storage.md`](specs/modules/10-media-storage.md)

### `unit-tests` — Vitest unit-test scaffold  ✓
- [x] Vitest 4.1 + happy-dom env
- [x] `vitest.config.ts` config
- [x] Two test files: `darwin-core.test.ts` (9 tests), `byo-keys.test.ts` (10 tests)
- [x] Make targets: `make test`, `make test-coverage`
- [x] CI integration in both ci.yml and deploy.yml
- [ ] **pgTAP RLS test suite** — spec written, suite not yet shipped (`infra/testing.md`)
- [ ] **Playwright E2E** — spec written, suite not yet shipped
**Files:** `vitest.config.ts`, `src/**/*.test.ts`
**Modules:** [`infra/testing.md`](specs/infra/testing.md)

---

## v0.3 — Offline intelligence + activity · **in progress**

### `activity-feed` — Activity feed + server-side triggers  ✓
- [x] `activity_events` table with kind enum (12 values), payload jsonb, visibility (self/followers/public)
- [x] RLS: self read+update + public scoped to `profile_public = true`
- [x] Indexes: per-actor unread, public-feed scan
- [x] `fire_observation_created` trigger
- [x] `fire_research_grade` trigger (promotes to public on consensus)
- [x] Profile-page rendering with i18n event labels (12 kinds)
- [x] Auto-mark-as-read when viewed
**Files:** `docs/specs/infra/supabase-schema.sql`, `src/components/ProfileView.astro`
**Modules:** [`08-profile-activity-gamification.md`](specs/modules/08-profile-activity-gamification.md)

### `unread-badge` — Unread-count badge on avatar  ✓
- [x] Header avatar shows red dot with count when `activity_events.read_at IS NULL`
- [x] Refreshes on every `onAuthStateChange`
- [x] 99+ overflow text
**Files:** `src/components/Header.astro`

### `sensitive-privacy` — NOM-059/CITES obscuration warning  ✓
- [x] Amber notice always visible in observation form
- [x] Schema-side `obscure_level` column with `none|0.1deg|0.2deg|5km|full` enum
- [x] `sync_primary_identification` trigger applies obscuration via `obscure_point()` helper
- [x] `location_obscured` separate column for public reads
- [ ] **Per-species look-up at form-submit time** — currently the warning is generic; future: post-ID UI shows actual obscuration tier of the resolved species

### `exif-extraction` — EXIF/XMP/ID3 metadata auto-extraction  ✓
- [x] `exifr` library used in observation form
- [x] GPS extracted (with EXIF source flag separate from live-GPS)
- [x] DateTimeOriginal → observation timestamp
- [x] Auto-fills location with badge "Location from photo"
**Files:** `src/components/ObservationForm.astro`

### `byo-anthropic-key` — BYO Anthropic key  ✓ (subsumed by `byo-keys-platform`)
- [x] One-time migration of legacy `localStorage['rastrum.byoAnthropicKey']` → `byoKeys["claude_haiku.anthropic"]`
- [x] BYO key forwarded as `client_keys.anthropic` in identify Edge Function
- [x] Never persisted server-side, never logged
**Files:** `src/lib/byo-keys.ts`, `src/lib/identifiers/claude.ts`

### `webllm-text` — WebLLM Llama-3.2-1B for translation + field notes  ✓
- [x] `@mlc-ai/web-llm` ^0.2.82 installed
- [x] `src/lib/local-ai.ts` — `loadTextEngine`, `translateNote`, `generateFieldNote`
- [x] Profile/edit AI settings: download card with consent modal
- [x] Cache management (Cache API probe, delete, redownload)
- [x] `requestPersistentStorage()` to prevent iOS 7-day eviction
- [ ] **UI integration in observation form** — translate / auto-narrative buttons next to notes textarea (planned 2.4 in next-steps)
**Files:** `src/lib/local-ai.ts`, `src/components/ProfileEditForm.astro`
**Modules:** [`11-in-browser-ai.md`](specs/modules/11-in-browser-ai.md)

### `onnx-base` — EfficientNet-Lite0 ONNX base fallback  [!]
- [ ] [!] Train or convert model to ONNX (~3 MB int8)
- [ ] [!] Bundle species labels JSON
- [ ] [!] `src/lib/identifiers/onnx-base.ts` real implementation
- [ ] Image preprocessing (resize 224×224, normalise) in JS
- [ ] Plugin registry: flip `isAvailable()` to ready
**Blocked by:** ONNX model training/conversion pipeline (no public artifact today).
**Modules:** [`13-identifier-registry.md`](specs/modules/13-identifier-registry.md), `src/lib/identifiers/onnx-base.ts`

### `offline-maps` — pmtiles offline map download  [!]
- [ ] [!] Generate Mexico zoom 0–10 pmtiles (~250 MB)
- [ ] [!] Upload to R2 at `tiles.rastrum.app/mexico-overview-v1.pmtiles`
- [ ] Add download trigger in profile/edit (cell-conn warning)
- [ ] Cache in OPFS via Cache API; serve via `pmtiles://` protocol in MapLibre
- [ ] Per-region zoom 11–14 chunks (~20–60 MB each, on-demand)
**Blocked by:** pmtiles generation infrastructure (Tippecanoe + region clipping).
**Modules:** [`05-map.md`](specs/modules/05-map.md)

---

## v0.5 — Beta · **in progress**

### `multi-image` — Multi-image observations  ✓
- [x] Gallery `<input multiple>`
- [x] Photo grid in form with primary indicator + remove button
- [x] All blobs saved to Dexie + uploaded to R2
- [x] Media files inserted with proper `sort_order` and `is_primary`

### `eco-evidence` — Ecological evidence fields  ✓
- [x] `evidence_type` enum on observations table
- [x] Form dropdown (8 values + camera_trap)
- [x] Cascade picks up the type for context
**Modules:** [`02-observation.md`](specs/modules/02-observation.md)

### `discovery-badges` — 39 seed badges + nightly evaluator  ✓
- [x] `badges` + `user_badges` tables with RLS
- [x] `seed-badges.sql` with 39 multilingual entries (EN+ES) across 5 categories × 4 tiers
- [x] `make db-seed-badges` Make target
- [x] Badge-eligibility SQL functions (`badge_eligible_kingdom_first`, `_rg_count`, `_species_count`, `_kingdom_diversity`)
- [x] `award-badges` Edge Function — nightly evaluator
- [x] Profile-page rendering with tier-coloured pills
- [x] Cron schedule: `30 7 * * *` UTC
- [ ] **Activity-feed integration** — `badge_earned` event kind exists but evaluator doesn't yet write to it
**Files:** `docs/specs/infra/seed-badges.sql`, `supabase/functions/award-badges/index.ts`

### `webllm-vision` — WebLLM Phi-3.5-vision fallback  ✓
- [x] Phi-3.5-vision-instruct-q4f16_1-MLC plugin
- [x] Confidence hard-capped at 0.35 (DB trigger blocks <0.4 from research-grade)
- [x] Disclaimer in profile/edit + plugin description
- [x] Same consent + cache + delete flow as Llama-3.2-1B
- [x] Cascade integration as last-resort when no cloud key + opted-in
**Modules:** [`11-in-browser-ai.md`](specs/modules/11-in-browser-ai.md)

### `quality-gates` — Confidence ≥ 0.4 enforcement on research-grade  ✓
- [x] `enforce_research_grade_quality` trigger raises if `is_research_grade=true AND confidence<0.4`
- [x] Quality cap on Phi-3.5-vision (0.35 by plugin contract)

### `consensus-workflow` — 2/3 identifier consensus + anti-sybil + expert weight  ✓
- [x] `prevent_self_validation` trigger (anti-sybil)
- [x] `recompute_consensus` plpgsql function with expert 3× weight
- [x] Research-grade fires when weighted score ≥ 2.0 AND ≥ 2 distinct validators
- [ ] **Validator UI** — community page where users can validate others' observations (pending)
- [ ] **Periodic recompute trigger** — currently must be invoked manually; add `AFTER INSERT/UPDATE on identifications`

### `byo-keys-platform` — Per-plugin BYO API keys with guided setup  ✓
- [x] `KeySpec` + `SetupStep` + `testConnection` plugin contract additions
- [x] `src/lib/byo-keys.ts` central store
- [x] Per-plugin Configure disclosure with numbered onboarding steps
- [x] Live save + Test + Clear buttons
- [x] 10 unit tests in `byo-keys.test.ts`
**Modules:** [`13-identifier-registry.md`](specs/modules/13-identifier-registry.md)

### `birdnet-audio` — BirdNET-Lite audio ID  [~]
- [x] Audio capture in observation form (MediaRecorder ≤30s)
- [x] Sync engine routes audio blobs to R2 with `media_type=audio`
- [x] Cascade engine targets `Animalia.Aves` for audio observations
- [x] BirdNET plugin stub registered (`isAvailable: { ready: false, reason: 'model_not_bundled' }`)
- [x] Module 12 spec written
- [ ] [!] Download BirdNET-Lite TFLite or ONNX from Cornell (~50 MB)
- [ ] [!] Upload to R2 at `rastrum-media/models/birdnet-lite-v2.4.onnx`
- [ ] Implement spectrogram preprocessing in JS (Meyda)
- [ ] Wire `onnxruntime-web` inference in plugin
- [ ] Bundle species labels JSON
- [ ] Profile/edit download card alongside Phi/Llama
- [ ] UI attribution: "BirdNET (Cornell Lab) — non-commercial citizen science"
**Modules:** [`12-birdnet-audio.md`](specs/modules/12-birdnet-audio.md)
**Acceptance:** Record 5s of bird call → species candidate appears within 10s.

### `scout-v0` — Rastrum Scout v0 (conversational ID, pgvector RAG)  [!]
- [ ] [!] pgvector extension enabled (deferred per `future-migrations.md`)
- [ ] [!] Embedding pipeline: ~50K Mexican taxa descriptions → Voyage-3 embeddings → `taxon_embeddings` table
- [ ] [!] HNSW index on `embedding vector_cosine_ops`
- [ ] Scout Edge Function: cosine-similarity retrieval + Claude Haiku composition
- [ ] Chat UI in app
- [ ] Conversation history stored in `chat_sessions` table
**Blocked by:** ML pipeline + Voyage embedding budget (~$50 one-shot).

### `onnx-regional` — Regional ONNX packs (Oaxaca, Yucatán)  [!]
- [ ] [!] Training pipeline (TensorFlow Lite Model Maker or PyTorch + Optimum)
- [ ] [!] Curated training set per region (~1K species each)
- [ ] [!] Convert to ONNX int8
- [ ] Download cards in profile/edit
- [ ] Region-aware cascade routing (lat/lng → pack)
**Blocked by:** Model training infrastructure.

### `gbif-ipt` — GBIF IPT pilot publish  [!]
- [ ] [!] GBIF publisher account application (~2 weeks)
- [ ] DwC-A ZIP generator: `meta.xml` + `eml.xml` + `occurrence.csv` + `multimedia.csv`
- [ ] Edge Function `gbif-publish`: scheduled monthly upload via SFTP
- [ ] DOI tracking in `dataset_versions` table
**Modules:** [`06-darwin-core.md`](specs/modules/06-darwin-core.md)

### `local-contexts` — Local Contexts BC/TK Notice integration  [!]
- [ ] [!] Community consent (Zapoteco partnership) — multi-month governance
- [ ] [!] Local Contexts Hub API v2 integration
- [ ] `observation_bc_notices` link table
- [ ] BC/TK label rendering on observations + DwC export
**Blocked by:** Governance track — community consent before code.

---

## v1.0 — Public Launch · **in progress**

### `streaks` — Opt-in streaks + grace window  ✓
- [x] `user_streaks` table
- [x] `recompute_streak(user_id)` plpgsql function with single-grace-per-30-days
- [x] `recompute-streaks` Edge Function (nightly cron, 0 7 * * *)
- [x] Quality gate: only counts days with confidence ≥ 0.4
- [ ] **Streak display on profile** — currently no UI surface for current/longest days
- [ ] **Inbox-digest email** for streak milestones (deferred — needs SES or Resend)

### `shareable-cards` — Share OG cards  ✓
- [x] `share-card` Edge Function — SVG + HTML wrapper variants
- [x] Branded gradient + species name + region + observer
- [x] OG / Twitter card meta on `share/obs/?id=…` page
- [x] Sensitive-species badge when obscured
- [x] Public Astro page renders observation details

### `social-features` — Follows + comments + watchlists schema  ✓
- [x] `follows` table with anti-self-follow CHECK + RLS
- [x] `observation_comments` table with parent_id threading + soft-delete
- [x] `watchlists` table with radius_km
- [ ] **UI for follows / comments / watchlists** — schema only; tracked as `follows-comments-ui`

### `expert-system` — Expert taxonomic 3× weight  ✓
- [x] `users.is_expert` + `users.expert_taxa[]` columns
- [x] `recompute_consensus()` applies 3× weight when validator has matching expert taxa
- [ ] **Expert-application UI** — admins manually flip the boolean today
- [ ] **Expert badges** in profile

### `bioblitz-events` — Events table + RLS  ✓
- [x] `events` table with `region_geojson geography(Polygon, 4326)` + GIST index
- [x] Public read RLS
- [x] Three event kinds: bioblitz / survey / challenge
- [ ] **Event detail page** — `/{lang}/events/{slug}/`
- [ ] **Event aggregates** — observations within polygon × time window
- [ ] **Participation badges** — `bioblitz_{slug}_participant`
- [ ] **Top-decile detection** for `bioblitz_top_contributor` badges

### `institutional-export` — DwC + SNIB + CONANP CSV  ✓
- [x] Three column subsets in `darwin-core.ts`
- [x] Format selector in Export view
- [x] Filename suffixes per format

### `credentialed-access` — credentialed_researcher RLS gate  ✓
- [x] Three columns on users (`credentialed_researcher`, `credentialed_at`, `credentialed_by`)
- [x] `obs_credentialed_read` RLS policy
- [ ] **Application flow** — admin still flips manually; need a /apply page

### `env-enrichment` — Lunar phase + OpenMeteo weather  ✓
- [x] `enrich-environment` Edge Function — OpenMeteo daily weather + Conway lunar
- [x] Auto-fires on observation sync (parallel with identify)
- [x] Updates moon_phase, moon_illumination, precipitation_24h_mm, temp_celsius, post_rain_flag

### `video-support` — Video ≤30s (H.265/AV1)  [!]
- [ ] [!] Server-side ffmpeg transcoding pipeline
- [ ] Video capture in observation form (MediaRecorder)
- [ ] Frame extraction for ID + audio-track separation for BirdNET
- [ ] Video player on observation page
**Blocked by:** Transcoding infrastructure (Cloud Run + ffmpeg layer).

### `camera-trap-ingest` — Camera trap ingestion  [!]
- [ ] [!] MegaDetector + SpeciesNet model deployment (~5 GB combined)
- [ ] Bulk-upload UI (drag-drop, progress per file)
- [ ] `camera_trap_deployments` + `camera_trap_processing_queue` tables
- [ ] Edge Function: motion detection → species ID → research-grade tracking
**Modules:** [`09-camera-trap.md`](specs/modules/09-camera-trap.md)

### `capacitor-ios` — iOS App Store wrapper (v1.2)  [!]
- [ ] [!] Apple Developer Program ($99/yr)
- [ ] Capacitor scaffolding + platform/ios
- [ ] Native plugins: Camera, Geolocation, Filesystem, Network
- [ ] App Store metadata + screenshots
- [ ] First TestFlight build
**Blocked by:** Apple Developer Program subscription.

### `follows-comments-ui` — UI for follows + comments + watchlists
- [ ] "Follow" button on public profile pages
- [ ] Threaded comments component below observation share page
- [ ] Followers' research-grade events appear in your activity feed
- [ ] Watchlist add/edit form in profile
- [ ] Watchlist alerts (inbox digest, daily cron Edge Function)

---

## v1.5 — Territory Layer · **planned (parallel to v1.0)**

### `biodiversity-trails` — Trails with GPS waypoints + diversity metrics
- [ ] `trails` table: start_at, end_at, route geometry (LineString), observer_id
- [ ] Trail recording UI: start/stop, waypoint markers
- [ ] Per-trail observation linking (FK to trail_id)
- [ ] Diversity metrics computed per trail (S, H', D)
- [ ] Trail detail page + map render

### `pits-qr` — PITs + QR/NFC anchors
- [ ] `pits` table: slug, polygon, display_name, install_location
- [ ] `/{lang}/pit/<slug>/` page: observations within polygon
- [ ] QR generator for printing
- [ ] NFC tag write protocol documentation
- [ ] Stats: total visitors, unique species recorded at this PIT

### `spatial-analysis` — ANP/INEGI/INAH GeoJSON layers
- [ ] Static GeoJSON files for ANP boundaries (CONANP source)
- [ ] INEGI municipal boundaries
- [ ] INAH archaeological-zone polygons
- [ ] Toggle layers in MapLibre map
- [ ] PostGIS `ST_Within` queries for "observations within ANP X"

### `diversity-indices` — S, H', D, Chao1, Pielou J
- [ ] Edge Function `diversity-stats(bbox, time_window)` returns JSON
- [ ] Math: Shannon-Wiener, Simpson, Chao1, Pielou evenness
- [ ] Rarefaction curves
- [ ] Render in trail / event / region pages

### `trail-pdf-export` — Trail PDF export (field guide style)
- [ ] Server-side PDF rendering (Puppeteer or `@react-pdf/renderer`)
- [ ] Cover map, species list with thumbnails, diversity stats
- [ ] Bilingual templates

---

## v2.0 — Institutional · **planned**

### `camera-trap-advanced` — Occupancy modelling, activity histograms
- [ ] R or Python statistical pipeline (occupancy package)
- [ ] Activity histograms by species + time-of-day
- [ ] Multi-camera grid analysis

### `gbif-publisher` — GBIF dataset publisher + DOI generation
- [ ] Continuous DwC-A export
- [ ] Versioned dataset releases with DOIs (Zenodo or DataCite)
- [ ] Citation generator

### `regional-ml` — Regional ML training pipeline
- [ ] Continuous fine-tuning on validated observations
- [ ] Federated learning across institutional partners
- [ ] Model card publication per release
- [ ] License gate: only CC BY / CC0 observations enter training (per module 07)

### `b2g-dashboard` — B2G SaaS dashboard for CONANP / state agencies
- [ ] Separate Astro+React app at `b2g.rastrum.app`
- [ ] Per-agency report templates (CONANP, INAH, state SEMARNATs)
- [ ] Stripe subscriptions
- [ ] Audit logs + SLA monitoring
- [ ] **Commercial — needs Cornell BirdNET license**

### `inat-bridge` — iNaturalist import/export bridge
- [ ] iNat OAuth flow
- [ ] Import: pull user's iNat observations into Rastrum
- [ ] Export: push verified Rastrum data back to iNat with attribution
- [ ] Rate-limit compatibility

---

## v2.5 — AI + AR · **planned**

### `scout-full` — Full conversational field AI (RAG + pgvector)
- Builds on `scout-v0`. Production-grade RAG with conversation history, multi-turn refinement, region-aware retrieval, citation rendering.

### `ar-overlay` — AR species overlay
- [ ] WebXR or Capacitor ARKit/ARCore
- [ ] Real-time camera frame → ID → 3D label overlay
- [ ] Performance budget: 30fps mobile

### `voice-indigenous` — Indigenous language voice I/O
- [ ] Whisper-tiny via transformers.js for STT
- [ ] Custom-trained TTS for Zapoteco/Mixteco/Maya/Náhuatl (no off-the-shelf today)
- [ ] Conversation flow in Zapoteco for Sierra Norte pilot

### `conabio-api` — Formal CONABIO/CONANP/INAH partnership APIs
- [ ] MOUs with each agency
- [ ] Whitelisted API endpoints with audit logs
- [ ] Bidirectional sync agreements

---

## Governance Track — parallel to all phases

### `zapoteco-fpic` — FPIC process with Sierra Norte
- [ ] [!] Initial outreach to Sierra Norte community partner (FAHHO contact)
- [ ] [!] Co-design sessions for UI translations
- [ ] [!] Local Contexts BC Notice issuance
- [ ] [!] Documented consent agreement
**This is multi-month relationship work, not code.**

### `local-contexts` — Local Contexts BC/TK Notice integration
- [ ] [!] Local Contexts Hub API v2 wrappers (after consent agreement)
- [ ] [!] `observation_bc_notices` link table
- [ ] [!] UI rendering of TK/BC labels on observations + DwC export

### `data-sovereignty` — Indigenous Data Sovereignty (CARE) policy
- [ ] [!] Policy document drafted with CARI advisory council input
- [ ] [!] Public-facing policy page on docs site
- [ ] [!] Operational checklist baked into RLS + Edge Functions

### `license-framework` — Observer license framework  ✓
- [x] CC BY 4.0 / CC BY-NC 4.0 / CC0 selectable per user
- [x] Stored on `users.observer_license`
- [x] Propagated to Darwin Core export's `license` field
- [x] ML training gate: NC-licensed observations excluded from training set queries
**Modules:** [`07-licensing.md`](specs/modules/07-licensing.md)

### `birdnet-cornell` — BirdNET Cornell commercial license
- [ ] [!] Email `ccb-birdnet@cornell.edu` with project description, revenue model, timeline
- [ ] [!] Negotiate license terms (multi-month process)
- [ ] [!] Sign before shipping v2.0 B2G dashboard
**Only required for v2.0 commercial use; not needed for v0.5 non-commercial citizen science.**

---

## External Actions Required (operator)

These don't have subtasks because they're not engineering work — they're configurations or accounts the human operator must arrange:

- [x] Cloudflare R2 account + DNS for `rastrum-media.artemiop.com`
- [x] R2 bucket + API token + CORS policy
- [x] Supabase project provisioned + secrets set (PLANTNET_API_KEY, R2_*)
- [x] Edge Functions deployed (identify, enrich-environment, recompute-streaks, award-badges, share-card, get-upload-url)
- [x] Cron jobs scheduled (streaks-nightly, badges-nightly)
- [x] Custom SMTP (Gmail/Resend) for auth emails
- [x] Site URL + Redirect URLs allow-listed
- [ ] ANTHROPIC_API_KEY (optional — users can BYO)
- [ ] Google + GitHub OAuth provider credentials in dashboard
- [ ] BirdNET-Analyzer model artifact bundling
- [ ] GBIF publisher account
- [ ] Apple Developer Program subscription
- [ ] ONNX training pipeline
