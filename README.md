# Rastrum

**Open-source species identification for plants, animals, fungi, and ecological evidence.**

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Deploy](https://github.com/ArtemIOPadilla/rastrum/actions/workflows/deploy.yml/badge.svg)](https://github.com/ArtemIOPadilla/rastrum/actions/workflows/deploy.yml)
[![PRs Welcome](https://img.shields.io/badge/PRs-welcome-brightgreen.svg)](https://github.com/ArtemIOPadilla/rastrum/pulls)

<!-- screenshot -->

---

## About

Rastrum is a biodiversity observation platform that combines computer vision, audio analysis, and expert curation to identify species from photos, videos, audio recordings, and indirect evidence such as tracks, scat, and burrows. It is designed for naturalists, field biologists, citizen scientists, and anyone curious about the species around them.

The platform emphasizes regional biodiversity. Rather than training a single global model, Rastrum aims to build region-specific datasets that improve identification accuracy for local ecosystems, starting with the flora and fauna of Latin America and the Caribbean. Observations are GPS-tagged and time-stamped so they can contribute to ecological monitoring over time.

Rastrum is fully open source under the MIT license. The frontend ships as a static Progressive Web App, and the backend runs on Supabase, keeping infrastructure costs low and making self-hosting straightforward.

## Features

### Photo Identification

Upload a photo of a plant, animal, or fungus and receive ranked species suggestions powered by an ensemble pipeline (PlantNet, BirdNET, and Claude Vision). The system also accepts photos of indirect evidence -- tracks, scat, burrows, nests, and feeding signs -- and routes them through a specialized identification flow.

### Audio Identification

Record or upload audio clips of bird calls, frog calls, insect sounds, and other vocalizations. The audio pipeline extracts spectrograms and runs them through BirdNET and complementary classifiers to return species matches with confidence scores.

### Video Analysis

Submit video files for combined visual and acoustic analysis. Rastrum extracts key frames for photo identification and separates the audio track for the sound pipeline, merging results into a single ranked suggestion list.

### Ecological Evidence

Not every observation starts with a clear photo of the organism. Rastrum supports evidence types that traditional ID apps ignore: footprints, scat morphology, burrow architecture, scratch marks, and other field signs. These observations feed into expert review queues for validation.

### Observation Log

Every submission is saved as a structured observation with GPS coordinates, timestamp, media files, and identification history. Observations appear on a personal timeline and on the global explore map.

### Expert Curation

Verified experts can review pending identifications, confirm or correct species assignments, and annotate observations with ecological notes. The validation system tracks agreement levels and flags conflicts for further review.

### Species Pages

Each identified species links to a dedicated page with taxonomy, common names (English and Spanish), distribution maps built from community observations, and reference media.

### Offline Mode

The PWA shell caches static assets for offline use. Users can draft observations without a connection; submissions sync automatically when connectivity returns.

### Export

Observations can be exported in standard formats (CSV, Darwin Core) for integration with external databases and research workflows.

## Tech Stack

| Component | Technology | Purpose |
| --- | --- | --- |
| Framework | Astro 5.x | Static site generation, island architecture |
| Styling | Tailwind CSS 3.x | Utility-first CSS |
| Hosting | GitHub Pages | Static deployment at rastrum.artemiop.com |
| Database | Supabase (PostgreSQL + PostGIS) | Observations, taxa, users, media metadata |
| Media storage | Cloudflare R2 | Photos, audio, video blobs (S3-compatible, zero egress) |
| Map tiles | Cloudflare R2 + pmtiles | Offline-capable vector tiles |
| Auth | Supabase Auth | Magic link + passkey, role-based access |
| Edge Functions | Supabase Edge Functions | Server-side ID pipeline orchestration |
| Photo ID | PlantNet API | Plant and fungus recognition |
| Audio ID | BirdNET | Bird and animal vocalization classification |
| Vision AI | Claude Vision | Ecological evidence and general species ID |
| Sitemap | @astrojs/sitemap | SEO sitemap generation |
| i18n | Astro i18n routing | English and Spanish support |

## Getting Started

### Prerequisites

- [Node.js](https://nodejs.org/) >= 22.12.0
- npm (ships with Node)

### Installation

```bash
git clone https://github.com/ArtemIOPadilla/rastrum.git
cd rastrum
npm install
```

### Development server

```bash
npm run dev
```

The site will be available at `http://localhost:4321`.

### Production build

```bash
npm run build
npm run preview   # preview the build locally
```

### Environment variables

Create a `.env` file in the project root. The following variables are required for full functionality:

```
# Public (shipped to client)
PUBLIC_SUPABASE_URL=https://your-project.supabase.co
PUBLIC_SUPABASE_ANON_KEY=your-anon-key
PUBLIC_R2_MEDIA_URL=https://media.rastrum.app
PUBLIC_R2_TILES_URL=https://tiles.rastrum.app

# Server-side only (Supabase Edge Functions)
SUPABASE_SERVICE_ROLE_KEY=your-service-role-key
PLANTNET_API_KEY=your-plantnet-key
ANTHROPIC_API_KEY=your-anthropic-key
R2_ACCESS_KEY_ID=your-r2-access-key
R2_SECRET_ACCESS_KEY=your-r2-secret
```

The static landing pages work without these variables. The identification and observation features require a running Supabase project and an R2 bucket for media + tiles.

## Project Structure

```
rastrum/
├── public/
│   ├── CNAME
│   ├── favicon.ico
│   ├── favicon.svg
│   └── rastrum-logo.svg
├── src/
│   ├── components/
│   │   ├── Footer.astro
│   │   ├── Header.astro
│   │   └── ObservationCard.astro
│   ├── i18n/
│   │   ├── en.json
│   │   ├── es.json
│   │   └── utils.ts
│   ├── layouts/
│   │   └── BaseLayout.astro
│   └── pages/
│       ├── 404.astro
│       ├── index.astro          # root redirect
│       ├── en/
│       │   ├── index.astro
│       │   ├── about.astro
│       │   ├── explore.astro
│       │   └── identify.astro
│       └── es/
│           ├── index.astro
│           ├── acerca.astro
│           ├── explorar.astro
│           └── identificar.astro
├── .github/
│   └── workflows/
│       └── deploy.yml
├── astro.config.mjs
├── tailwind.config.mjs
├── tsconfig.json
└── package.json
```

## Supabase Setup

Rastrum expects the following tables in your Supabase project. Create them through the Supabase dashboard or via SQL migrations:

- **users** -- profile data, roles, and preferences (extends Supabase Auth)
- **species** -- taxonomy, common names, description, reference images
- **observations** -- GPS coordinates, timestamp, user reference, status
- **media_files** -- file paths in Supabase Storage, MIME type, linked observation
- **identifications** -- species suggestion, confidence score, source (PlantNet / BirdNET / Claude), linked observation
- **expert_validations** -- expert user reference, verdict, notes, linked identification

Row-Level Security policies should restrict writes to authenticated users and limit expert actions to users with the `expert` role. See the Supabase docs on [RLS](https://supabase.com/docs/guides/auth/row-level-security) for guidance.

## Roadmap

| Version | Milestone |
| --- | --- |
| v0.1 | Static landing pages, i18n, dark mode, GitHub Pages deploy |
| v0.2 | Supabase integration, user auth, observation CRUD |
| v0.3 | Photo ID pipeline (PlantNet + Claude Vision) |
| v0.4 | Audio ID pipeline (BirdNET) |
| v0.5 | Video analysis (frame extraction + audio separation) |
| v0.6 | Expert curation dashboard and validation workflow |
| v0.7 | Species pages with community observation maps |
| v1.0 | PWA offline mode, data export, stable public release |
| v1.5 | Regional model training from community observations |
| v2.0 | Mobile-native companion app |

## Contributing

Contributions are welcome. To get started:

1. Fork the repository.
2. Create a feature branch: `git checkout -b feat/your-feature`.
3. Make your changes and add tests where applicable.
4. Open a pull request against `main`.

Please follow [Conventional Commits](https://www.conventionalcommits.org/) for commit messages. Be respectful and constructive in all interactions -- see the [Contributor Covenant](https://www.contributor-covenant.org/) for baseline expectations.

## License

This project is licensed under the [MIT License](LICENSE).
