# Press Release

## FOR IMMEDIATE RELEASE

---

# Rastrum Launches v1.2: On-Device Animal Identification, Species Pages, and Community Discovery Tools

**Open-source biodiversity platform expands offline-first AI capabilities and community infrastructure for field naturalists in Latin America**

**May 4, 2026** — Rastrum, the open-source bilingual biodiversity observation platform, today released version 1.2 — its most feature-dense update to date. The release brings on-device animal identification powered by a distilled SpeciesNet classifier, dedicated species profile pages, real-time audio thumbnails, an interactive community heatmap, and a revamped karma and AI sponsorship system designed to lower the barrier to entry for citizen scientists who can't afford commercial AI API keys.

Rastrum is available at [rastrum.org](https://rastrum.org) and is fully open source under the MIT license.

---

## What's New in v1.2

### On-Device Animal Identification (SpeciesNet)

Previous versions of Rastrum could identify plants offline via EfficientNet-Lite0 and birds via BirdNET-Lite (audio). v1.2 adds a distilled **SpeciesNet on-device classifier** for animal photos. The model runs entirely in the browser using ONNX Runtime Web — no network request, no API key, no server-side processing. It covers the most commonly observed vertebrates across Latin America and the Caribbean and downloads once (~120 MB) to the device.

Combined with the existing PlantNet integration and BirdNET-Lite audio pipeline, Rastrum can now identify plants, animals, and bird vocalizations without an internet connection.

### Species Profile Pages

Each identified species now has a dedicated page at `/en/explore/species/<slug>/` (and the Spanish mirror at `/es/explorar/especies/<slug>/`). Pages include taxonomy and bilingual common names, a distribution map built from community observations, reference media, and observation history from the Rastrum community.

Species pages are generated statically at build time and update nightly as new community data flows in.

### Interactive Audio Thumbnails

Observations with audio recordings now display a playback button inline — on the explore map, the observer profile grid, and species profile pages. Users can preview a clip in context without navigating to the full observation detail page. The player uses wavesurfer.js and caches the clip after the first play.

### Clickable Map Pins with Thumbnails

The explore map (`/explore/`) now renders thumbnail popup cards on pin click, showing species name, date, observer, and a photo thumbnail. Sensitive observations (NOM-059 / CITES) continue to display with obscured coordinates; their popups show a ± 10 km radius indicator instead of a precise location.

### Community Heatmap

The community map (`/community/map/`) visualizes where Rastrum observer activity is concentrated via a centroid heatmap. Individual observation coordinates are not exposed; the view aggregates each user's activity to a single geographic centroid. Access requires a signed-in session.

### Camera Stations and Period Management

Module 31 camera stations — introduced in v1.0 — now have a full period management UI. Field teams can create, edit, and close deployment periods from `Profile → Camera stations`, with sampling-effort metadata that keeps diversity indices comparable across different trap densities and durations. The observation form includes a camera station selector so observations attach to the correct deployment without manual bookkeeping.

The `rastrum-import` CLI (Module 30) gains support for camera station assignment during bulk import: a single flag attaches an entire batch to an existing station and period.

### Karma and AI Sponsorship Pools

Rastrum's karma system (Modules 23–24) is now fully wired. Points accrue from submitting observations, being the first person to record a species in Rastrum (`first_in_rastrum`), syncing offline observations (`observation_synced`), donating to AI sponsorship pools, and participating in community validation.

**AI sponsorship pools** (Module 27) let users with an Anthropic API key share it with the community. Pool owners set a cost cap per 100 calls; contributors donate karma points or direct contributions to the pool. The model picker now shows cost-per-100-calls so pool owners can make informed budget decisions. A per-pool donation page is available at `/community/donate/<pool>/`. This mechanism is designed to make high-quality AI-assisted identification accessible to naturalists who cannot afford a commercial API key.

### Push Notifications for Streak Reminders

Users can now opt into push notifications for streak reminders (`Profile → Notifications`). A notification fires when no observation has been logged by end of day, giving users the nudge to keep their streak alive. Notifications use the Web Push API and are fully opt-in.

---

## Architecture and Infrastructure

Rastrum runs on a deliberately low-cost stack: Astro 5 static site generation hosted on GitHub Pages, Supabase (PostgreSQL + PostGIS + Edge Functions) for the backend, and Cloudflare R2 for media and ML model weights. The entire platform operates within free-tier infrastructure limits today.

The v1.2 release includes schema corrections that unblocked the `db-apply` CI pipeline after a Postgres view column ordering constraint was hit during karma feature development. The fix is documented in the schema so future contributors understand the `CREATE OR REPLACE VIEW` append-only column rule.

---

## About Rastrum

Rastrum is an open-source biodiversity observation platform designed for naturalists, field biologists, and citizen scientists — with a focus on the flora and fauna of Latin America and the Caribbean. It combines computer vision, audio analysis, and expert curation to identify species from photos, videos, audio recordings, and ecological evidence. Observations are GPS-tagged, time-stamped, and Darwin Core compatible for GBIF export.

The platform is bilingual (English / Spanish), works offline as a PWA, and is free to use, self-host, and contribute to under the MIT license.

- **Live site:** [rastrum.org](https://rastrum.org)
- **GitHub:** [github.com/ArtemioPadilla/rastrum](https://github.com/ArtemioPadilla/rastrum)
- **Report a bug:** the blue button at the bottom-right of every page, or [GitHub Issues](https://github.com/ArtemioPadilla/rastrum/issues)

---

*For press inquiries, open a discussion at [github.com/ArtemioPadilla/rastrum/discussions](https://github.com/ArtemioPadilla/rastrum/discussions).*
