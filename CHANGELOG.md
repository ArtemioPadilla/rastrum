# Changelog

All notable changes to Rastrum are documented here.
Format follows [Keep a Changelog](https://keepachangelog.com/en/1.0.0/).
Versions use CalVer `YYYY.M.N`.

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
