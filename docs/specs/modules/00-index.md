# Module Index

> Last full doc sync: 2026-04-26 (v1.0 shipped).

Implementation specs are sliced from the monolithic [`rastrum-v1.md`](../rastrum-v1.md)
vision document into focused, build-ready module specs. This index tracks every
module that has a dedicated spec file, its target version, and its current
implementation status against the live codebase.

When `rastrum-v1.md` and a module spec disagree, the **module spec wins** — it's
the canonical implementation reference. The monolithic spec is the vision &
narrative source.

---

## Legend

- **Status**
  - `shipped`  — feature is live in production (`https://rastrum.org`).
  - `partial`  — code shipped but operator action (model weights, license,
    DNS) is required to fully activate.
  - `planned`  — spec exists, code not yet started or stubbed only.
  - `deferred` — spec exists, scheduled for a later phase.
- **Target** — the version in which the module is scheduled to ship
  (see [`docs/progress.json`](../../progress.json) for the phase schedule).

> The index is grouped by phase. Each row links to the spec file. File
> numbers reflect the actual filename on disk; gaps and the duplicated
> `15-*.md` are historical (`15-map-location-picker.md` was claimed first,
> then `15-mcp-server.md` shipped under the same number — see the note
> below the table). 26 module specs are tracked here today.

---

## v0.1 — Alpha MVP (online-first) — shipped

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 01 | Photo ID Pipeline (PlantNet → Claude Haiku cascade) | v0.1 | shipped | [`01-photo-id.md`](01-photo-id.md) |
| 02 | Observation Form & GPS | v0.1 | shipped | [`02-observation.md`](02-observation.md) |
| 03 | Offline-First / PWA / Sync | v0.1 | shipped | [`03-offline.md`](03-offline.md) |
| 04 | Authentication (magic link, OTP, OAuth, passkey) | v0.1 | shipped | [`04-auth.md`](04-auth.md) |
| 05 | Map View (MapLibre + observations layer) | v0.1 | shipped | [`05-map.md`](05-map.md) |
| 06 | Darwin Core Export (CSV + SNIB + CONANP presets) | v0.1 | shipped | [`06-darwin-core.md`](06-darwin-core.md) |
| 07 | Licensing, ML Training Gates & Data Governance | v0.1 policy → v2.0 enforcement | shipped (policy + per-record license; ML gate at v2.0) | [`07-licensing.md`](07-licensing.md) |
| 10 | Media Storage (Cloudflare R2 + CDN) | v0.1 | shipped | [`10-media-storage.md`](10-media-storage.md) |

## v0.3 — Offline intelligence + activity — partially shipped

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 08 | Profile, Activity & Gamification (staged across v0.1–v1.0) | v0.1 → v1.0 | shipped (all four slices) | [`08-profile-activity-gamification.md`](08-profile-activity-gamification.md) |
| 11 | In-Browser AI (WebLLM Phi-3.5-vision + Llama-3.2-1B) | v0.3 → v0.5 | shipped | [`11-in-browser-ai.md`](11-in-browser-ai.md) |

## v0.5 — Beta — partially shipped

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 12 | BirdNET Audio ID (Cornell Lab, NC license) | v0.5 → v1.0 | shipped (BirdNET-Lite ONNX, weights on R2) | [`12-birdnet-audio.md`](12-birdnet-audio.md) |
| 13 | Identifier Registry (plugin platform) | v0.5 | shipped (7 plugins registered) | [`13-identifier-registry.md`](13-identifier-registry.md) |
| 14 | User API Tokens (`rst_*`, scoped, SHA-256 hashed) | v0.5 | shipped | [`14-user-api-tokens.md`](14-user-api-tokens.md) |

## v1.0 — Public launch — shipped

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 09 | Camera Trap Analysis (MegaDetector + SpeciesNet) | v1.0 | partial (UI + plugin stub shipped; weights operator-hosted) | [`09-camera-trap.md`](09-camera-trap.md) |
| 15 | Map Location Picker (drag pin, search locality) | v1.0 | shipped | [`15-map-location-picker.md`](15-map-location-picker.md) |
| 15 | MCP Server (JSON-RPC over HTTP for AI agents) | v1.0 | shipped | [`15-mcp-server.md`](15-mcp-server.md) |
| 16 | My Observations (personal history page) | v1.0 | shipped | [`16-my-observations.md`](16-my-observations.md) |
| 17 | In-App Camera (`getUserMedia`) | v1.0 | shipped | [`17-in-app-camera.md`](17-in-app-camera.md) |
| 18 | Onboarding Flow | v1.0 | shipped | [`18-onboarding.md`](18-onboarding.md) |
| 19 | Batch Photo Importer (Google Photos / Drive / file upload) | v1.0 | shipped | [`19-batch-photo-importer.md`](19-batch-photo-importer.md) |
| 20 | Conversational Chat (cascade interpreter + vision fallback) | v1.0 | shipped | [`20-chat.md`](20-chat.md) |
| 21 | Identify (no-save quick PlantNet probe) | v1.0 | shipped | [`21-identify.md`](21-identify.md) |
| 22 | Community Validation (expert ID queue + research-grade auto-promotion) | v1.1 | shipped (spec v1.3 + impl) | [`22-community-validation.md`](22-community-validation.md) |
| 23 | Karma + per-taxon expertise + rarity-weighted rewards | v1.1 | partial (Phase 1 shipped; Phases 2–3 deferred) | [`23-karma-expertise-rarity.md`](23-karma-expertise-rarity.md) |
| 24 | Admin / Moderator / Expert Console | v1.1 → v1.2 | partial (PR1 foundation shipping) | [`24-admin-console.md`](24-admin-console.md) |

## v1.2 — Profile privacy & public profile — shipped

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 25 | Profile Privacy & Public Profile (per-facet matrix + `/u/<username>/`) | v1.2 | shipped (v1.2.0 + v1.2.1 merged 2026-04-28; v1.2.2 cleanup deferred) | [`25-profile-privacy.md`](25-profile-privacy.md) |
| 26 | Social graph + reactions (follows, reactions, blocks, reports, notifications) | v1.2 | shipped 2026-04-28 (PR #43 schema + Edge Functions; PRs #63 + #64 UI integration; PR #101 v1.1 follow-ups) | [`26-social-graph.md`](26-social-graph.md) |
| 27 | AI Sponsorships (share Anthropic credentials with beneficiaries) | v1.3 | shipped 2026-04-28 (PRs #78 core + #84 UX polish + #94 cobertura completa) | [`27-ai-sponsorships.md`](27-ai-sponsorships.md) |
| 28 | Community discovery (observers page, leaderboards, nearby, experts, country filter) | v1.2 | shipped 2026-04-29 (PR1 #92 + PR2 #96 + PR4 #102 + PR5+PR6 atomic landing; PR3 manual cron fire = operator action) | [`28-community-discovery.md`](28-community-discovery.md) |

## v1.5 — Territory layer — planned

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 24 | Diversity Indices & Spatial Analytics (Shannon, Simpson, Hill numbers, ANPs, municipios) | v1.5 | planned (spec v1.0) | [`24-diversity-indices.md`](24-diversity-indices.md) |

> **Numbering note.** Two specs share the `15-` prefix:
> [`15-map-location-picker.md`](15-map-location-picker.md) was claimed first
> during the v1.0 push, then [`15-mcp-server.md`](15-mcp-server.md) shipped
> under the same number. Both are real, both reference each other from
> consuming specs. New specs should claim the next free number (`26`+).

---

## Planned but unscoped

The roadmap items below are tracked in
[`docs/progress.json`](../../progress.json) but have no dedicated module
spec yet. Most are blocked on external dependencies (Cornell BirdNET
commercial license, GBIF publisher account, Apple Developer Program,
ML training pipeline) rather than waiting on engineering capacity.

| Roadmap item | Target | Blocker |
|---|---|---|
| `scout-v0` (conversational ID, pgvector RAG) | v0.5 | pgvector + embedding corpus |
| `gbif-ipt` (GBIF IPT pilot) | v0.5 | GBIF publisher account; DwC-A generator already shipped |
| `local-contexts` (BC/TK Notice integration) | v0.5 + governance | community consent before code |
| `video-support` (≤30 s, H.265/AV1) | v1.0 | ✅ shipped (per progress.json) — spec stub welcome |
| `oauth-custom-domain` (`auth.rastrum.org`) | v1.0 | Supabase Pro $25/mo (deferred for zero-cost target) |
| `capacitor-ios` (App Store wrapper) | v1.2 | Apple Developer Program $99/yr |
| `biodiversity-trails`, `pits-qr`, `trail-pdf-export` | v1.5 | future spec (`spatial-analysis` + `diversity-indices` now live as module 24) |
| `camera-trap-advanced`, `gbif-publisher`, `regional-ml`, `b2g-dashboard`, `inat-bridge` | v2.0 | future spec |
| `scout-full`, `ar-overlay`, `voice-indigenous`, `conabio-api` | v2.5 | future spec |

---

## Infra & cross-cutting

| Doc | Purpose |
|---|---|
| [`infra/supabase-schema.sql`](../infra/supabase-schema.sql) | Canonical idempotent schema |
| [`infra/seed-badges.sql`](../infra/seed-badges.sql) | 39-badge multilingual seed |
| [`infra/cron-schedules.sql`](../infra/cron-schedules.sql) | `pg_cron` schedules for nightly Edge Functions |
| [`infra/cron-test.sql`](../infra/cron-test.sql) | One-shot cron job verification |
| [`infra/future-migrations.md`](../infra/future-migrations.md) | Deferred schema changes (partitioning, pgvector, …) |
| [`infra/testing.md`](../infra/testing.md) | Test pyramid, RLS pgTAP, Lighthouse budgets |
| [`infra/github-actions.yml`](../infra/github-actions.yml) | Reference CI workflow |
| [`../architecture.md`](../architecture.md) | High-level architecture across modules |
| [`../gbif-ipt.md`](../gbif-ipt.md) | Operator notes for publishing to GBIF via IPT |

---

## How to add a new module spec

1. Claim the next free `NN-*.md` slot (currently `29-`).
2. Copy the structure of an existing spec
   (`01-photo-id.md` is a good template).
3. Include: **Overview → Data model → APIs / logic → Edge cases → Cost / risk
   notes → Data stored**.
4. Link from this index and from any module it depends on.
5. If the new module duplicates a narrative section in `rastrum-v1.md`,
   trim the duplicate from the monolithic spec and leave a pointer to the
   module spec.
