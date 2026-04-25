# Module Index

Implementation specs are sliced from the monolithic [`rastrum-v1.md`](../rastrum-v1.md)
vision document into focused, build-ready module specs. This index tracks every
module that has been scoped or is planned, its target version, and whether a
dedicated spec file exists yet.

When `rastrum-v1.md` and a module spec disagree, the **module spec wins** — it's
the canonical implementation reference. The monolithic spec is the vision &
narrative source.

---

## Legend

- **Status**
  - `spec`     — module spec exists at `modules/NN-*.md`
  - `draft`    — spec file exists but is incomplete
  - `planned`  — described in `rastrum-v1.md` only; no dedicated spec yet
- **Target** — the version in which the module is scheduled to ship
  (see [`docs/progress.json`](../../progress.json) for the phase schedule).

---

## Shipped & v0.1 scope (online-first MVP)

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 01 | Photo ID pipeline (PlantNet + Claude Haiku cascade) | v0.1 | spec | [`01-photo-id.md`](01-photo-id.md) |
| 02 | Observation form & GPS | v0.1 | spec | [`02-observation.md`](02-observation.md) |
| 03 | Offline-first / PWA / sync (outbox; ID deferred to v0.3) | v0.1 | spec | [`03-offline.md`](03-offline.md) |
| 04 | Authentication (magic link + guest mode) | v0.1 | spec | [`04-auth.md`](04-auth.md) |
| 05 | Map view (MapLibre + pmtiles) | v0.1 | spec | [`05-map.md`](05-map.md) |
| 06 | Darwin Core export (CSV + SNIB + CONANP presets) | v0.1 | **shipped** | [`06-darwin-core.md`](06-darwin-core.md) |
| 07 | Licensing, ML training gates, governance | v0.1 policy → v2.0 enforcement | spec | [`07-licensing.md`](07-licensing.md) |
| 08 | Profile, activity feed, badges, streaks, events | v0.1 → v1.0 (staged) | **shipped (v0.1, v0.3, v0.5, v1.0 slices)** | [`08-profile-activity-gamification.md`](08-profile-activity-gamification.md) |
| 10 | Media storage (R2 + presigned URLs + CDN) | v0.1 → v0.3 migration | spec | [`10-media-storage.md`](10-media-storage.md) |
| 11 | In-browser AI (WebLLM: Phi-3.5-vision + Llama-3.2-1B) | v0.3 → v0.5 | **shipped (opt-in)** | [`11-in-browser-ai.md`](11-in-browser-ai.md) |

## v0.3 — Offline intelligence

Module 08 extends here with `activity_events` + activity feed UI — see 08 spec § v0.3.

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 09 | On-device ONNX ID (EfficientNet-Lite0 base) | v0.3 | planned | — |
| 10 | Offline map tile download (Mexico pmtiles) | v0.3 | planned | — |
| 11 | EXIF/XMP/ID3 auto-extraction | v0.3 | planned | — |
| 12 | NOM-059 / CITES obscuration grid enforcement | v0.3 | planned | — |

## v0.5 — Beta

Module 08 extends here with badges + quality gates + anti-sybil CHECK — see 08 spec § v0.5.

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 13 | BirdNET audio ID (requires Cornell commercial license) | v0.5 | planned | — |
| 14 | Multi-image observations | v0.5 | planned | — |
| 15 | Ecological evidence fields (tracks, scat, substrate) | v0.5 | planned | — |
| 16 | Rastrum Scout v0 (conversational, pgvector RAG) | v0.5 | planned | — |
| 17 | Research-grade consensus (2/3 identifier workflow) | v0.5 | planned | — |
| 18 | Regional ONNX packs (Oaxaca, Yucatán) | v0.5 | planned | — |
| 19 | GBIF IPT pilot + Darwin Core Archive ZIP | v0.5 | planned | — |
| 20 | Local Contexts BC/TK Notices integration | v0.5 | planned | — |

## v1.0 — Public launch

Module 08 extends here with streaks + BioBlitz + shareables + social features — see 08 spec § v1.0.
The previous line items "Opt-in gamification" and "Community profiles / badges / BioBlitz events"
are now wholly covered by module 08 and are removed from this phase.

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 21 | Camera trap ingestion (SpeciesNet + MegaDetector) | v1.0 | planned | — |
| 22 | Video support (≤30 s, H.265/AV1) | v1.0 | planned | — |
| 23 | Institutional exports (MIA, SNIB, CONANP, INAH) | v1.0 | planned | — |
| 24 | Credentialed researcher access tier | v1.0 | planned | — |
| 25 | Environmental enrichment (lunar, weather, NDVI) | v1.0 | planned | — |
| 26 | Capacitor iOS wrapper | v1.2 | planned | — |

## v1.5 — Territory layer (parallel to v1.0)

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 27 | Biodiversity Trails (GPS waypoints + diversity metrics) | v1.5 | planned | — |
| 28 | PITs + QR/NFC anchors (Puntos de Información Territorial) | v1.5 | planned | — |
| 29 | Spatial analysis (ANP/INEGI/INAH GeoJSON layers) | v1.5 | planned | — |
| 30 | Diversity indices (S, H′, D, Chao1, Pielou J) | v1.5 | planned | — |
| 31 | Trail PDF export (field-guide style) | v1.5 | planned | — |

## v2.0 — Institutional

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 32 | Camera trap advanced (occupancy, activity histograms) | v2.0 | planned | — |
| 33 | GBIF publisher + DOI generation | v2.0 | planned | — |
| 34 | Regional ML training pipeline (see module 07 for gates) | v2.0 | planned | — |
| 35 | B2G dashboard (CONANP / state agencies) | v2.0 | planned | — |
| 36 | iNaturalist import/export bridge | v2.0 | planned | — |

## v2.5 — AI + AR

| # | Module | Target | Status | Spec |
|---|---|---|---|---|
| 37 | Rastrum Scout full (conversational field AI) | v2.5 | planned | — |
| 38 | AR species overlay | v2.5 | planned | — |
| 39 | Indigenous language voice I/O | v2.5 | planned | — |
| 40 | CONABIO / CONANP / INAH partnership APIs | v2.5 | planned | — |

---

## Infra & cross-cutting

| Doc | Purpose |
|---|---|
| [`infra/supabase-schema.sql`](../infra/supabase-schema.sql) | Canonical v0.1 schema |
| [`infra/future-migrations.md`](../infra/future-migrations.md) | Deferred schema changes (partitioning, pgvector, …) |
| [`infra/testing.md`](../infra/testing.md) | Test pyramid, RLS pgTAP, Lighthouse budgets |
| [`infra/github-actions.yml`](../infra/github-actions.yml) | CI workflow |

---

## How to add a new module spec

1. Claim the next `NN-*.md` slot from the tables above.
2. Copy the structure of an existing spec (`01-photo-id.md` is a good template).
3. Include: **Overview → Data model → APIs / logic → Edge cases → Cost / risk
   notes → Data stored**.
4. Link from this index and from any module it depends on.
5. If the new module duplicates a narrative section in `rastrum-v1.md`, trim the
   duplicate from the monolithic spec and leave a pointer to the module spec.
