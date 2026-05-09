# Changelog

All notable changes to Rastrum are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions use CalVer `YYYY.M.N`.

---

## [2026.5.4] — 2026-05-09

### Added

- **Daily challenge widget (#852)** — new home tile picks one taxon per UTC day per user: region-filtered, rarity≤3, deterministic via md5 seed so the same challenge shows across devices. Progress dot fills when a matching observation is synced today. New `daily_challenge_for_user(uuid)` SECURITY DEFINER RPC. EN/ES i18n.
- **Observation suggestions on home (#710)** — "Go find these" widget shows up to 5 species near the user's location that they haven't observed yet, ranked by nearby platform activity. Uses `suggest_nearby_species()` RPC with PostGIS `ST_DWithin`, season filter (month ± 1 with wraparound), and per-card dismiss via sessionStorage. 6 unit tests.
- **Leaderboard top-3 + badge-progress widgets (#853)** — two new home tiles: top-3 observers this week (from `karma_leaderboard_30d` MV) and closest-unearned badge with progress bar. Signed-in only.
- **Weather condition in greeting (#854)** — greeting widget now appends a live weather phrase ("Está lloviendo en Oaxaca") from Open-Meteo, cached 30 min in localStorage. Falls back gracefully when coords unavailable. 17 unit tests covering WMO bucket mapping and cache TTL.
- **Kairos push triggers (#798 #799 #800)** — three new contextual notification types: **after_rain** (≥5 mm rainfall in last 12h at user's last-obs geohash5, from `weather_snapshots`), **migration_window** (today's DOY is within a seasonal migration window for user's region, seeded with 4 MX windows), **lunar_event** (full moon / new moon / total lunar eclipse today in user's timezone, using Jean Meeus ch.49 algorithm ±2h accuracy). All share the 1/day cap with golden_hour. Kairos now has 4 active triggers.
- **Granular notification preferences (#870)** — per-trigger opt-in page at `/profile/notifications` lets users enable/disable each kairos trigger individually. Toggle state persisted in `kairos_subscriptions` table.
- **KarmaFrame on 5 avatar surfaces (#859)** — tier ring now visible on public profile hero (animated), header dropdown, leaderboard rows, community observer cards, and comment author avatars. `size='sm'` uses static ring (no animation) for dense list contexts — Option C from #861 architecture decision.
- **Like + follow inline from recents (#709)** — ❤️ fave button and Follow/Following/Requested toggle directly on observation cards in ExploreRecentView. Optimistic updates with error revert on both actions. Batch-prefetch of viewer's fave/follow state on load.
- **Recents list / map / timeline modes (#863)** — three new view modes alongside the existing cards/grid: compact **list** rows, **map** (lazy MapLibre with cluster pins), and **timeline** (grouped by UTC day with sticky headers). All persist via localStorage + URL `?view=`.
- **Region scope on leaderboard (#860 #862)** — "Region" third scope option with country picker (countries with ≥3 observers). URL sync (`?scope=region&country=MX`). Switching to Friends clears the country selection; switching back restores it.
- **Exposure slider in PhotoCropModal (#857)** — third slider (−100..+100) maps to a second `brightness()` CSS filter multiplier (0.5×–1.5×), rescuing underexposed shots. `buildFilterString()` extended; 4 new unit tests.
- **Auto-enhance preset (#856)** — "✨ Auto" button applies brightness=+20, contrast=+15 in one tap; deactivates when user manually adjusts either slider.
- **Globetrotter badge (#867)** — new `silver` badge for observing in ≥2 countries. `observations.country_code` column added with BEFORE INSERT/UPDATE trigger `fill_observation_country_code()` from `places` geometry, idempotent backfill, and `badge_eligible_country_diversity()` predicate.
- **Onboarding funnel + PostHog instrumentation (#878)** — `docs/runbooks/onboarding-funnel.md` documents 7 milestones. Client-side events: `onboarding:signed_up` (auth callback, first-time), `onboarding:first_observation` (sync.ts), `onboarding:first_follow` (social.ts). `cohortWeek()` + `daysSince()` helpers with 11 unit tests.
- **Taxon-conditional photo praise (#810)** — post-cascade praise messages are now scoped to the identified taxon's kingdom/class (bird → "Sharp focus on plumage", insect → "Macro detail captured", etc.) instead of generic text.
- **Distinct-species live stats RPC (#812)** — `count_distinct_species_synced()` SECURITY DEFINER function powers the `/about` live stats counter.

### Changed

- **Chat improvements (#908)** — Gemma 4 text model wired, entity context cards for observations/taxa/projects/users, mobile drawer fix. Fixed `observations.region_primary` column reference (doesn't exist — use `state_province`) and `is_research_grade` join via identifications.
- **KarmaFrame `size='sm'` contract (#861)** — architectural decision: KarmaFrame is now the canonical avatar component everywhere; `size='sm'` renders static ring (no motion animations) for performance on dense lists.

### Fixed

- **Profile: watchlist 404 + user_expertise 400 on Android Chrome (#698 #699)** — `.from('watchlist_entries')` → `.from('watchlists')`; `.select('taxon_count')` (non-existent column) → `count: exact` on `user_expertise` rows.
- **Taxon filter chips had no visible effect (#784)** — `hideAllIdStates()` now resets `gemmaOffer`; `filterRunnersByHint` pre-applied before `runParallelIdentify` so `describeAllFailed` receives accurate `hadPlantNet` flag and shows targeted "taxon filter skipped PlantNet" message.
- **HomeWidgets production 400 (#906)** — hotfix stripping problematic widget causing server error.
- **Stray `HEAD` markers in schema/rls.sql/kairos-fire (#911)** — bad conflict resolution artifacts removed.

### Security

- **RLS test for `follows` table (#858)** — 3 assertions covering viewer-only pending edges, accepted-edge visibility (by design public), and symmetric followee path.
- **Cargo clippy + fmt in Tauri CI (#872)** — new `rust-lint.yml` workflow, path-filtered to `src-tauri/**`, zero-warnings policy.

### Tests

- **E2E: greeting time-bucket (#864)** — 8 Playwright tests (4 buckets × 2 locales) with `addInitScript` Date mock; `data-testid="home-greeting"` anchor added.

---

## [2026.5.3] — 2026-05-09

### Added

- **Personalized home widgets (#704)** — `/{en,es}/` home page now renders three signed-in widgets above the existing hero: a time-of-day greeting (`madrugada` / morning / afternoon / evening, EN+ES), a streak pill (hidden when 0), and a 3-up "Recent in your area" rail that falls back to a global feed when the user's country has no recent observations. New `src/lib/home-greeting.ts` is a pure helper covered by 12 unit tests on hour-bucket boundaries.
- **Karma-tier avatar frames (#702)** — `KarmaFrame.astro` wraps an avatar with one of six tiers — Seedling (0–99) / Observer (100–499) / Naturalist (500–999) / Expert (1000–4999) / Master (5000–9999) / Legend (10000+). Tier ring colour, glow, and animation are derived from `users.karma_total` via `tierForKarma()` (12 unit tests). Wired on `ProfileView`; PublicProfile / header / leaderboard rows are v1.1 follow-ups. All animations use `motion-safe:` to respect `prefers-reduced-motion`.
- **Photo editing in ObserveView2 (#787)** — the existing `PhotoCropModal` is now wired into the new Drop & Discover form via a per-thumbnail edit (✏️) button; on save the edited file replaces the pipeline file and re-triggers identification. Added brightness + contrast sliders (−100..+100, default 0, 44px touch target) applied via Canvas `filter` so the JPEG export matches the live preview. EN+ES i18n parity.
- **Recents view-mode switcher (#705)** — `/explore/recent` and `/explora/recientes` get a top-right toggle between **cards** (existing) and **grid** (2-col mobile / 3-col `md+`). Choice persists in `localStorage["rastrum.recents.viewMode"]`. Shared `ViewMode` type + helpers in `src/lib/recents-view-mode.ts` so future modes (list, map, timeline — v1.1) extend cleanly.
- **Karma leaderboard windows + scopes (#703)** — `/community/leaderboard` gains a window selector (Today / This week / This month / All time) and a scope selector (Global / Friends, the latter filtered by accepted edges in `follows`). URL-synced (`?window=…&scope=…`) plus `localStorage["rastrum.leaderboard.prefs"]`. Today/week ranking is now exact regardless of event volume — backed by a new `karma_leaderboard_window(p_since, p_limit, p_restrict_ids, p_country_code)` SECURITY DEFINER SQL function that does `GROUP BY user_id` + `ORDER BY SUM(delta) DESC` + `LIMIT` server-side, replacing the previous client-side aggregation over a 5000-row cap. Region scope is a v1.1 follow-up.
- **Badge catalogue extended (#701)** — four new badges via existing `award-badges` nightly cron: `streak_7`, `streak_30` (read `users.streak_current`), `state_explorer_3` (observations across ≥3 distinct `observations.state_province` values), and the hidden `midnight_owl` easter egg. Three new SECURITY DEFINER predicates (`badge_eligible_streak`, `badge_eligible_state_diversity`, `badge_eligible_midnight_observation`) follow the schema-security invariants: pinned `search_path`, `REVOKE EXECUTE … FROM PUBLIC`, `GRANT EXECUTE … TO service_role`. `midnight_owl` evaluates the hour in the observer's timezone (`COALESCE(users.timezone, 'UTC')`) so users in CDMX who observe at 1am local correctly qualify regardless of UTC offset.
- **Tauri v2 Android scaffold (#762)** — `src-tauri/` config, Cargo + Rust stubs, capabilities, and npm scripts (`tauri:dev`, `tauri:android:init|dev|build`) for packaging the static Astro PWA as a native Android app. Includes `.github/workflows/tauri-android.yml` (`workflow_dispatch`-only) for CI builds with documented NDK pin, plus `docs/runbooks/tauri-android.md` covering prereqs, signing, and Play Console upload. Detects the Tauri WebView at runtime via `window.__TAURI_INTERNALS__` so the PWA install banner doesn't render inside the wrapper. AAB builds require Rust + Android SDK locally — see runbook.

### Changed

- **Mobile bottom nav reordered (#706)** — new layout for signed-in users: `Home | Recents | [+ FAB] | Discover | Profile`. Recents is now the most thumb-accessible action; Discover replaces Explore in the rightmost slot, aliased provisionally to `/community/observers` (a dedicated personalized Discover feed is a v1.1 follow-up). FAB-shift behavior on `/observe` (→ `/identify` with "Quick ID" badge) is preserved.

### Fixed

- **`resumePipeline` no longer retries failed pipeline on reload (#786)** — `ObserveView2.resumePipeline` now treats `state.status='failed'` the same as `'done'` (shows the post-form directly, no retry). Prevents a reload loop when an underlying error like the Android Chrome gotrue auth lock persists across reloads.

---

## [2026.5.2] — 2026-05-07

### Added

- **Pokédex visual redesign (M34 Phase 2)** — `/perfil/dex/` rebuilt photo-first. New 3-tile hero on desktop (total + kingdoms/rares/obs/streak | rarest catch with gold ring | "Para cazar" suggestion in greyscale silhouette), collapses to 1-column stack below 820 px. Kingdom pill row acts as both stat strip and active filter (color-coded dot per kingdom). Cards switched to direction D — photo top + scientific name + common name + rarity/endemic/NOM-059 pill + meta line. First-visit owner state with CTA to `/observar`. Visitor mode hides tile 3. Backed by `suggest_pokedex_target(uuid)` SECURITY DEFINER RPC (auth.uid() enforced) and the extended `profile_pokedex` view (added thumbnail_url, common_name_es/en, slug, endemic_mx, nom059_status). (#650)
- **Especies catalog redesign (M34 Phase 2)** — `/explorar/especies/` index mode rebuilt with featured species hero + platform stats panel (species / observers / observations / +N this week) + composable filter chips (Endemics / NOM-059 / Rare / per-kingdom) with URL state. Buscar tab dropped — the always-visible search input on the grid panel covers it. Cards switched to direction D with thumbnails. When viewer is logged in, cards show a green ✓ overlay for species already in their dex. Backed by `featured_species_current` view (deterministic per ISO week), `mv_platform_stats` MV (hourly cron refresh), and `taxa_thumbnails` view. (#650)
- **`SpeciesCard` shared component family** — `src/components/species/{SpeciesCard,KingdomPills,FeaturedSpeciesCard,PlatformStats,EspeciesHero,FilterChips}.astro` plus the `renderSpeciesCard()` JS-string mirror in `src/lib/species-card-html.ts` so both client-rendered views (Pokédex, Especies grid) emit DOM-identical cards. Pure pill-priority resolver `pillForSpecies()` (rarity ≥ 4 → endemic → NOM-059 threatened → rarity = 3 → none) and chip URL-state serializer `parseChips/serializeChips/filterByChips` with 18 unit tests. (#650)

### Fixed

- **NOM-059 status comparisons** — `species-display.ts`, `species-filters.ts`, and the `featured_species_current` view all now use the actual short codes `'E' | 'A' | 'Pr'` (per the `taxa.nom059_status` CHECK constraint at line 177 of the schema) instead of long-form names that would never match real data. (#650)
- **`profile_pokedex` thumbnail lookup** — extended view exposes `thumbnail_url` via correlated subquery against the user's earliest synced primary observation per taxon. Filters out `obscure_level = 'private'` rows. Append-only column extension preserves existing column positions 1–7. (#650)
- **Schema apply ordering** — forward-declared `taxa.slug` ALTER inside the M34 banner so `db-validate.yml` top-to-bottom replay resolves slug references before the canonical ALTER at line 7032. (#650)

---

## [2026.5.1] — 2026-05-07

### Added

- **Taxon autocomplete** — live genus/species suggestions as you type in the identification field. Two-tier lookup: Rastrum taxa table first (LAC-relevant, with observation counts and user history), GBIF Species Suggest API as fallback. Debounced 300ms, max 8 results, session cache, accessible combobox with keyboard navigation (↑↓ Enter Escape). (#620)
- **Error badge on report FAB** — the floating report button now shows a red notification badge automatically when errors are captured: `console.error`, unhandled JS errors, promise rejections, failed network requests. Count shown (up to 99+). Badge clears when the user opens the report panel. (#624)
- **Species profile pages (M34 Phase 1)** — `/explore/species/[slug]` with taxonomy sunburst, search, hero photo voting, and best-shot auth guard. (#462, #469)
- **Places (M-Loc 1–5)** — protected areas as first-class objects: DB schema, WDPA import pipeline, `assign_place` trigger, place detail pages `/explore/places/[slug]`, place chip on observation detail, place index with near-me, map layer, comparison page, and autocomplete search. (#503–509)
- **Explore map** — clickable pins with thumbnail popups, cluster zoom, places GeoJSON layer, dark mode tiles. (#538, #536)
- **Pool dashboard** — sponsor pool analytics with top-taxa breakdown. (#533)
- **Karma system** — observation_synced + first_in_rastrum triggers, realtime toast notifications via Supabase Realtime, expandable breakdown tooltip, 30-day rolling leaderboard materialized view, karma section on public profiles. (#542–575)
- **Audio thumbnails** — interactive audio thumbnails across all listing views. (#540)
- **Media player** — unified player module across all surfaces; video engine added. (#572, #587)
- **AI Settings tab unification** — pipeline flow shows real cascade order with license badges; SpeciesNet download/manage card. (#594, #585)
- **Cascade trace** — `CascadeTrace` component for cascade decision visualization; cascade attempts exposed in API/CLI/MCP for trace replay; `onAttempt` callback wires live pipeline graph. (#584, #591, #592)
- **Chat hint integration** — `user_hint` inference and kingdom propagation across turns in identify chat. (#593)
- **ID retry worker** — background worker retries failed identifications via `idQueue`. (#588)
- **Unique primary identification** — one primary identification per observation enforced at DB level with upsert RPC. (#589)
- **Retry unidentified cron** — auto re-queue identify for dormant observations, scoped to dormant users and abandoned after 30 days. (#481, #590)
- **Camera station selector** — `camera_station_id` picker in ObservationForm. (#225)
- **Community donation page** — per-pool donation UI. (#247)
- **Community observer heatmap / map view**. (#160)
- **Push notifications** — streak reminder opt-in toggle + SW handler. (#188)
- **Sponsorships doc page** — AI sponsorships onboarding guidance. (#192)
- **Pool cost table** — cost-per-100-calls table in model picker. (#227)
- **Karma pool donations** — karma incentives for pool donors. (#228)
- **Cascade mode in identify Edge Function**. (#171)
- **SpeciesNet plugin** — distilled on-device animal classification. (#175)
- **Journey guides RC1** — spotlight positioning fixes, complete selectors. (#426–428)
- **SW faster update propagation** — 5min poll + auto-apply. (#514)
- **New logo** — jaguar paw on leaf. (#471)
- **Bug reporter enhancements** — capture `console.log` with `[rastrum]` prefix filter; inject app-version + build-sha meta tags. (#492, #429)
- **Ask my AI button** — on observation detail page, links observer name to profile. (#532)

### Fixed

- **Observe form — `Saving...` stuck** — `syncOutbox()` waited indefinitely on `navigator.locks` when lock was already held. Now fire-and-forget with `ifAvailable:true`; the persisted Dexie row is flushed on the next cycle. (#623)
- **Observe form — no toast on save** — success card was below the fold on mobile with no immediate feedback. Bottom toast now shown for 3s after save. (#623)
- **Observe form — species field hidden when AI returns no result** — `obs2-taxon-input` was inside a hidden container; when PlantNet returned 404 and no other model matched, users had no way to enter the species they knew. ID card now always visible in post-form. (#623)
- **PlantNet 404 logged as "Failed Requests"** — PlantNet 404 = "not a plant / no match" is an expected soft-fail. Now excluded from the network diagnostic log. (#623)
- **Photo delete button on mobile** — 24px touch target was unusable on touch screens. Bumped to 40px, added `active:bg-red-700` tap feedback and `touch-manipulation`. (#622)
- **Sync: `upsert_primary_identification` hang** — RPC could stall indefinitely under certain PostgREST conditions. Added 8s timeout. (#618, #619)
- **Sponsoring: vault decrypt** — routed through `SECURITY DEFINER` RPC; fixes Test button, heartbeat, and sponsor cascade. (#609)
- **Sponsoring: duplicate label 409** — friendly error + auto-focus rename on duplicate credential label. (#603)
- **Sponsoring: multi-provider credential detection** — trust caller-supplied `kind`; clearer auth-token errors. (#597)
- **Sponsoring: provider-agnostic probe** — un-dated `claude-haiku-4-5` alias + differentiate 401/403. (#598, #599)
- **Sponsoring: CORS preflight** — allow `x-http-method-override` + `PATCH`. (#569)
- **Sponsoring: various UI fixes** — dark mode dialogs, loading states, model defaults per provider, error surfaces, PKCE callback race. (#438–466)
- **Anon rate-limit** — persist in Postgres instead of isolate memory, preventing reset on cold start. (#605)
- **Identify EF** — quarantine non-binomial EfficientNet labels; unify `isPlantLike` helper; record sponsorship usage for all provider kinds. (#597–598)
- **Cascade build options** — extract `buildCascadeOptions` helper for unified cascade. (#600)
- **Location save** — use RPC instead of PATCH to bypass `jsonb→geography` cast; add implicit cast; EWKB hex parsing from PostgREST; update all map pickers after save. (#483–486, #494)
- **Manage panel** — remove `refreshSession()` before RPC (auth mutex deadlock); cap session refresh at 5s; remove duplicate `mappicker-save` listener; proper error serialization. (#487–493)
- **Obs detail** — sci name pre-fill; GPS button; `location_source` on update; graceful save when no prior identification; parse EWKB location. (#445–450, #473, #494)
- **Auth/onboarding** — PKCE-verifier race + skip privacy step when already set. (#570)
- **Explore map** — `location_obscured` fallback for sensitive observations; missing Projects card. (#531, #444)
- **Species grid** — skeleton stuck visible after data loads. (#549)
- **Community map** — expose `centroid_lat/lng`; `karma_total` column order. (#545, #547)
- **Places** — fix stuck loading on index; nested zip extraction for WDPA; updated WDPA download URL. (#506, #510–513)
- **Audio/video** — render audio player for audio observations in validation queue; correct MIME for MediaRecorder blobs. (#434, #437)
- **Schema** — `pool_top_taxa`/`pool_daily_usage` columns; `GRANT service_role` for sponsoring tables; `taxa` upsert on identify; backfill from existing identifications. (#443, #453, #475–477)
- **Build** — bash syntax error in version extraction step; missing `communityDonate` route. (#431, #535)

### Changed

- **Version scheme** — CalVer `YYYY.M.N` adopted; auto-generated from git at build time. (#422, #474)
- **Sponsoring** — provider-agnostic model: supports Bedrock, OpenAI, Azure OpenAI, Gemini, Vertex AI in addition to Anthropic direct. (#455–461)
- **Pipeline graph** — reflects real cascade attempts live via `onAttempt` callback. (#592)
- **SW update** — bumped to 2026.5.1, forces cache refresh. (#472)
- **Logo** — claw marks removed from jaguar track for authenticity. (#502)

---

## [2026.5.0] — 2026-04-xx

Initial CalVer release. See git history for earlier changes.
