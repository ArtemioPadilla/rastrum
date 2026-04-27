# Rastrum

**Open-source species identification for plants, animals, fungi, and ecological evidence.**

[![CI](https://img.shields.io/github/actions/workflow/status/ArtemioPadilla/rastrum/ci.yml?branch=main&label=ci)](https://github.com/ArtemioPadilla/rastrum/actions/workflows/ci.yml)
[![Deploy](https://img.shields.io/github/actions/workflow/status/ArtemioPadilla/rastrum/deploy.yml?branch=main&label=deploy)](https://github.com/ArtemioPadilla/rastrum/actions/workflows/deploy.yml)
[![Tests](https://img.shields.io/badge/tests-225%20passing-brightgreen.svg)](https://github.com/ArtemioPadilla/rastrum/actions)
[![License: MIT](https://img.shields.io/badge/license-MIT-green.svg)](LICENSE)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ArtemioPadilla/rastrum/pulls)

**Live demo:** [rastrum.org](https://rastrum.org) — bilingual EN/ES PWA with offline drafts, camera capture, and a photo-ID cascade running on free-tier infrastructure.

---

## About

Rastrum is a biodiversity observation platform that combines computer vision, audio analysis, and expert curation to identify species from photos, videos, audio recordings, and indirect evidence such as tracks, scat, and burrows. It is designed for naturalists, field biologists, citizen scientists, and anyone curious about the species around them.

The platform emphasizes regional biodiversity. Rather than training a single global model, Rastrum aims to build region-specific datasets that improve identification accuracy for local ecosystems, starting with the flora and fauna of Latin America and the Caribbean. Observations are GPS-tagged, time-stamped, and Darwin Core compatible so they can flow into ecological monitoring and GBIF.

Rastrum is fully open source under the MIT license. The frontend ships as a static Progressive Web App, and the backend runs on Supabase + Cloudflare R2, keeping infrastructure costs low and making self-hosting straightforward.

## Features

### Photo Identification

Upload a photo of a plant, animal, or fungus and receive ranked species suggestions powered by an ensemble pipeline (PlantNet, BirdNET-Lite, EfficientNet-Lite0 ONNX, and Claude Haiku vision, with WebLLM Phi-3.5-vision as an in-browser fallback). The system also accepts photos of indirect evidence — tracks, scat, burrows, nests, and feeding signs — and routes them through a specialized identification flow.

### Audio Identification

Record or upload audio clips of bird calls, frog calls, insect sounds, and other vocalizations. The audio pipeline runs BirdNET-Lite (ONNX, served from R2) directly in the browser to return species matches with confidence scores.

### Camera Trap Ingestion

Bulk-upload camera trap batches with EXIF timestamp clustering. The pipeline funnels through MegaDetector v5 + SpeciesNet (operator-hosted endpoint via `PUBLIC_MEGADETECTOR_ENDPOINT`) and stitches results into per-deployment summaries.

### Ecological Evidence

Rastrum supports evidence types that traditional ID apps ignore: footprints, scat morphology, burrow architecture, scratch marks, nests, feathers, bones, and audio. These observations feed into the same consensus + expert-validation flow as direct sightings.

### Observation Log

Every submission is saved as a structured observation with GPS coordinates, timestamp, media files, and identification history. Observations appear on a personal timeline (`/profile/observations/`) and on the global explore map.

### Expert Curation

Verified experts can review pending identifications, confirm or correct species assignments, and annotate observations with ecological notes. The validation system tracks weighted agreement (expert × 3) and flags conflicts. Research-grade promotes when ≥ 2 / 3 weighted consensus is reached.

### Species Pages

Each identified species links to a dedicated page with taxonomy, common names (English and Spanish), distribution maps built from community observations, and reference media.

### Offline Mode

The PWA shell caches static assets for offline use. Drafts queue in a Dexie IndexedDB outbox and sync automatically when connectivity returns. The Mexico pmtiles archive is served from R2 (`PUBLIC_PMTILES_MX_URL`) so the explore map works offline once visited.

### Export

Observations export as Darwin Core CSV (with SNIB and CONANP column presets) or as a Darwin Core Archive ZIP for GBIF IPT publishers. Sensitive species (NOM-059 / CITES) ship with obscured coordinates per RLS policy.

### REST API + MCP for AI agents

Personal `rst_*` tokens authenticate two parallel surfaces:

- **REST API** at `/functions/v1/api/*` for shell scripts and curl.
- **MCP server** at `/functions/v1/mcp` (JSON-RPC 2.0 over HTTP) for
  Claude Desktop, Cursor, and GitHub Copilot Coding Agent.

Both gate on the same scope strings (`observe`, `identify`, `export`).

## Tech Stack

| Component | Technology | Purpose |
| --- | --- | --- |
| Framework | Astro 5.x | Static site generation, island architecture |
| Styling | Tailwind CSS 3.x | Utility-first CSS |
| Hosting | GitHub Pages | Static deployment at `rastrum.org` |
| Database | Supabase (PostgreSQL + PostGIS) | Observations, taxa, users, media metadata, RLS |
| Auth | Supabase Auth | Magic link, OTP, OAuth (Google + GitHub), passkey |
| Edge Functions | Supabase Edge Functions (Deno) | identify, enrich-environment, recompute-streaks, award-badges, share-card, get-upload-url, export-dwca, api, mcp |
| Media storage | Cloudflare R2 | Photos, audio, video blobs (S3-compatible, zero egress) |
| Map | MapLibre + pmtiles (`PUBLIC_PMTILES_MX_URL`) | Offline-capable vector tiles, MX archive on R2 |
| Photo ID — cloud | PlantNet API + Claude Haiku 4.5 | Plant/fungus + general species ID |
| Photo ID — on-device | EfficientNet-Lite0 ONNX (`onnxruntime-web`) | Offline-first base classifier |
| Photo ID — in-browser LLM | WebLLM Phi-3.5-vision-instruct | Fallback when no cloud key |
| Translation / field notes | WebLLM Llama-3.2-1B | Local translation + auto-narrative |
| Audio ID | BirdNET-Lite ONNX (Cornell Lab, NC license) | Bird vocalization classification |
| Camera trap | MegaDetector v5 + SpeciesNet | Operator-hosted endpoint |
| Sharing | OG card Edge Function | `/share/obs/{id}` social cards |
| MCP server | JSON-RPC 2.0 over HTTP | AI-agent access to user data |
| Outbox | Dexie (IndexedDB) | Offline-first observation queue |
| Sitemap | `@astrojs/sitemap` | SEO sitemap generation |
| i18n | Astro i18n routing | English and Spanish, EN/ES parity enforced |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22.12.0
- npm (ships with Node)

### Installation

```bash
git clone https://github.com/ArtemioPadilla/rastrum.git
cd rastrum
npm install
```

### Development server

```bash
npm run dev
```

The site will be available at <http://localhost:4321>.

### Production build

```bash
npm run build
npm run preview   # preview the build locally
```

### Tests

```bash
npm run typecheck   # tsc --noEmit
npm run test        # vitest run (225 tests today)
npm run test:e2e    # Playwright on chromium + mobile-chrome
npm run test:lhci   # Lighthouse CI against ./dist
npm run test:audit  # build + e2e + lhci
```

### Environment variables

Create a `.env` file in the project root. The static landing pages work without these; identification and observation features need a Supabase project + R2 bucket. See [`AGENTS.md`](AGENTS.md) for the full convention map.

```dotenv
# Public (shipped to client)
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
PUBLIC_R2_MEDIA_URL=https://media.rastrum.org
PUBLIC_R2_TILES_URL=https://tiles.rastrum.org

# Optional client-side AI / map assets (R2-hosted)
PUBLIC_BIRDNET_WEIGHTS_URL=https://media.rastrum.org/models/birdnet-lite-v2.4.onnx
PUBLIC_ONNX_BASE_URL=https://media.rastrum.org/models/efficientnet-lite0-int8.onnx
PUBLIC_PMTILES_MX_URL=https://media.rastrum.org/tiles/mexico-overview-v1.pmtiles
PUBLIC_MEGADETECTOR_ENDPOINT=https://your-endpoint.example.com/megadetector
PUBLIC_PLANTNET_KEY=your-plantnet-key      # optional: client-side PlantNet calls
PUBLIC_BUILD_SHA=                          # injected by CI

# Server-side only (Supabase Edge Function secrets)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PLANTNET_API_KEY=your-plantnet-key
ANTHROPIC_API_KEY=your-anthropic-key       # optional — users can BYO via the UI
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret
```

## Project Structure

The repository tree is documented in [`AGENTS.md`](AGENTS.md). Highlights:

- `src/components/*View.astro` — shared per-feature views (one per locale pair).
- `src/lib/identifiers/` — plugin platform; one file per cloud or on-device model.
- `supabase/functions/<name>/` — Deno Edge Functions, deployed via CI.
- `docs/specs/modules/` — module specs (see [`00-index.md`](docs/specs/modules/00-index.md)).
- `docs/architecture.md` — high-level architecture overview.

## REST API & MCP server

Personal API tokens (`rst_*`, scoped, SHA-256 hashed) authenticate two
parallel surfaces:

- **REST API** at `/functions/v1/api/*` — request/response endpoints for
  shell scripts and curl. See [`docs/specs/modules/14-user-api-tokens.md`](docs/specs/modules/14-user-api-tokens.md).
- **MCP server** at `/functions/v1/mcp` — JSON-RPC 2.0 over HTTP for AI
  agents (Claude Desktop, Cursor, Copilot Coding Agent). See
  [`docs/specs/modules/15-mcp-server.md`](docs/specs/modules/15-mcp-server.md).

Issue tokens at <https://rastrum.org/en/profile/tokens>. Both surfaces
gate on the same scope strings (`observe`, `identify`, `export`).

## For AI agents

This repo is heavily AI-assistive. Conventions and pitfalls are
documented for any LLM coding agent working on the codebase:

- [`AGENTS.md`](AGENTS.md) — primary briefing (Astro JSX `Record<…>`
  rule, EN/ES parity, identifier plugin contract, RLS invariants,
  pre-PR checklist).
- [`CLAUDE.md`](CLAUDE.md) — kept in lockstep with `AGENTS.md`.
- [`docs/specs/modules/15-mcp-server.md`](docs/specs/modules/15-mcp-server.md) —
  agent-facing MCP server. The same `rst_*` token an end-user uses for
  curl scripts works for AI agents reading and writing through the MCP
  surface.
- [`skills/rastrum/SKILL.md`](skills/rastrum/SKILL.md) — Claude Code
  skill for testing the photo ID pipeline + processing field data.

## Roadmap

The roadmap below mirrors [`docs/progress.json`](docs/progress.json).
Phase status reflects what's actually shipped to `https://rastrum.org`
as of 2026-04-26.

| Version | Period | Status | Highlights |
| --- | --- | --- | --- |
| v0.1 | Months 1–3 | shipped | Astro + Tailwind + i18n; Supabase schema + PostGIS + RLS; magic-link / OAuth / OTP / passkey auth; observation form + GPS + EXIF; PlantNet → Claude Haiku photo ID; MapLibre map; Darwin Core CSV; PWA + Dexie outbox; CI/CD |
| v0.3 | Months 4–5 | shipped (2 blocked) | Activity feed + unread badge; NOM-059 obscuration; WebLLM Llama-3.2-1B; WebLLM as default fallback; visible identification block in form; two-pass GPS; sensitive privacy notice |
| v0.5 | Months 6–8 | shipped (3 blocked) | Multi-image obs; ecological evidence types; 39 seed badges + nightly evaluator; WebLLM Phi-3.5-vision; quality gates ≥ 0.4; consensus 2 / 3 weighted; per-plugin BYO API keys; user API tokens (`rst_*`) + REST API + token UI |
| v1.0 | Months 9–14 | shipped (3 open) | Streaks; share OG cards; follows / comments / watchlists schema + UI; expert weighting; events; institutional CSV presets; credentialed-researcher RLS; environmental enrichment (lunar + OpenMeteo); BirdNET-Lite + EfficientNet-Lite0 + pmtiles MX + MegaDetector all hosted on R2; MCP server; map location picker; my observations page; in-app camera; batch photo importer; **domain migration to `rastrum.org`** |
| v1.5 | Months 12–16 (parallel) | planned | Biodiversity Trails; PITs + QR/NFC anchors; ANP/INEGI/INAH GeoJSON; diversity indices (S, H′, D, Chao1, Pielou J); trail PDF export |
| v2.0 | Months 17–22 | planned | Camera-trap occupancy modelling; GBIF publisher + DOI; regional ML training; B2G dashboard for CONANP / state agencies; iNaturalist bridge |
| v2.5 | Months 23–32 | planned | Rastrum Scout (RAG); AR species overlay; indigenous-language voice I/O; CONABIO/CONANP/INAH partnership APIs |

Open per-phase blockers (license, weights, governance) are tracked in
[`docs/tasks.md`](docs/tasks.md) and live at
[`/en/docs/tasks/`](https://rastrum.org/en/docs/tasks/).

## Contributing

See [`CONTRIBUTING.md`](CONTRIBUTING.md). The short version:

1. Read [`AGENTS.md`](AGENTS.md) — convention map.
2. One logical change per PR; EN/ES parity is a hard rule for any
   user-facing string.
3. `npm run typecheck && npm run test && npm run build` before opening a PR.
4. Issue templates live at [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/).

Security reports: see [`SECURITY.md`](SECURITY.md).

## License

This project is licensed under the [MIT License](LICENSE).
