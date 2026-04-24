# Rastrum v1 — Product Specification

**Document**: Product Spec  
**Version**: 1.0  
**Date**: 2026-04-24  
**Status**: Draft  
**License**: MIT  

---

## Table of Contents

1. [Vision](#vision)
2. [Core Features](#core-features)
3. [Roadmap](#roadmap)
4. [Data Model](#data-model)
5. [AI Pipeline Architecture](#ai-pipeline-architecture)
6. [Conservation Impact](#conservation-impact)
7. [Module: Biodiversity Trails (Rutas de Biodiversidad)](#module-biodiversity-trails-rutas-de-biodiversidad)
8. [Module: Territorial Information Points (PITs)](#module-territorial-information-points-pits--puntos-de-información-territorial)
9. [Module: Camera Trap Analysis (Fototrampeo)](#module-camera-trap-analysis-fototrampeo)
10. [Module: Spatial Analysis & Diversity Indices](#module-spatial-analysis--diversity-indices)
11. [Module: Media Enhancement](#module-media-enhancement)
12. [Module: Regional AI Assistant — Rastrum Scout](#module-regional-ai-assistant--rastrum-scout)
13. [Module: Community & Gamification](#module-community--gamification)
14. [Module: Institutional Partnerships & Data Exports](#module-institutional-partnerships--data-exports)

---

## Vision

### Mission

Rastrum exists to make every living thing identifiable by anyone, anywhere — even
without cell signal, even without formal training, even in the languages that field
guides forgot. It is a bridge between the naturalist's eye and the conservationist's
database, built in the open so the data it generates belongs to the commons.

### Problem

Biodiversity observation today is fragmented across incompatible tools, each solving
one narrow slice of the identification problem:

- **Tool fragmentation.** PlantNet handles plants, Merlin handles birds, iNaturalist
  handles community curation — but no single platform unifies photo, audio, video,
  and ecological evidence identification into one workflow. Field workers juggle
  three or four apps per outing.
- **Language barriers.** Most identification tools default to English or European
  common names. Latin American naturalists — working in Spanish, Portuguese,
  Quechua, Nahuatl, or dozens of other languages — face interfaces and taxonomic
  references that were not designed for them.
- **No offline mode.** The richest biodiversity on Earth exists in places with the
  poorest connectivity. Cloud-only AI pipelines are useless in the Lacandon jungle,
  the Pantanal, or the Choco rainforest. Observations made offline are lost or
  transcribed manually days later.
- **No regional training data.** Global models underperform on Neotropical taxa
  because training datasets skew heavily toward North America and Western Europe.
  A model trained on 50,000 images of European oaks will misidentify a Quercus
  from Oaxaca. Regional data pipelines do not exist at scale.

### Solution

Rastrum is a unified, multi-modal identification platform that combines:

1. **Multi-modal AI** — photo, audio, video, and ecological evidence identification
   through a single interface, powered by an ensemble of specialized models
   (PlantNet, BirdNET, Claude Vision).
2. **Community and expert curation** — observations flow into a validation pipeline
   where community members and credentialed experts refine identifications,
   building trust and training data simultaneously.
3. **Conservation pipeline** — every validated observation is exportable in Darwin
   Core format for direct contribution to GBIF, national biodiversity databases,
   and conservation decision-making.
4. **Offline-first, region-focused design** — cached regional models, a Progressive
   Web App architecture, and Latin American language support from day one.

---

## Core Features

### 1. Photo Identification

Rastrum routes photos through specialized models based on the suspected taxon group,
then reconciles results into a ranked candidate list.

- **PlantNet integration** for plants and fungi. PlantNet's API provides organ-specific
  identification (leaf, flower, fruit, bark, habit). Rastrum sends the photo with an
  organ tag (auto-detected or user-selected) and receives a ranked list of candidate
  species with confidence scores.
- **Claude Vision integration** for animals, lichens, and ambiguous subjects. When the
  subject is not a plant or fungus — or when PlantNet returns low confidence — Rastrum
  sends the photo to Claude Vision with a structured prompt that includes GPS
  coordinates, habitat type, and date. Claude Vision returns a species-level or
  genus-level identification with a natural-language rationale.
- **Confidence scoring.** Each candidate receives a normalized confidence score
  (0.00–1.00). Scores below 0.40 trigger a "low confidence" warning and an automatic
  referral to the expert review queue. Scores above 0.85 from a primary model are
  marked "high confidence" but still reviewable.
- **Multiple candidates.** The UI always presents the top three candidates with
  thumbnails, common names (localized), scientific names, and confidence bars. The
  user can accept, reject, or override any candidate.
- **Photo preprocessing.** Before sending to any model, Rastrum applies EXIF
  extraction (GPS, timestamp, camera model), auto-orientation, resolution
  normalization (max 2048px on the long edge), and optional cropping to the region
  of interest.

### 2. Audio Identification

Audio identification targets birds, frogs, and insects — taxa where vocalizations are
often the primary field identification method.

- **BirdNET integration.** Audio files (WAV, MP3, OGG, FLAC) are sent to BirdNET's
  analysis endpoint. BirdNET segments the recording into 3-second windows and returns
  species detections with timestamps and confidence scores per window.
- **Waveform display.** The observation UI renders a scrollable waveform with detection
  highlights overlaid. Users can tap a highlighted region to see the candidate species
  for that segment and play the isolated clip.
- **Habitat tagging.** Audio observations require a habitat tag (forest, wetland,
  grassland, urban, riparian, coastal, cave) to improve model accuracy and to provide
  context for expert reviewers.
- **Multi-species detection.** A single recording may contain multiple species. Rastrum
  groups detections by species and presents each as a separate identification within
  the same observation, linked to the specific timestamp range.
- **Noise filtering.** Recordings are preprocessed with a bandpass filter
  (200 Hz–12 kHz for birds, extended to 20 kHz for insects) and a noise gate to
  reduce wind, rain, and anthropogenic interference before model inference.

### 3. Video Identification

Video combines visual and acoustic analysis in a single observation.

- **Frame extraction.** Rastrum extracts keyframes at scene-change boundaries and at
  fixed intervals (one frame per two seconds). Each extracted frame enters the photo
  identification pipeline independently.
- **Parallel audio pipeline.** The audio track is extracted and processed through the
  audio identification pipeline simultaneously. Results are time-aligned with the
  video timeline.
- **Unified timeline.** The observation detail view shows a combined timeline with
  visual detections (from frames) and audio detections (from the soundtrack) layered
  together. Users can scrub to any detection and see the source frame or audio clip.
- **Duration limits.** Video observations are capped at 5 minutes to control storage
  and processing costs. Longer recordings must be trimmed before upload.
- **Supported formats.** MP4 (H.264), WebM (VP9), and MOV. Files are transcoded
  server-side to a standard format for archival.

### 4. Ecological Evidence Identification

Not all species are observed directly. Tracks, scat, burrows, nests, and other signs
are critical data, especially for nocturnal or elusive species.

- **Evidence types.** Tracks (footprints), scat (droppings), burrows and dens, nests,
  feeding signs (gnaw marks, browse lines, prey remains), scratch marks, and trails.
- **Size reference required.** Every ecological evidence photo must include a scale
  reference — a ruler, coin, hand, or Rastrum's printable scale card. Photos without
  a visible scale reference are flagged for correction before entering the AI
  pipeline.
- **Claude Vision analysis.** Ecological evidence is routed exclusively to Claude
  Vision with a specialized prompt that includes the evidence type, scale reference,
  substrate (mud, sand, snow, soil, rock), and geographic context. The model returns
  candidate species with a confidence score and a description of the diagnostic
  features it identified.
- **Track measurement.** For track photos with a recognized scale reference, Rastrum
  estimates track dimensions (length, width, stride if multiple tracks are visible)
  and compares them against a regional track database.
- **Evidence chains.** Multiple evidence types from the same location can be linked
  into an evidence chain (for example, tracks + scat + burrow at the same GPS
  coordinates), which improves identification confidence through corroboration.

### 5. Observation Log

Every identification is embedded in an observation — the complete record of what was
seen, where, when, and under what conditions.

- **GPS coordinates.** Captured automatically from the device or entered manually.
  Coordinates are stored in WGS 84 (EPSG:4326). Precision is displayed to the user
  (GPS accuracy in meters) and stored as metadata.
- **Timestamp.** UTC timestamp from the device clock or from photo/audio EXIF data.
  Displayed in the user's local timezone.
- **Weather conditions.** Auto-fetched from a weather API (OpenMeteo) at the time and
  location of the observation: temperature, humidity, wind speed, precipitation,
  cloud cover. Users can override with manual observations.
- **Habitat type.** Selected from a controlled vocabulary aligned with IUCN Habitat
  Classification Scheme (Level 1 and Level 2): forest, savanna, shrubland, grassland,
  wetland, rocky areas, caves, desert, marine, artificial.
- **Observer notes.** Free-text field for behavioral observations, context, or anything
  the structured fields do not capture. Supports markdown formatting.
- **Observation grouping.** Observations can be grouped into field trips (a named
  collection with a date range and route), enabling batch review and export.

### 6. Expert Curation

Community validation transforms raw AI identifications into trusted biodiversity
records.

- **Community validation.** Any registered user can agree or disagree with an
  identification. Identifications reaching a configurable agreement threshold
  (default: 3 agreements with no disputes) are marked "community validated."
- **Expert badge system.** Users can apply for expert status in specific taxon groups
  (for example, "Neotropical Orchidaceae" or "Mexican Herpetofauna"). Applications
  are reviewed by existing experts or platform administrators. Expert agreements
  carry 3x weight toward the validation threshold.
- **Dispute resolution.** When an identification receives conflicting votes, it enters
  a dispute queue. Disputes are resolved by a panel of three experts in the relevant
  taxon group. If no experts are available, the observation is flagged for external
  review.
- **Identification history.** Every identification change is logged with the author,
  timestamp, and rationale. The full history is visible on the observation detail
  page, providing a transparent audit trail.
- **Leaderboard and recognition.** Contributors are ranked by validated identifications
  per taxon group. Top contributors receive visibility on species pages and in
  regional summaries.

### 7. Species Pages

Each species in Rastrum has a rich profile page that serves as a living field guide.

- **Range map.** An interactive map showing known distribution based on Rastrum
  observations and external datasets (GBIF, eBird, CONABIO). Filterable by date
  range and season.
- **Phenology.** A calendar heatmap showing observation frequency by month, revealing
  seasonal patterns (flowering, migration, breeding, hibernation).
- **Conservation status.** IUCN Red List category displayed prominently (LC, NT, VU,
  EN, CR, EW, EX). Supplemented with national status from NOM-059-SEMARNAT (Mexico)
  and equivalent regional lists where available.
- **Similar species.** A curated list of species commonly confused with this one,
  with side-by-side comparison photos and a description of diagnostic differences.
  Initially seeded by Claude Vision analysis; refined by expert curation over time.
- **Taxonomy.** Full taxonomic hierarchy (kingdom through subspecies) aligned with
  the Catalogue of Life.
- **Common names.** Displayed in Spanish, Portuguese, English, and indigenous languages
  where available. Users can propose additional common names for expert review.
- **Media gallery.** A curated selection of the best community-submitted photos, audio
  recordings, and video clips for this species, voted on by the community.

### 8. Offline Mode

Rastrum must function in the field without internet connectivity.

- **Cached regional models.** Users select one or more geographic regions (defined as
  100 km radius circles or named protected areas) before going into the field.
  Rastrum downloads compressed versions of PlantNet and BirdNET models scoped to the
  species expected in that region, plus a local inference runtime (ONNX).
- **Offline observation capture.** All observation data (photos, audio, GPS, notes) is
  stored locally in IndexedDB. Observations are queued for sync and marked with an
  "unsynced" badge.
- **Local inference.** Photo and audio identifications run against the cached regional
  models on-device using WebAssembly (ONNX Runtime Web). Results are presented with
  a "local model — pending cloud verification" label.
- **Sync on reconnect.** When connectivity is restored, queued observations upload
  automatically. Local identifications are re-run through the full cloud pipeline,
  and results are updated. Users are notified of any changes.
- **Storage management.** The settings page shows regional model sizes and cached data
  usage. Users can manage which regions are cached and clear old data.

### 9. Export

Observations must be interoperable with the global biodiversity data ecosystem.

- **Darwin Core format.** Observations export as Darwin Core Archive (DwC-A) files,
  the standard for GBIF, iNaturalist, and most national biodiversity databases.
  Fields map to: `occurrenceID`, `scientificName`, `decimalLatitude`,
  `decimalLongitude`, `eventDate`, `basisOfRecord`, `identifiedBy`,
  `identificationRemarks`, `associatedMedia`.
- **Batch export.** Users can export individual observations, entire field trips, or
  filtered sets (by date range, taxon, region, or validation status).
- **GBIF publishing.** Validated observations can be published directly to GBIF
  through Rastrum's registered dataset, with proper attribution to observers and
  validators.
- **CSV and GeoJSON.** For users who need simpler formats, observations export as
  CSV (flat table) or GeoJSON (for GIS tools like QGIS).
- **API access.** A public read-only API (REST, JSON) exposes validated observations
  for third-party tools and research pipelines.

---

## Roadmap

### v0.1 Alpha — Foundation (Month 1-2)

**Goal**: Deployable skeleton with one working identification pathway.

- Astro PWA scaffolding with i18n (Spanish/English), dark mode, responsive layout.
- Supabase project setup: database schema (observations, species, users, media),
  Row-Level Security policies, storage buckets for media.
- Photo identification MVP using PlantNet API only (plants and fungi).
- Basic observation form: photo upload, GPS capture, habitat selector, notes field.
- User authentication via Supabase Auth (email + GitHub OAuth).
- GitHub Pages deployment with CI/CD pipeline.
- Landing page with project mission and call for contributors.

### v0.2 Beta — Intelligence (Month 3-4)

**Goal**: Multi-model photo identification and complete observation workflow.

- Claude Vision integration for non-plant taxa (animals, lichens, ecological evidence).
- Ensemble scoring: route to PlantNet or Claude Vision based on subject, reconcile
  confidence scores into a unified candidate list.
- Full observation log: GPS with accuracy display, auto-fetched weather, habitat
  classification, observer notes with markdown.
- Observation detail page with identification candidates, map, and metadata.
- Media preprocessing pipeline: EXIF extraction, auto-orientation, resolution
  normalization, thumbnail generation.
- User profile pages with observation history and statistics.
- Basic search and filtering (by species, date, location).

### v0.3 — Audio & Community (Month 5-6)

**Goal**: Audio identification and the beginning of the curation layer.

- BirdNET integration for bird, frog, and insect audio identification.
- Audio observation UI: upload, waveform display, detection highlights, playback.
- Community validation system: agree/disagree voting, agreement thresholds,
  identification history.
- Expert badge system: application, review, and weighted voting.
- Dispute resolution queue for conflicting identifications.
- Species pages (v1): taxonomy, conservation status, range map from Rastrum data,
  common names in Spanish/Portuguese/English.
- Notification system: alerts for identifications on your observations, validation
  requests, dispute outcomes.

### v1.0 — Field Ready (Month 7-9)

**Goal**: A complete, offline-capable platform with media tools and community mechanics.

- Video identification: frame extraction, parallel audio pipeline, unified timeline.
- Ecological evidence identification: track, scat, burrow, nest with scale reference
  validation.
- Offline mode: regional model caching (ONNX), local inference (WebAssembly),
  IndexedDB storage, background sync.
- PWA installation: service worker, app manifest, push notifications.
- Darwin Core export: individual, batch, and filtered exports as DwC-A.
- CSV and GeoJSON export.
- Species pages (v2): phenology calendar, similar species comparisons, media gallery.
- Field trip grouping: named collections with date ranges and route maps.
- Public read-only API (REST, JSON) for validated observations.
- Performance hardening: image lazy loading, virtual scrolling, bundle optimization.
- **Media Enhancement module**: in-app photo/audio/video editor with crop, denoise,
  background removal, auto-enhance, and pre-ID quality check.
- **Community & Gamification module**: observer profiles, badges, levels, streaks,
  expert system, monthly BioBlitz, seasonal challenges, social features.

### v1.5 — Spatial Intelligence (Month 10-14)

**Goal**: Field-ready spatial tools for trails, territorial anchors, and diversity analytics.

- Biodiversity Trails module: create, share, and navigate biodiversity transects with
  waypoint-based species observations, diversity metrics, and PDF field guide export.
- Territorial Information Points (PITs): QR/NFC anchors linking physical locations to
  living Rastrum data pages, with scan-to-observe and ranger admin tools.
- QR code generation (SVG) for weatherproof PIT labels.
- Spatial analysis layers: ANP boundaries (CONANP), municipal boundaries (INEGI),
  archaeological zones (INAH), hydrological basins (CONAGUA), vegetation type (INEGI
  Series VII) as toggleable GeoJSON overlays on the explore map.
- Diversity indices engine: S, H' (Shannon-Wiener), D (Simpson), Chao1, beta diversity
  (Sørensen, Jaccard), species accumulation curves (rarefaction), Pielou evenness —
  computed per polygon, trail, or PIT radius.
- Export: CSV species × sites matrix, Darwin Core Archive, R-compatible community
  matrix, PDF report with maps and charts.

### v2.0 — Regional Intelligence (Month 15-20)

**Goal**: Rastrum becomes a data source with institutional partnerships.

- Camera trap module: bulk upload, motion detection, AI species ID (Claude Vision),
  confidence review queue, individual animal identification, activity pattern analysis,
  site occupancy modeling, multi-camera grid support.
- **Institutional Partnerships & Data Exports module**: GBIF auto-publish, iNaturalist
  bridge, CONABIO/CONANP/INAH data pipelines, auto-generated biodiversity reports.
- Regional ML training pipeline: models trained on Rastrum's community-validated
  observation data, purpose-built for Neotropical taxa.
- AR species overlay: point your camera at a landscape and see species annotations
  in real time (experimental).
- Acoustic monitoring integration: deploy BirdNET-Pi stations that feed observations
  directly into Rastrum.
- Biodiversity dashboard: hotspot maps, species richness indices, temporal trends
  for conservation partners.
- Multi-language expansion: Quechua, Nahuatl, Guarani common names and UI
  translations.

### v2.5 — Rastrum Scout (Month 21-30)

**Goal**: AI field assistant powered by regional community data.

- **Rastrum Scout AI assistant**: conversational field assistant with natural language
  queries answered by real Rastrum data, proactive contextual suggestions, species
  co-occurrence insights, expert correction learning, and rarity alerts.
- Full CONABIO/CONANP/INAH integration: automated SNIB exports, ANP monitoring
  reports, and archaeological zone biodiversity management.
- Formal GBIF data publisher registration and automated periodic dataset updates.

---

## Data Model

The Supabase schema is organized around observations and the identifications
attached to them. All tables use UUID primary keys and include `created_at` and
`updated_at` timestamps.

### users

| Column             | Type        | Constraints                    | Description                              |
|--------------------|-------------|--------------------------------|------------------------------------------|
| id                 | uuid        | PK, default gen_random_uuid() | User identifier                          |
| email              | text        | UNIQUE, NOT NULL               | Login email                              |
| display_name       | text        | NOT NULL                       | Public display name                      |
| avatar_url         | text        |                                | Profile photo URL                        |
| bio                | text        |                                | Short biography                          |
| preferred_language | text        | DEFAULT 'es'                   | UI language preference (ISO 639-1)       |
| role               | text        | DEFAULT 'observer'             | Platform role: observer, expert, admin   |
| expert_taxa        | text[]      |                                | Taxon groups for expert badge            |
| observation_count  | integer     | DEFAULT 0                      | Denormalized count for leaderboard       |
| created_at         | timestamptz | DEFAULT now()                  | Account creation timestamp               |
| updated_at         | timestamptz | DEFAULT now()                  | Last profile update                      |

### observations

| Column            | Type        | Constraints                    | Description                                |
|-------------------|-------------|--------------------------------|--------------------------------------------|
| id                | uuid        | PK, default gen_random_uuid() | Observation identifier                     |
| user_id           | uuid        | FK -> users.id, NOT NULL       | Observer                                   |
| latitude          | numeric     | NOT NULL                       | WGS 84 latitude                            |
| longitude         | numeric     | NOT NULL                       | WGS 84 longitude                           |
| gps_accuracy_m    | numeric     |                                | GPS accuracy in meters                     |
| observed_at       | timestamptz | NOT NULL                       | When the observation was made (UTC)        |
| habitat_type      | text        | NOT NULL                       | IUCN Habitat Classification (level 1)      |
| habitat_detail    | text        |                                | IUCN Habitat Classification (level 2)      |
| weather_temp_c    | numeric     |                                | Temperature in Celsius                     |
| weather_humidity  | numeric     |                                | Relative humidity percentage               |
| weather_wind_ms   | numeric     |                                | Wind speed in meters per second            |
| weather_precip    | text        |                                | Precipitation type: none, rain, drizzle    |
| weather_cloud     | text        |                                | Cloud cover: clear, partial, overcast      |
| notes             | text        |                                | Observer free-text notes (markdown)        |
| field_trip_id     | uuid        | FK -> field_trips.id           | Optional grouping into a field trip        |
| validation_status | text        | DEFAULT 'pending'              | pending, community_validated, expert_validated, disputed |
| is_synced         | boolean     | DEFAULT true                   | False if captured offline and not yet synced|
| created_at        | timestamptz | DEFAULT now()                  | Record creation timestamp                  |
| updated_at        | timestamptz | DEFAULT now()                  | Last modification                          |

### species

| Column              | Type        | Constraints                    | Description                              |
|---------------------|-------------|--------------------------------|------------------------------------------|
| id                  | uuid        | PK, default gen_random_uuid() | Species identifier                       |
| scientific_name     | text        | UNIQUE, NOT NULL               | Binomial name (genus + epithet)          |
| common_name_es      | text        |                                | Spanish common name                      |
| common_name_pt      | text        |                                | Portuguese common name                   |
| common_name_en      | text        |                                | English common name                      |
| common_names_other  | jsonb       | DEFAULT '{}'                   | Additional names: {"nah": "...", "qu": "..."} |
| kingdom             | text        | NOT NULL                       | Taxonomic kingdom                        |
| phylum              | text        |                                | Taxonomic phylum                         |
| class               | text        |                                | Taxonomic class                          |
| "order"             | text        |                                | Taxonomic order (quoted: reserved word)  |
| family              | text        |                                | Taxonomic family                         |
| genus               | text        |                                | Taxonomic genus                          |
| iucn_status         | text        |                                | IUCN Red List: LC, NT, VU, EN, CR, EW, EX|
| national_status     | jsonb       | DEFAULT '{}'                   | National statuses: {"mx_nom059": "P", ...}|
| description         | text        |                                | Species description                      |
| similar_species_ids | uuid[]      |                                | Species commonly confused with this one  |
| created_at          | timestamptz | DEFAULT now()                  | Record creation timestamp                |
| updated_at          | timestamptz | DEFAULT now()                  | Last modification                        |

### media_files

| Column          | Type        | Constraints                    | Description                              |
|-----------------|-------------|--------------------------------|------------------------------------------|
| id              | uuid        | PK, default gen_random_uuid() | Media file identifier                    |
| observation_id  | uuid        | FK -> observations.id, NOT NULL| Parent observation                       |
| user_id         | uuid        | FK -> users.id, NOT NULL       | Uploader                                 |
| file_type       | text        | NOT NULL                       | photo, audio, video                      |
| storage_path    | text        | NOT NULL                       | Path in Supabase Storage bucket          |
| thumbnail_path  | text        |                                | Thumbnail path (photos/video frames)     |
| mime_type       | text        | NOT NULL                       | MIME type (image/jpeg, audio/wav, etc.)  |
| file_size_bytes | bigint      |                                | File size in bytes                       |
| width_px        | integer     |                                | Image/video width in pixels              |
| height_px       | integer     |                                | Image/video height in pixels             |
| duration_sec    | numeric     |                                | Audio/video duration in seconds          |
| exif_data       | jsonb       | DEFAULT '{}'                   | Extracted EXIF metadata                  |
| organ_tag       | text        |                                | For plants: leaf, flower, fruit, bark, habit |
| evidence_type   | text        |                                | For ecological evidence: track, scat, burrow, nest, feeding_sign |
| has_scale_ref   | boolean     | DEFAULT false                  | Whether a scale reference is present     |
| original_url      | text        |                                | URL of the original unmodified file      |
| enhanced_url      | text        |                                | URL of the enhanced version              |
| enhancement_params| jsonb       | DEFAULT '{}'                   | Parameters used for enhancement          |
| quality_score     | numeric     |                                | AI-assessed quality score (0.00-1.00)    |
| created_at      | timestamptz | DEFAULT now()                  | Upload timestamp                         |

### identifications

| Column          | Type        | Constraints                    | Description                              |
|-----------------|-------------|--------------------------------|------------------------------------------|
| id              | uuid        | PK, default gen_random_uuid() | Identification identifier                |
| observation_id  | uuid        | FK -> observations.id, NOT NULL| Parent observation                       |
| species_id      | uuid        | FK -> species.id               | Identified species (null if unresolved)  |
| identified_by   | text        | NOT NULL                       | Source: plantnet, birdnet, claude_vision, user, expert |
| scientific_name | text        | NOT NULL                       | Scientific name at time of identification|
| confidence      | numeric     | NOT NULL, CHECK 0.00-1.00      | Normalized confidence score              |
| rank            | integer     |                                | Position in candidate list (1 = top)     |
| rationale       | text        |                                | Natural-language explanation from AI or expert |
| model_version   | text        |                                | Version of the AI model used             |
| is_accepted     | boolean     | DEFAULT false                  | Whether the observer accepted this ID    |
| audio_start_sec | numeric     |                                | Start time for audio detections          |
| audio_end_sec   | numeric     |                                | End time for audio detections            |
| created_at      | timestamptz | DEFAULT now()                  | Identification timestamp                 |

### expert_validations

| Column                 | Type        | Constraints                          | Description                              |
|------------------------|-------------|--------------------------------------|------------------------------------------|
| id                     | uuid        | PK, default gen_random_uuid()       | Validation identifier                    |
| identification_id      | uuid        | FK -> identifications.id, NOT NULL   | Identification being validated           |
| user_id                | uuid        | FK -> users.id, NOT NULL             | Validating user                          |
| vote                   | text        | NOT NULL                             | agree, disagree, uncertain               |
| vote_weight            | integer     | DEFAULT 1                            | 1 for observers, 3 for experts           |
| alternative_species_id | uuid        | FK -> species.id                     | If disagreeing, proposed alternative     |
| comment                | text        |                                      | Rationale for the vote                   |
| is_expert              | boolean     | DEFAULT false                        | Whether the voter has expert badge for this taxon |
| created_at             | timestamptz | DEFAULT now()                        | Vote timestamp                           |

### field_trips

| Column        | Type        | Constraints                    | Description                              |
|---------------|-------------|--------------------------------|------------------------------------------|
| id            | uuid        | PK, default gen_random_uuid() | Field trip identifier                    |
| user_id       | uuid        | FK -> users.id, NOT NULL       | Trip organizer                           |
| name          | text        | NOT NULL                       | Trip name                                |
| description   | text        |                                | Trip description and objectives          |
| start_date    | date        | NOT NULL                       | Trip start date                          |
| end_date      | date        |                                | Trip end date                            |
| route_geojson | jsonb       |                                | GeoJSON LineString of the route          |
| created_at    | timestamptz | DEFAULT now()                  | Record creation timestamp                |
| updated_at    | timestamptz | DEFAULT now()                  | Last modification                        |

### Relationships

```
users 1──N observations       (user_id)
users 1──N media_files        (user_id)
users 1──N expert_validations (user_id)
users 1──N field_trips        (user_id)

observations 1──N media_files        (observation_id)
observations 1──N identifications    (observation_id)
observations N──1 field_trips        (field_trip_id)

identifications N──1 species              (species_id)
identifications 1──N expert_validations   (identification_id)

species 1──N identifications  (species_id)
```

### Indexes

- `observations(user_id)` — user's observation list
- `observations(latitude, longitude)` — spatial queries (consider PostGIS extension)
- `observations(observed_at)` — temporal filtering
- `observations(validation_status)` — queue filtering
- `identifications(observation_id, rank)` — candidate list ordering
- `identifications(species_id)` — species page observation count
- `expert_validations(identification_id)` — vote tallying
- `media_files(observation_id)` — observation media gallery
- `species(scientific_name)` — species lookup

### Row-Level Security

- Users can read all observations and species (public data).
- Users can insert, update, and delete only their own observations and media.
- Expert validations can be inserted by any authenticated user; updates and deletes
  only by the author.
- Admin role bypasses all RLS for moderation.

---

## AI Pipeline Architecture

```
                              +------------------+
                              |  User Upload     |
                              |  (photo/audio/   |
                              |   video/evidence)|
                              +--------+---------+
                                       |
                                       v
                              +------------------+
                              |  Preprocessing   |
                              |  - EXIF extract  |
                              |  - Resize/norm   |
                              |  - Format detect |
                              |  - Audio filter  |
                              +--------+---------+
                                       |
                          +------------+------------+
                          |            |            |
                          v            v            v
                   +------+---+  +----+-----+  +---+--------+
                   | PlantNet |  | BirdNET  |  | Claude     |
                   |          |  |          |  | Vision     |
                   | Plants   |  | Birds    |  | General    |
                   | Fungi    |  | Frogs    |  | Animals    |
                   |          |  | Insects  |  | Lichens    |
                   |          |  |          |  | Evidence   |
                   +------+---+  +----+-----+  +---+--------+
                          |            |            |
                          v            v            v
                      +---+------------+------------+---+
                      |        Ensemble Scoring         |
                      |  - Normalize confidence scores  |
                      |  - Weight by model specialty    |
                      |  - Reconcile overlapping taxa   |
                      |  - Apply geographic priors      |
                      +----------------+----------------+
                                       |
                                       v
                              +------------------+
                              |  Top-3 Candidates|
                              |  - Species name  |
                              |  - Confidence    |
                              |  - Rationale     |
                              +--------+---------+
                                       |
                          +------------+------------+
                          |                         |
                          v                         v
                   +------+-------+    +------------+--------+
                   | High Conf    |    | Low Confidence       |
                   | (>= 0.85)   |    | (< 0.40)             |
                   | Direct to   |    | Auto-route to        |
                   | user review |    | Expert Review Queue  |
                   +--------------+    +---------------------+
```

### Routing Logic

1. **Format detection.** The pipeline inspects the uploaded file's MIME type and
   routes accordingly: images to the photo pipeline, audio to the audio pipeline,
   video to both (frames to photo, soundtrack to audio).

2. **Taxon routing (photos).** If the user tags the subject as plant or fungus, or
   if a lightweight classifier (ResNet-based, runs client-side) detects plant
   morphology with >0.70 confidence, the photo is sent to PlantNet first. All other
   photos go directly to Claude Vision. If PlantNet returns confidence below 0.40,
   the photo is also sent to Claude Vision as a fallback.

3. **Taxon routing (audio).** All audio goes to BirdNET. If BirdNET returns no
   detections or confidence below 0.30, the spectrogram image is sent to Claude
   Vision for visual pattern analysis as a secondary attempt.

4. **Ensemble scoring.** When multiple models return results for the same
   observation (for example, PlantNet and Claude Vision both identify a plant), the
   ensemble scorer normalizes confidence values to a common scale, applies a
   specialty weight (PlantNet gets 1.2x for plants, BirdNET gets 1.2x for birds),
   applies a geographic prior based on known species ranges, and produces a merged
   ranked list.

5. **Expert queue routing.** Observations with all candidates below 0.40 confidence,
   observations flagged by users, and observations with disputed identifications are
   routed to the expert review queue, prioritized by conservation significance
   (endangered species observations are reviewed first).

### Offline Inference

When offline, the pipeline runs locally:

- **Photos**: A compressed MobileNet-based classifier (ONNX format, ~50 MB per
  region) provides top-5 candidates. Results are labeled "local model" and re-run
  through the full cloud pipeline on sync.
- **Audio**: A compressed BirdNET model (ONNX format, ~30 MB per region) runs via
  ONNX Runtime Web. Same labeling and re-run behavior as photos.
- **Claude Vision and ensemble scoring are cloud-only.** Offline identifications
  are single-model only and flagged accordingly.

---

## Conservation Impact

### GBIF Dataset Contribution

Rastrum will register as a GBIF data publisher and maintain a continuously updated
dataset of community-validated observations. Every observation that reaches
"community validated" or "expert validated" status is included. The dataset is
published in Darwin Core Archive format with full provenance metadata: observer,
validators, AI models used, confidence scores, and identification history.

Target: contribute 100,000 validated observations in the first year, focused on
underrepresented Neotropical taxa.

### Institutional Partnerships

- **CONABIO** (Comision Nacional para el Conocimiento y Uso de la Biodiversidad,
  Mexico): Data sharing agreement to feed validated observations into CONABIO's
  SNIB (Sistema Nacional de Informacion sobre Biodiversidad). Joint workshops to
  onboard citizen scientists in priority regions.
- **CONANP** (Comision Nacional de Areas Naturales Protegidas, Mexico): Deploy
  Rastrum in protected area monitoring programs. Train park rangers and community
  monitors as expert validators.
- **Regional herbaria and natural history museums**: Partner with institutions across
  Latin America to validate plant identifications and contribute voucher specimen
  cross-references.
- **University research groups**: Provide API access and bulk data exports for
  ecological research. Support student projects and theses using Rastrum data.

### Biodiversity Hotspot Mapping

Rastrum's observation data, aggregated spatially and temporally, enables:

- **Species richness maps** — grid-based or hexbin maps showing species count per
  area, updated in near real time as observations are validated.
- **Temporal trends** — detecting changes in species composition, phenology shifts,
  and population declines over time.
- **Gap analysis** — identifying under-surveyed areas where observation density is
  low relative to expected biodiversity, guiding future field efforts.
- **Priority area identification** — combining species richness, endemism, and threat
  status to highlight areas of conservation importance.

These maps will be publicly accessible through Rastrum's biodiversity dashboard
(v2.0) and exportable for use in conservation planning tools.

### Invasive Species Early Warning

Rastrum monitors every validated observation against a curated list of known invasive
species for each region. When an invasive species is detected:

1. The observation is flagged with an "invasive species alert" badge.
2. The observer receives a notification explaining the significance.
3. Relevant authorities (CONANP, state environmental agencies) receive an automated
   alert with the species, location, date, and supporting media.
4. The observation is added to Rastrum's invasive species tracker, a map layer
   showing the spatial and temporal spread of invasive populations.

This system enables rapid response to new invasive incursions and contributes to
national and regional early detection networks.

### Open Data Commitment

All validated observation data in Rastrum is open (CC BY 4.0). The platform code is
MIT licensed. Training data generated by the community is published openly to enable
other researchers and platforms to build better regional models. Rastrum does not
monetize user data or restrict access to validated records.

---

## Module: Biodiversity Trails (Rutas de Biodiversidad)

**Target release: v1.5**

A dedicated module for creating, sharing, and navigating biodiversity transects and
trails. Trails serve as the spatial backbone for structured field surveys, community
ecotourism, and long-term monitoring.

### Features

- **Create a trail with named waypoints** — each trail is a GeoJSON LineString with
  an ordered sequence of waypoints (GPS coordinates, name, description).
- **Waypoint observations** — each waypoint accumulates species observations over
  time, building a living species inventory for that exact location.
- **Auto-generated trail profile** — elevation chart, habitats crossed, and a
  diversity summary computed from all waypoint observations.
- **Real-time diversity metrics per trail:**
  - Species richness (S) — count of unique species
  - Shannon-Wiener (H') — -Σ(pi × ln(pi))
  - Simpson (D) — 1 - Σ(ni(ni-1)/N(N-1))
  - Chao1 estimator — S_obs + (f1²/2f2)
  - Species accumulation curves (rarefaction)
- **Trail PDF export** — field guide style, one page per key waypoint with species
  photos, identification notes, and diversity metrics.
- **Shareable trail link + offline download** — download trail data and cached
  regional models for fieldwork without connectivity.
- **Live guide mode** — walking the trail shows nearby historical observations in
  real time, augmenting the field experience.
- **Community rating and commentary** — users can rate trails and leave notes for
  future visitors.

### Priority Use Cases (Oaxaca)

- Monte Albán archaeological zone trails
- Yagul transects
- San Pablo Etla community trails
- Sierra de Juárez migratory bird routes
- Tehuacán-Cuicatlán biosphere reserve

### Data Model Additions

#### trails

| Column             | Type        | Constraints                    | Description                              |
|--------------------|-------------|--------------------------------|------------------------------------------|
| id                 | uuid        | PK, default gen_random_uuid() | Trail identifier                         |
| name               | text        | NOT NULL                       | Trail name                               |
| description        | text        |                                | Trail description and objectives         |
| created_by         | uuid        | FK -> users.id, NOT NULL       | Trail creator                            |
| geojson_linestring | jsonb       | NOT NULL                       | GeoJSON LineString of the trail route    |
| published          | boolean     | DEFAULT false                  | Whether the trail is publicly visible    |
| lang               | text        | DEFAULT 'es'                   | Primary language of the trail content    |
| created_at         | timestamptz | DEFAULT now()                  | Record creation timestamp                |
| updated_at         | timestamptz | DEFAULT now()                  | Last modification                        |

#### trail_waypoints

| Column      | Type        | Constraints                    | Description                              |
|-------------|-------------|--------------------------------|------------------------------------------|
| id          | uuid        | PK, default gen_random_uuid() | Waypoint identifier                      |
| trail_id    | uuid        | FK -> trails.id, NOT NULL      | Parent trail                             |
| "order"     | integer     | NOT NULL                       | Position in the trail sequence           |
| name        | text        | NOT NULL                       | Waypoint name                            |
| lat         | numeric     | NOT NULL                       | WGS 84 latitude                          |
| lng         | numeric     | NOT NULL                       | WGS 84 longitude                         |
| description | text        |                                | Waypoint description and field notes     |
| created_at  | timestamptz | DEFAULT now()                  | Record creation timestamp                |

#### trail_observations

| Column         | Type | Constraints                          | Description                              |
|----------------|------|--------------------------------------|------------------------------------------|
| trail_id       | uuid | FK -> trails.id, NOT NULL            | Parent trail                             |
| waypoint_id    | uuid | FK -> trail_waypoints.id, NOT NULL   | Associated waypoint                      |
| observation_id | uuid | FK -> observations.id, NOT NULL      | Linked observation                       |

#### trail_diversity_cache

| Column     | Type        | Constraints                    | Description                              |
|------------|-------------|--------------------------------|------------------------------------------|
| trail_id   | uuid        | FK -> trails.id, PK            | Parent trail                             |
| s_richness | integer     |                                | Species richness (S)                     |
| shannon_h  | numeric     |                                | Shannon-Wiener index (H')               |
| simpson_d  | numeric     |                                | Simpson index (D)                        |
| chao1      | numeric     |                                | Chao1 estimator                          |
| computed_at| timestamptz | DEFAULT now()                  | Last computation timestamp (refreshed nightly) |

---

## Module: Territorial Information Points (PITs — Puntos de Información Territorial)

**Target release: v1.5**

Physical QR/NFC anchors placed in the field that link a specific geographic location
to a living Rastrum data page. PITs bridge the digital and physical worlds — a scanner
in the forest becomes a window into years of biodiversity data.

### Features

- **Unique URL and QR code** — each PIT has a unique Rastrum URL and a QR code
  generated as SVG (scalable, weather-resistant print).
- **QR printable in weather-resistant format** — outdoor label specs included, with
  suggested materials (UV-resistant polyester or aluminum anodized plate, ~$2-5 MXN
  per basic weatherproof label).
- **PIT page shows:**
  - Species registered at this exact location
  - Historical photos and audio recordings
  - Diversity metrics (S, H', D)
  - Ranger/guide notes
  - Invasive species alerts
- **Scan-to-observe** — any user can scan a PIT QR code and add a new observation
  that auto-links to the PIT location.
- **Ranger/admin tools** — rangers and admins can add permanent notes, maintenance
  logs, and curated species lists to a PIT.
- **PIT types:** individual tree, rock formation, water body, nest/burrow,
  archaeological feature, trail entrance.

### Physical Implementation

- QR code generated as SVG for scalable, weather-resistant printing.
- Suggested label material: UV-resistant polyester or aluminum anodized plate.
- Cost: ~$2-5 MXN per QR label for basic weatherproof print.
- Can be attached to existing signage at ANPs, archaeological zones, community trails.

### Integration with Existing Modules

- PITs appear as map pins with a special icon on the explore map.
- Clicking a PIT on the map opens its full species history.
- **INAH/CONANP partnership path:** propose PIT installation at Monte Albán, Yagul,
  Tehuacán-Cuicatlán.
- **Pilot proposal:** San Pablo Etla community trails (5-10 PITs as proof of concept).

### Data Model

#### pits

| Column       | Type        | Constraints                    | Description                              |
|--------------|-------------|--------------------------------|------------------------------------------|
| id           | uuid        | PK, default gen_random_uuid() | PIT identifier                           |
| name         | text        | NOT NULL                       | PIT display name                         |
| type         | text        | NOT NULL                       | tree, rock, water, nest, archaeological, trail_entrance |
| lat          | numeric     | NOT NULL                       | WGS 84 latitude                          |
| lng          | numeric     | NOT NULL                       | WGS 84 longitude                         |
| description  | text        |                                | PIT description                          |
| installed_by | uuid        | FK -> users.id, NOT NULL       | User who installed the PIT               |
| installed_at | timestamptz | DEFAULT now()                  | Installation timestamp                   |
| active       | boolean     | DEFAULT true                   | Whether the PIT is currently active      |
| qr_url       | text        | NOT NULL                       | URL encoded in the QR code               |
| created_at   | timestamptz | DEFAULT now()                  | Record creation timestamp                |
| updated_at   | timestamptz | DEFAULT now()                  | Last modification                        |

#### pit_notes

| Column  | Type        | Constraints                    | Description                              |
|---------|-------------|--------------------------------|------------------------------------------|
| id      | uuid        | PK, default gen_random_uuid() | Note identifier                          |
| pit_id  | uuid        | FK -> pits.id, NOT NULL        | Parent PIT                               |
| user_id | uuid        | FK -> users.id, NOT NULL       | Note author (admin/ranger)               |
| body    | text        | NOT NULL                       | Note content (markdown)                  |
| created_at | timestamptz | DEFAULT now()               | Note timestamp                           |

#### pit_observations

| Column         | Type | Constraints                      | Description                              |
|----------------|------|----------------------------------|------------------------------------------|
| pit_id         | uuid | FK -> pits.id, NOT NULL          | Parent PIT                               |
| observation_id | uuid | FK -> observations.id, NOT NULL  | Linked observation                       |

---

## Module: Camera Trap Analysis (Fototrampeo)

**Target release: v2.0** — requested specifically for ANP monitoring

A specialized pipeline for processing camera trap footage from protected areas.
Camera traps generate massive volumes of images that require automated triage and
species identification — this module brings that capability into the Rastrum ecosystem.

### Features

- **Bulk upload** — camera trap image sequences (JPG series or video clips) uploaded
  in bulk with metadata (camera ID, deployment dates).
- **Auto-detection of trigger events** — motion frames vs. empty frames, reducing
  manual review burden.
- **AI species identification** — each trigger event is processed by Claude Vision
  with a specialized camera trap prompt including camera location, date/time, and
  habitat context.
- **Confidence scoring** — detections receive confidence scores; low-confidence
  detections enter a manual review queue.
- **Individual animal identification** — where possible, the system identifies
  individual animals by coat patterns, antler shape, or ear tags.
- **Activity pattern analysis** — hourly, daily, and seasonal activity histograms
  per species at each camera site.
- **Site occupancy modeling** — which cameras detected which species, how often,
  enabling occupancy estimation.
- **Multi-camera grid support** — define a camera trap grid for a study area and
  analyze detection patterns across the grid.
- **Export:** occupancy matrix CSV, detection history per camera, species accumulation
  curve.

### Use Cases

- ANP jaguar/puma corridor monitoring (Sierra de Juárez, Tehuacán-Cuicatlán)
- White-tailed deer population studies
- Ocelot and margay detection in cloud forest
- Invasive species (feral dogs, cats) detection near nesting sites
- Pre/post intervention monitoring for conservation projects

### Data Model Additions

#### camera_traps

| Column      | Type        | Constraints                    | Description                              |
|-------------|-------------|--------------------------------|------------------------------------------|
| id          | uuid        | PK, default gen_random_uuid() | Camera trap identifier                   |
| pit_id      | uuid        | FK -> pits.id                  | Optional link to a PIT for location context |
| name        | text        | NOT NULL                       | Camera name/label                        |
| lat         | numeric     | NOT NULL                       | WGS 84 latitude                          |
| lng         | numeric     | NOT NULL                       | WGS 84 longitude                         |
| model       | text        |                                | Camera hardware model                    |
| active_from | date        | NOT NULL                       | Deployment start date                    |
| active_to   | date        |                                | Deployment end date (null if active)     |
| created_at  | timestamptz | DEFAULT now()                  | Record creation timestamp                |

#### trap_events

| Column           | Type        | Constraints                         | Description                              |
|------------------|-------------|-------------------------------------|------------------------------------------|
| id               | uuid        | PK, default gen_random_uuid()      | Event identifier                         |
| camera_id        | uuid        | FK -> camera_traps.id, NOT NULL     | Source camera                            |
| triggered_at     | timestamptz | NOT NULL                            | Trigger timestamp                        |
| media_files      | uuid[]      |                                     | Array of media_files.id references       |
| ai_detections    | jsonb       | DEFAULT '[]'                        | AI detection results (species, confidence, bbox) |
| verified_species | uuid        | FK -> species.id                    | Manually verified species                |
| reviewer_id      | uuid        | FK -> users.id                      | Reviewer who verified the detection      |
| created_at       | timestamptz | DEFAULT now()                       | Record creation timestamp                |

#### trap_deployments

| Column      | Type        | Constraints                         | Description                              |
|-------------|-------------|-------------------------------------|------------------------------------------|
| id          | uuid        | PK, default gen_random_uuid()      | Deployment identifier                    |
| camera_id   | uuid        | FK -> camera_traps.id, NOT NULL     | Camera                                   |
| study_name  | text        | NOT NULL                            | Study or project name                    |
| deployed_at | date        | NOT NULL                            | Deployment start date                    |
| retrieved_at| date        |                                     | Retrieval date (null if still deployed)  |
| notes       | text        |                                     | Deployment notes                         |
| created_at  | timestamptz | DEFAULT now()                       | Record creation timestamp                |

#### occupancy_matrix

| Column     | Type        | Constraints                         | Description                              |
|------------|-------------|-------------------------------------|------------------------------------------|
| id         | uuid        | PK, default gen_random_uuid()      | Row identifier                           |
| study_name | text        | NOT NULL                            | Study or project name                    |
| species_id | uuid        | FK -> species.id, NOT NULL          | Species                                  |
| camera_id  | uuid        | FK -> camera_traps.id, NOT NULL     | Camera                                   |
| detected   | boolean     | NOT NULL                            | Whether this species was detected        |
| detections | integer     | DEFAULT 0                           | Number of detection events               |
| computed_at| timestamptz | DEFAULT now()                       | Last computation timestamp               |

### Integration

- Camera traps can be linked to a PIT for location context.
- Detections feed into the main observations database (with `source=camera_trap` flag).
- Trail diversity metrics include camera trap data when available.

---

## Module: Spatial Analysis & Diversity Indices

**Target release: v1.5** — extends the analytics and explore map sections

### Map Layers (GeoJSON Overlays)

All layers are toggleable on the explore map. Data sourced from Mexican open data
portals:

| Layer               | Source        | Description                              |
|---------------------|---------------|------------------------------------------|
| ANP boundaries      | CONANP        | Natural protected areas of Mexico        |
| Municipal boundaries| INEGI         | Municipal-level administrative divisions |
| Archaeological zones| INAH          | Registered archaeological sites          |
| Hydrological basins | CONAGUA       | River basins and watersheds              |
| Vegetation type     | INEGI Ser. VII| Vegetation and land use classification   |

### Diversity Indices

Computed per spatial unit — polygon, trail, or PIT radius:

| Index                       | Formula / Method                                  |
|-----------------------------|---------------------------------------------------|
| Species richness (S)        | Count of unique species                           |
| Shannon-Wiener (H')         | -Σ(pi × ln(pi))                                  |
| Simpson (D)                 | 1 - Σ(ni(ni-1)/N(N-1))                           |
| Chao1                       | S_obs + (f1²/2f2) where f1=singletons, f2=doubletons |
| Beta diversity (Sørensen)   | 2c / (S1 + S2)                                    |
| Beta diversity (Jaccard)    | c / (S1 + S2 - c)                                 |
| Species accumulation curves | Rarefaction                                       |
| Pielou evenness (J)         | H' / ln(S)                                        |

### Export Formats

- **CSV matrix** — species × sites for spreadsheet analysis
- **Darwin Core Archive** — for GBIF/iNaturalist sync
- **R-compatible community matrix** — direct import into vegan, BiodiversityR, etc.
- **PDF report** — maps, charts, and diversity index tables

---

## Module: Media Enhancement

**Target release: v1.0**

An in-app media editor that improves photo, audio, and video quality before
submitting for AI identification. Enhanced media yields higher-confidence
identifications, especially under difficult field conditions.

### Image Tools

- **Crop and straighten** — isolate the specimen within the frame.
- **Brightness, contrast, exposure, saturation sliders** — compensate for harsh
  midday sun, deep shade, or overcast conditions.
- **Background removal / subject isolation** — helps AI focus on the specimen by
  removing distracting foliage, hands, or other objects.
- **Macro zoom simulation** — for small specimens (insects, fungi, lichens), digitally
  enhance detail in the region of interest.
- **Auto-enhance preset** — one-tap optimization for typical field photos: white
  balance correction, contrast boost, sharpening.
- **Pre-ID quality check** — warns if the image is too blurry, too dark, or too
  overexposed before submission, with specific improvement suggestions.

### Audio Tools

- **Waveform and spectrogram visualization** — see the frequency structure of the
  recording to identify call segments visually.
- **Background noise reduction** — suppress wind, water, crowd, and road noise.
- **Frequency band amplification** — boost bird call frequencies (1–8 kHz) or insect
  frequencies (8–20 kHz) to make target vocalizations stand out.
- **Trim start/end** — isolate the call segment, removing silence and irrelevant noise.
- **Playback speed control** — slow down fast trills or speed up long sequences for
  easier listening.
- **Before/after comparison** — toggle between original and enhanced audio to verify
  improvements.
- **Auto-clean preset** — one-tap denoise + amplify optimized for field recordings.

### Video Tools

- **Frame scrubber** — extract the best still frame for photo ID submission.
- **Clip trim** — select a 5–30 second segment from a longer recording.
- **Audio track extraction** — pull the audio track for the audio ID pipeline.
- **Motion detection highlight** — jump to frames with animal movement, skipping
  empty footage.
- **Export frame as image** — save any video frame as a standalone photo for the
  photo ID pipeline.

### Integration with AI Pipeline

- Media enhancement runs as a preprocessing step before API calls.
- Enhanced version stored alongside original — the original file is never deleted
  or modified.
- Quality score (0.00–1.00) displayed before submission with improvement suggestions
  (e.g., "Crop tighter around the flower" or "Reduce background noise — current
  SNR is low").

### Data Model Additions

The `media_files` table gains four columns:

| Column              | Type    | Description                              |
|---------------------|---------|------------------------------------------|
| original_url        | text    | URL of the original unmodified file      |
| enhanced_url        | text    | URL of the enhanced version              |
| enhancement_params  | jsonb   | Parameters used for enhancement          |
| quality_score       | numeric | AI-assessed quality score (0.00–1.00)    |

---

## Module: Regional AI Assistant — Rastrum Scout

**Target release: v2.5**

A conversational field assistant that learns from the accumulated Rastrum dataset to
provide hyper-local species intelligence. Rastrum Scout answers natural language
queries with real observation data, proactively suggests what to look for based on
location and season, and improves over time as the community contributes more data.

### Core Capabilities

- **Conversational interface** — natural language queries answered with real Rastrum
  data:
  - "¿Qué aves migratorias puedo ver en San Pablo Etla en octubre?"
  - "¿Qué hongos crecen en encinos de la Sierra de Juárez después de la lluvia?"
  - "Esta huella tiene 8 cm de ancho, ¿qué felino puede ser en Yagul?"
- **Proactive contextual suggestions** — based on current GPS location + date +
  season + habitat type + recent nearby observations.
- **Species co-occurrence insights** — "When you find species X in this habitat,
  species Y is often nearby."
- **Expert correction learning** — when verified experts correct an identification,
  that correction improves the regional model's future responses.
- **Rarity alerts** — "This species has only been recorded 3 times in Oaxaca —
  please document carefully."

### Regional Model Training Pipeline

- Trained on Rastrum community data + expert validations.
- Regional focus: Oaxaca → Mexico → Latin America (expanding concentrically).
- Distinguishes between morphologically similar regional species that global models
  confuse (e.g., Oaxacan endemic *Quercus* species, cloud forest fungi, Valley of
  Oaxaca endemic herpetofauna).
- Retraining cadence: quarterly once sufficient data volume reached (>10,000
  validated observations).
- First training case: San Pablo Etla + Valle de Oaxaca community observations.

### Privacy and Data

- All training data uses consented community observations only.
- Observer attribution preserved in model metadata.
- Local communities retain co-ownership of regional model improvements.
- Models published open-source under CC BY-SA.

### Architecture

- **RAG layer** — Retrieval-Augmented Generation over the Rastrum database for
  conversational queries.
- **Fine-tuned classification heads** — for regional species groups where the global
  model underperforms.
- **Claude as reasoning backbone** — for complex multi-modal queries that combine
  image, audio, location, and ecological context.
- **Vector embeddings** — species descriptions, field notes, and habitat data stored
  in pgvector (Supabase) for semantic search.

### Data Model Additions

#### species_embeddings

| Column      | Type        | Constraints                    | Description                              |
|-------------|-------------|--------------------------------|------------------------------------------|
| id          | uuid        | PK, default gen_random_uuid() | Embedding identifier                     |
| species_id  | uuid        | FK -> species.id, NOT NULL     | Source species                           |
| embedding   | vector(1536)|                                | pgvector embedding                       |
| source_text | text        |                                | Text that was embedded                   |
| created_at  | timestamptz | DEFAULT now()                  | Embedding creation timestamp             |

#### assistant_queries

| Column      | Type        | Constraints                    | Description                              |
|-------------|-------------|--------------------------------|------------------------------------------|
| id          | uuid        | PK, default gen_random_uuid() | Query identifier                         |
| user_id     | uuid        | FK -> users.id, NOT NULL       | Querying user                            |
| query_text  | text        | NOT NULL                       | Natural language query                   |
| response    | text        | NOT NULL                       | Assistant response                       |
| context     | jsonb       | DEFAULT '{}'                   | GPS, date, season, habitat context       |
| feedback    | text        |                                | User feedback: helpful, unhelpful, wrong |
| created_at  | timestamptz | DEFAULT now()                  | Query timestamp                          |

#### regional_models

| Column          | Type        | Constraints                    | Description                              |
|-----------------|-------------|--------------------------------|------------------------------------------|
| id              | uuid        | PK, default gen_random_uuid() | Model identifier                         |
| name            | text        | NOT NULL                       | Model name and version                   |
| region          | text        | NOT NULL                       | Geographic scope (e.g., "oaxaca_valley") |
| taxon_group     | text        |                                | Target taxon group (if specialized)      |
| training_count  | integer     | NOT NULL                       | Number of observations in training set   |
| accuracy        | numeric     |                                | Validation accuracy (0.00–1.00)          |
| model_url       | text        |                                | URL to model artifact                    |
| trained_at      | timestamptz | DEFAULT now()                  | Training completion timestamp            |
| created_at      | timestamptz | DEFAULT now()                  | Record creation timestamp                |

#### expert_corrections

| Column              | Type        | Constraints                         | Description                              |
|---------------------|-------------|-------------------------------------|------------------------------------------|
| id                  | uuid        | PK, default gen_random_uuid()      | Correction identifier                    |
| identification_id   | uuid        | FK -> identifications.id, NOT NULL  | Original identification                  |
| expert_id           | uuid        | FK -> users.id, NOT NULL            | Correcting expert                        |
| original_species_id | uuid        | FK -> species.id                    | Originally identified species            |
| corrected_species_id| uuid        | FK -> species.id, NOT NULL          | Corrected species                        |
| rationale           | text        | NOT NULL                            | Explanation of the correction            |
| incorporated        | boolean     | DEFAULT false                       | Whether fed into model retraining        |
| created_at          | timestamptz | DEFAULT now()                       | Correction timestamp                     |

---

## Module: Community & Gamification

**Target release: v1.0**

Mechanics to grow and retain the observer community through meaningful engagement,
recognition, and collaborative goals aligned with conservation outcomes.

### Observer Profiles

- **Species count by taxon group** — birds, plants, fungi, reptiles, etc., displayed
  as a visual breakdown.
- **Personal observations map** — heatmap of the observer's geographic coverage.
- **Badges:**
  - First Bird, First Plant, First Fungus (taxonomic firsts)
  - 100 Observations, 500 Observations, 1000 Observations (volume milestones)
  - Night Observer (observations between 20:00–05:00)
  - Rare Find (observation of a species with <10 regional records)
  - Expert Validator (earned expert badge)
  - Trail Creator (published a biodiversity trail)
- **Observer level:** Novice → Field Naturalist → Specialist → Expert →
  Master Naturalist — based on validated observation count, taxon breadth, and
  community contributions.
- **Streak tracking** — consecutive days with at least one observation.

### Expert System

- **Expert badge per taxonomic group** — ornithologist, botanist, mycologist,
  herpetologist, entomologist, etc.
- Experts can validate or correct identifications; expert validations carry 3×
  weight in the consensus algorithm.
- Expert nominations via community vote + admin review.
- Expert leaderboard per taxon group.

### Challenges

- **Monthly BioBlitz** — most species documented in a defined area within 24 hours.
- **Seasonal challenges** — document spring migrants, rainy season fungi, dry season
  reptiles, etc.
- **Community goals** — "Complete the bird list for Yagul" or "Map all orchid species
  in the Sierra de Juárez."
- **School/university group challenges** — structured challenges for educational
  groups with progress tracking and group leaderboards.

### Social Features

- **Follow observers** — receive notifications of their rare finds and validated
  observations.
- **Comment and discussion** — threaded comments on observations for identification
  discussion and ecological notes.
- **Species watchlists** — get alerted when a species on your watchlist is observed
  near you.

---

## Module: Institutional Partnerships & Data Exports

**Target release: v2.0**

Formal data pipelines to scientific institutions and conservation agencies, enabling
Rastrum data to flow directly into national and international biodiversity databases
and management planning processes.

### GBIF Integration

- **Automatic Darwin Core Archive generation** — validated observations are
  continuously packaged as DwC-A.
- **Scheduled push to GBIF dataset** — weekly automated publish to Rastrum's
  registered GBIF dataset.
- **DOI generation** — each Rastrum dataset version receives a DOI for academic
  citation.
- **Citation format** — auto-generated citation strings for scientific publications.

### iNaturalist Bridge

- **Import** — existing iNaturalist observations imported into Rastrum (with user
  permission), preserving identifications and metadata.
- **Export** — Rastrum observations exportable in iNaturalist-compatible format for
  cross-platform sharing.

### Mexican Institutions

- **CONABIO** — SNIB (Sistema Nacional de Información sobre Biodiversidad) compatible
  export format. Direct data pipeline for validated observations in priority regions.
- **CONANP** — ANP monitoring reports auto-generated from observations within
  protected area polygons. Formatted for management plan submissions.
- **INAH** — Biodiversity reports for archaeological zone management plans,
  correlating species data with cultural heritage sites (Monte Albán, Yagul,
  Mitla, etc.).
- **UNAM/IBUNAM** — Herbarium and collection data format compatibility for cross-
  referencing field observations with voucher specimens.

### Report Generation

- **Auto-generated PDF: "Biodiversity Report — [Area] — [Period]"**
  - Cover map with observation density
  - Species list by taxon group with photo thumbnails
  - Diversity indices (S, H', D, Chao1)
  - Trend charts (monthly observation volume, species accumulation)
  - Notable records (rare species, range extensions, first records)
  - Suitable for CONANP management plan submissions
  - Bilingual (ES/EN)
- **Export formats:** PDF, Excel, CSV, Darwin Core Archive, R community matrix.
