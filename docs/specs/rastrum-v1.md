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
15. [Module: Environmental Context Auto-Enrichment](#module-environmental-context-auto-enrichment)
16. [Module: Media Metadata Extraction (EXIF/XMP/ID3)](#module-media-metadata-extraction-exifxmpid3)

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
- **Media Metadata Extraction module**: automatic EXIF/XMP/ID3 metadata extraction
  from uploaded photos, videos, and audio files — auto-populates observation form
  with GPS coordinates, timestamps, device info, and quality indicators.
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
- **Environmental Context Auto-Enrichment module**: automatic lunar cycle, solar/seasonal,
  precipitation, weather, and phenological tagging of every observation using GPS + timestamp.

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

### Temporal and Phenological Analysis

- **Time series of species richness** per trail/polygon — track how biodiversity
  changes over weeks, months, and years at each spatial unit.
- **Seasonal species composition comparison** — dry vs. wet season community
  composition using beta diversity metrics (Sørensen, Jaccard).
- **Lunar phase activity charts per species** — bar/line charts showing observation
  frequency by moon phase, revealing nocturnal activity patterns.
- **Precipitation-emergence correlation charts** — scatter plots of species detection
  rates vs. precipitation lag (days since rain), identifying rain-triggered emergence.
- **Year-over-year biodiversity trend** — are species appearing earlier/later than
  previous years? Phenological shift detection with statistical significance testing.
- **"Phenological calendar" per site** — visual grid (months × species) showing which
  species appear in which month, color-coded by observation density. Exportable as
  PDF field reference.

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

---

## Module: Environmental Context Auto-Enrichment

**Target release: v0.3** — enriches every observation automatically with environmental metadata

Every observation in Rastrum is automatically tagged with environmental context at the
moment of submission, using the GPS coordinates and timestamp. This transforms raw
sightings into ecologically rich records without any extra effort from the observer.

### Lunar Cycle

- **Moon phase** at time of observation: new moon, waxing crescent, first quarter,
  waxing gibbous, full moon, waning gibbous, last quarter, waning crescent.
- **Lunar illumination percentage** (0–100%).
- **Moon rise/set times** for the observation location.
- Computed locally (no API needed) using astronomical algorithms (e.g. SunCalc.js).
- **Use cases:**
  - Nocturnal mammal activity peaks near full moon
  - Sea turtle nesting triggered by lunar cycles
  - Insect emergence (mayflies, moths) correlated with lunar phases
  - Fishing community traditional knowledge validation
  - Analysis: "Do jaguar camera trap detections peak on dark moon nights?"

### Solar and Seasonal Context

- **Day length (photoperiod)** at observation location and date.
- **Solar angle and UV index** (from open APIs).
- **Season** (astronomical + phenological): dry season, early rains, peak rains,
  post-rains (for tropical Mexico).
- **Days since/until seasonal milestones**: first frost, solstice, equinox.
- **Phenological stage auto-tag**: leaf-out, flowering, fruiting, senescence
  (inferred from regional plant data).

### Precipitation and Weather

- **Precipitation** in last 24h, 7 days, 30 days (Open-Meteo API, free, no key needed).
- **Temperature** at time of observation (min/max/current).
- **Cloud cover** percentage.
- **Days since last significant rain event** (>5mm).
- **Automatic "post-rain emergence" flag** when >10mm fell in previous 48h — highly
  relevant for fungi, amphibians, termites.
- **Weather auto-tag options**: sunny, cloudy, overcast, light rain, heavy rain, fog,
  storm.

### Derived Phenological Indicators

- **"First rain of season" flag** — observation made within 7 days of the season's
  first significant rainfall.
- **Fire risk index** from CONABIO FIRMS satellite data (relevant for monitoring
  post-fire regeneration).
- **NDVI (vegetation greenness)** from Copernicus/Sentinel data for the observation
  location — shows vegetation state.

### Data Model Additions

New columns on the `observations` table:

| Column              | Type    | Constraints   | Description                                      |
|---------------------|---------|---------------|--------------------------------------------------|
| moon_phase          | varchar |               | Phase name (new_moon, waxing_crescent, etc.)     |
| moon_illumination   | float   |               | Lunar illumination 0.0–1.0                       |
| photoperiod_hours   | float   |               | Day length at observation location               |
| temp_celsius        | float   |               | Air temperature at time of observation           |
| precipitation_24h_mm| float   |               | Precipitation in last 24 hours (mm)              |
| precipitation_7d_mm | float   |               | Precipitation in last 7 days (mm)                |
| days_since_rain     | integer |               | Days since last significant rain (>5mm)          |
| post_rain_flag      | boolean | DEFAULT false | True if >10mm fell in previous 48h               |
| weather_tag         | varchar |               | sunny, cloudy, overcast, light_rain, heavy_rain, fog, storm |
| ndvi_value          | float   |               | NDVI vegetation greenness at observation location|
| phenological_season | varchar |               | dry, early_rains, peak_rains, post_rains         |
| fire_proximity_km   | float   |               | Distance to nearest active fire hotspot (km)     |

### Analysis Capabilities Unlocked

- Correlate species emergence with lunar phase.
- Map observation density vs. precipitation lag.
- Identify "phenological trigger events" — what environmental conditions reliably
  predict species appearance.
- Compare seasonal biodiversity indices year over year.
- "First of season" detection alerts: first jaguar track after dry season, first
  monarch butterfly sighting.

### Implementation

- **SunCalc.js** (client-side, no API) for moon + solar calculations.
- **Open-Meteo API** (free, no key) for historical weather at GPS + date.
- **Copernicus NDVI tiles** (free) served via GeoTIFF endpoint.
- **CONABIO FIRMS** fire hotspot API (Mexican government, open).
- All enrichment runs **asynchronously** after observation is saved — does not block
  submission flow.

---

## Module: Media Metadata Extraction (EXIF/XMP/ID3)

**Target release: v0.2** — automatically extracts embedded metadata from every uploaded file

When a user uploads a photo, video, or audio file, Rastrum extracts all available
embedded metadata before the user fills in any form fields. This auto-populates the
observation form and reduces manual data entry to near zero for users with GPS-enabled
devices.

### Photo / Image (EXIF & XMP)

Extracted automatically from JPEG, HEIC, PNG, RAW files:

**Location:**
- `GPSLatitude` + `GPSLongitude` → auto-fills observation coordinates
- `GPSAltitude` → elevation in meters
- `GPSSpeed` → movement speed at capture (useful for aerial/drone shots)
- `GPSImgDirection` → compass bearing camera was pointing

**Date & Time:**
- `DateTimeOriginal` → exact capture timestamp (used for lunar/weather enrichment)
- `OffsetTimeOriginal` → timezone offset (critical for accurate lunar phase)

**Device:**
- `Make` + `Model` → camera/phone model (stored for data quality tracking)
- `LensModel` → lens used
- `FocalLength`, `FNumber`, `ExposureTime`, `ISO` → exposure metadata

**Image quality indicators:**
- `PixelXDimension` + `PixelYDimension` → resolution check for ID quality
- Sharpness and blur score computed client-side before upload

**Embedded species hints (XMP/IPTC):**
- `XMP:Subject` / `IPTC:Keywords` → if user previously tagged in Lightroom/Photos app
- `XMP:Description` → pre-filled notes field

### Video (MP4/MOV metadata + embedded GPS tracks)

- `CreationDate` → capture timestamp
- GPS track embedded in MOV (iPhone videos embed full GPS track) → extract start
  coordinates
- `LocationName` if present (Apple Photos embeds this)
- Duration → stored for clip length context
- Device model from `HandlerDescription` or `Make`
- Audio channels → detect if mono/stereo (relevant for audio ID quality)

### Audio (ID3 tags + EXIF in FLAC/WAV)

- `TXXX:GPS` or `GEOB` ID3 tags → some field recorder apps embed GPS
- `TDRC` → recording date
- `TPE1` → recorder name (if observer pre-tagged in field recorder app)
- Sample rate, bit depth, duration → audio quality indicators for BirdNET pipeline
- iXML chunk (professional field recorders: Zoom, Sound Devices) → GPS, project name,
  scene notes
- BWF (Broadcast Wave Format) metadata → timestamp, originator, description

### Implementation

**Client-side extraction (no server round-trip):**
- `exifr` (npm) — fast, browser-compatible EXIF/XMP/IPTC parser
- `music-metadata-browser` — audio ID3/FLAC/WAV metadata in browser
- All extraction happens before upload — metadata is sent alongside the file

**Privacy:**
- User is shown all extracted metadata before submission with ability to redact
  (e.g. remove GPS for sensitive nesting locations)
- Option: "Strip metadata from shared file" — serves clean file to public, stores
  original with metadata internally
- Sensitive location redaction: auto-detect endangered species flags and offer to blur
  GPS to 10km radius

**Auto-population flow:**
1. User selects file(s)
2. Client extracts all metadata in <100ms
3. Observation form auto-fills: coordinates, date/time, device, notes
4. Environmental enrichment triggered immediately using extracted GPS+timestamp
5. User reviews pre-filled form, corrects if needed, submits
6. Server validates and stores metadata in `media_files.exif_data JSONB`

**Data model:**
- `media_files` gains:
  - `exif_data JSONB` — full raw EXIF dump
  - `gps_lat FLOAT`, `gps_lng FLOAT`, `gps_alt FLOAT` — parsed coordinates
  - `captured_at TIMESTAMPTZ` — from EXIF DateTimeOriginal
  - `device_make VARCHAR`, `device_model VARCHAR`
  - `media_duration_s FLOAT` — for audio/video
  - `sample_rate_hz INT` — for audio
  - `resolution_px INT` — megapixels
  - `gps_direction_deg FLOAT` — compass bearing at capture
  - `metadata_redacted BOOLEAN` — if user chose to strip sensitive data

**Quality scoring from metadata:**
- Low-res image (<2MP) → quality warning
- No GPS in EXIF → prompt user to confirm location manually
- Capture date > 7 days ago → flag as historic observation
- Audio sample rate <22kHz → warn that BirdNET accuracy may be reduced
- Video duration >5 min → suggest trimming before upload


---

## Strategic & Technical Dossier (External Analysis)

> This section integrates a comprehensive 17-page external strategic review of Rastrum.
> **Note:** The founding team has existing professional commitments (AWS exclusivity) that constrain direct public association with competing cloud providers or public co-founder visibility. All funding and partnership strategies must account for this. The project should be structured so the founding team participates through a legal entity (A.C. or SAPI) rather than as a named individual where conflict risk exists.
> Opinions are explicitly flagged **[OPINION]**; hard numbers include sources.
> Source document: *Rastrum v1: A Strategic and Technical Dossier for a LATAM Biodiversity Platform* (April 2026)

# Rastrum v1: A strategic and technical dossier
**Rastrum fills a real, defensible gap — a multi-modal, offline-first, LATAM- and Indigenous-language-native
biodiversity platform — but the v1.0 scope as written is too ambitious for a solo founder, the best license is
not MIT, the best sync engine is not ElectricSQL, the best vision model is not Sonnet, and the best first
customer is not CONANP.** The path to a durable product is to ship a radically narrower MVP in Oaxaca by
Q3 2026, establish a Mexican A.C. plus a U.S. fiscal sponsor to unlock ~$400K in cloud credits this month
and $1–2M in grants in Year 1, and monetize through B2G SaaS plus training programs funded by
international donors rather than by CONANP directly. The mission differentiation — offline-first PWA, Spanish
+ Indigenous languages, ecological evidence as first-class data, CARE/FPIC operationalized with Local
Contexts Labels — is a 3–5 year moat that neither iNaturalist, Google/Wildlife Insights, nor Glority can
replicate without losing their scale advantages. The existential risks are real (Claude/PlantNet dependency,
CONABIO political instability, founder burnout, potential iNaturalist LATAM pivot) but are all manageable with
the architectural and governance decisions laid out below.
This dossier integrates market research, product-market-fit analysis, technical architecture, feature
prioritization, funding, monetization, and legal/governance into an actionable playbook. **Opinions are
flagged; hard numbers are sourced.** It is designed to let the founding team decide whether to pursue Rastrum
seriously, write grant applications, refine the architecture, build an MVP, attract a community, and monetize
without compromising the mission.
--## 1. Market position and the gap Rastrum fills
The biodiversity identification space is fragmented across five silos that no single product unifies.
iNaturalist/NaturaLista dominates community observation (**~3M observers, 240M+ verifiable observations,
1M/week accretion**; [iNaturalist](https://www.inaturalist.org/blog/82010-spreading-our-wings-inaturalist-isnow-an-independent-nonprofit) Mexico is the #2 country globally); Cornell Lab's Merlin owns bird sound and
photo ID (**10M+ users, Sound ID covers common Neotropical species since 2021**); [iNaturalist]
(https://www.inaturalist.org/posts/25697-mexico-inaturalist-world-tour) Pl@ntNet leads plant ID (**78,000
species, 1.4 billion identifications, 10M+ downloads**); [Wikipedia](https://en.wikipedia.org/wiki/Pl@ntNet)
BirdNET is the de-facto open acoustic model but its trained weights are **CC BY-NC-SA 4.0 — noncommercial**; Wildlife Insights dominates camera traps (**34M+ images, 3,000+ species, [Vizzuality]
(https://www.vizzuality.com/project/wildlife-insights) 600+ organizations, [Vizzuality]
(https://www.vizzuality.com/project/wildlife-insights) SpeciesNet open-sourced March 2025**); [Google
Research](https://research.google/blog/where-wild-things-roam-identifying-wildlife-with-speciesnet/) and
SMART + CyberTracker handle ranger/Indigenous patrol workflows (**~1,200 protected areas, 120+
countries; 500K+ CyberTracker downloads**). [CNN](https://www.cnn.com/2020/07/09/africa/louisliebenberg-c2e-spc-int)

**No product today unifies photo + audio + video + ecological evidence (tracks, scat, nests) in a single UI with
offline-first operation, Indigenous-language UX, and native export pipelines to GBIF, CONABIO SNIB, CONANP
and INAH simultaneously.** That is the quadrant Rastrum occupies. The competitive matrix is stark: iNat has
photo-only (audio upload but no AI-ID), no camera-trap ingestion, no tracks/scat taxonomy, no Indigenouslanguage UI, partial offline. Merlin is birds-only. Pl@ntNet is plants-only. Wildlife Insights is camera-trap-only
and cloud-dependent. Arbimon is acoustic-only. CyberTracker has non-literate-friendly icon UX [CyberTracker]
(https://cybertracker.org/the-new-cybertracker-online/) but is African-origin and not LATAM-taxonomy-tuned.
**The QR/NFC "Punto de Información Territorial" anchors have zero competition** — a potential networkeffect moat where whoever plants the most physical anchors in Mexican parks creates the biological version
of Foursquare.
The market sizing numbers to anchor against (treat commercial-research-firm figures with ±30% uncertainty):
global citizen-science platform market **~$1.23B in 2024, projected $3.84B by 2033 at 13.7% CAGR**;
[Growthmarketreports](https://growthmarketreports.com/report/citizen-science-platform-market) global
ecotourism **~$275B in 2024 trending to $770B by 2033**; [Custom Market Insights]
(https://www.custommarketinsights.com/report/ecotourism-market/) Mexico ecotourism **~$3.3– [IMARC]
(https://www.imarcgroup.com/mexico-ecotourism-market) 3.8B in 2024, [Grand View Research]
(https://www.grandviewresearch.com/horizon/outlook/ecotourism-market/mexico) doubling to $8.7–
[IMARC](https://www.imarcgroup.com/mexico-ecotourism-market) 10.6B by 2030– [Grand View Research]
(https://www.grandviewresearch.com/horizon/outlook/ecotourism-market/mexico) 2033**; Mexico
birdwatching tourism **~$1.9B in 2024 → $3.1B by 2030 at 8.6% CAGR [Grand View Research]
(https://www.grandviewresearch.com/horizon/outlook/birdwatching-tourism-market/mexico) (fastestgrowing North American sub-segment)**; [Grand View Research]
(https://www.grandviewresearch.com/horizon/outlook/birdwatching-tourism-market/united-states) City
Nature Challenge 2024 showed **Monterrey #2 globally by observations** and La Paz, Bolivia #1 [Bnhc]
(https://www.bnhc.org.uk/city-nature-challenge/results-from-city-nature-challenge-2024-west-of-england-anduk) — LATAM dominates citizen-science participation per capita. Meanwhile NaturaLista MX grew to **138K
users, 5M observations, 45K species by its 2023 decade anniversary** [Fundación Carlos Slim]
(https://fundacioncarlosslim.org/english/mexico-reaches-5-million-observations-of-plants-animals-and-fungiin-naturalista/) — roughly 16% annual observation growth, substantially slower than global iNat's neardoubling over the same period. **That slowdown, combined with the documented 2024 reduction of
CONABIO's autonomy (Medellín & Soberón,** ***Science*** **384:9)**, [PubMed]
(https://pubmed.ncbi.nlm.nih.gov/38574127/) is precisely the opening for a private-sector/NGO complement.
Mexican rural connectivity is the other decisive anchor. **INEGI ENDUTIH 2024 reports 83.1% national
internet penetration (100.2M users) but only 66.0% rural [INEGI]
(https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2024/ENDUTIH/ENDUTIH_23.pdf) — and the
lowest-connected states (Oaxaca 62.5%, Chiapas 56.7%, [INEGI]
(https://www.inegi.org.mx/contenidos/saladeprensa/boletines/2023/ENDUTIH/ENDUTIH_22.pdf) Guerrero)
are precisely the country's most biodiverse and most Indigenous.** This single statistic validates offline-first

architecture as a requirement, not a nice-to-have. It also tells you that **31.5% of your target users will not be
reachable by cloud-dependent products** like Wildlife Insights or Arbimon, and that PWA delivery (no appstore friction, works on entry-level Android) is the right distribution channel.
## 2. Product-market fit: where Rastrum wins and where to not fight
Ten personas map onto this market, but only five matter for v1. **The commercial anchors are park rangers
(CONANP guardaparques), community monitors (monitores comunitarios like the 75-camera-trap team that
documented the 2026 jaguar record in Sierra Gorda Guanajuato), environmental consultants writing MIA/EIA
baseline studies, ecotourism guides running community-forest enterprises (Ecoturixtlán, Expediciones Sierra
Norte, Pueblos Mancomunados), [Visit Mexico](https://www.visit-mexico.mx/oaxaca/ecotourism-in-oaxaca/)
and university biology students at UNAM/Tec/IPN/ECOSUR.** These are the users with either institutional
budget, recurring revenue, or high-leverage network effects. Casual eco-tourists, amateur naturalists, and
Indigenous community members are equally important to the mission but convert at lower rates and are best
served through partnerships and free-tier generosity.
The jobs-to-be-done analysis yields six differentiating unique value propositions: **(1) offline-first PWA
grounded in rural-Mexico connectivity reality**; **(2) multi-modal unified in one UI** (no competitor bundles
photo + audio + tracks + camera-trap + video); **(3) ecological evidence as structured first-class data** (iNat
allows it but as photos only, with no substrate, stride-length, or morphometric fields); **(4) Rastrum Scout as
a regional LLM assistant** fine-tuned on CONABIO EncicloVida + NOM-059 + SNIB, which beats generic CV
models on Mexican endemic species where iNat's global CV model is weakest; **(5) Indigenous-language
support beyond common-name labels** — full UI translation, voice I/O, and pre-recorded audio prompts for
Zapoteco + Mixteco (Oaxaca, 1M speakers combined), Maya Yucateco (774K), [Statista]
(https://www.statista.com/statistics/1323032/indigenous-language-speakers-by-language-mexico/) Náhuatl
(1.65M), [International Work Group for Indigenous Affairs](https://iwgia.org/en/mexico/4232-iw-2021mexico.html) Tsotsil/Tseltal (Chiapas, 1M); [Statista]
(https://www.statista.com/statistics/1323032/indigenous-language-speakers-by-language-mexico/) and **
(6) four-way native export to GBIF + CONABIO SNIB + CONANP monitoring formats + INAH**, unique among
current tools.
**Where Rastrum should not compete: head-to-head against iNaturalist as a global observation social
network, or against Merlin for North American bird sound ID.** iNat has 240M+ observations and a decadedeep ID-curator community — switching costs are prohibitive. The correct posture is interoperation: ingest
iNat observations where relevant, contribute research-grade Rastrum observations back to iNat via API and
GBIF, and position Rastrum as "the NaturaLista complement for offline + camera-trap + Indigenous-language
+ institutional workflows." Against Merlin, consume BirdNET (with a commercial license from Cornell) rather
than retrain from scratch, and focus the custom audio effort on Mexican-endemic and rare species that
Merlin's 3.8.4 release explicitly flags as gaps. [App Store](https://apps.apple.com/us/app/merlin-bird-id-bycornell-lab/id773457673)

Four pivot options exist if consumer adoption disappoints. A **B2G-first pivot** doubles down on
CONANP/CONABIO/state-government dashboards. A **community-forest-enterprise pivot** serves Ixtlán de
Juárez-style FSC-certified communities [IPARD](https://www.fscindigenousfoundation.org/ixtlan-juarezcommunity-guardians-forests-biological-diversity/) that require biodiversity monitoring evidence for
certification. A **guide-operator trip-report pivot** monetizes Persona 10 with branded trip outputs. An
**education-vertical pivot** licenses to Tec de Monterrey, UNAM, and SEP state secretariats. Track consumer
conversion at 90-day, 180-day, and 365-day milestones; if conversion lags forecasts by 50%+ at any
milestone, trigger the pivot playbook.
## 3. A realistic v1.0 scope — ship less, ship sooner
**Opinion: the v1.0 spec as currently scoped (offline PWA + photo + audio + video + camera trap + ecological
evidence + media enhancement + gamification + Rastrum Scout + institutional export, all at once) is not
shippable by a solo or small team in 12 months, and ships with so many surface areas that none of them will
be polished enough to win users from incumbents.** The correct sequencing is three releases over 12
months.
**v0.1 MVP (months 1–3):** installable PWA with offline observation queue; photo observation with Claude
Haiku 4.5 + PlantNet cascade for AI ID; Spanish UI plus one Indigenous language (Zapoteco pilot, chosen via
FPIC in Sierra Norte); core Darwin Core data model with NOM-059-backed taxon subset; CSV/Darwin Core
Archive export; 50–200 beta users in Oaxaca. Explicitly **not** in MVP: video, audio AI, camera trap,
gamification, Rastrum Scout chat, institutional-format export, ecological evidence. The MVP exists to prove
the offline loop works, not to be feature-complete.
**v0.5 Beta (months 4–6):** audio observation (BirdNET with commercial license or iNatSounds equivalent
for birds + amphibians); multi-image observation; ecological evidence as structured fields (substrate, stride
length, track morphology, scat dimensions — aligning with CONANP's published *Manual de fototrampeo*);
Rastrum Scout v0 as a conversational ID disambiguator; research-grade consensus workflow (iNat-style 2/3
identifier agreement); first real Local Contexts BC Notice integration; GBIF IPT pilot publish; 500–2,000 users
across two states.
**v1.0 (months 7–12):** camera-trap ingestion with SpeciesNet + MegaDetector compatibility; video support
limited to short clips (≤30s, auto-transcoded to H.265 or AV1); opt-in gamification (no global leaderboards —
see §7); institutional export packages (MIA biológica chapter format, UMA Plan de Manejo format, CONABIO
SNIB format, INAH biocultural-site format); credentialed-researcher access tier for sensitive species true
coordinates; 5+ states; 10K+ users.
**Media enhancement should be killed from v1 entirely.** It is not a user-demand driver, it triples the ML
surface area, and it has no demonstrated lift on identification accuracy in the academic literature. Add as a
post-v1 plugin if at all.

## 4. Technical architecture: the consequential decisions
Seven architectural choices will determine whether Rastrum ships and scales. They are, in descending order
of impact:
**Frontend framework: Astro is the wrong primary choice for a write-heavy offline-first PWA.** Astro's
strength is partial hydration for content — which fits species guides and educational material — but its MPAfirst routing reloads state between routes, fights offline SPA UX, and has no first-class pattern for offline
queues + optimistic updates. **Recommended: SvelteKit 2 as the app shell (observation form, camera, map,
feed); Astro for content** (species guides, conservation docs, blog) as a sibling site. Remix/React Router v7
is a strong alternative with better loader/action semantics for sync. Next.js App Router is heavier than
needed. Qwik City is too young. **Wrap with Capacitor for iOS App Store presence in v1.2**; Android
TWA/Bubblewrap is sufficient.
**Offline sync: drop ElectricSQL, skip CRDTs, start simple.** ElectricSQL pivoted to a read-path-only
architecture in 2024 [ElectricSQL](https://electric-sql.com/blog/2024/07/17/electric-next) and is no longer
the tool it advertised. [RxDB](https://rxdb.info/alternatives.html) CRDTs (Automerge, Yjs) are overkill because
biodiversity observations are append-heavy and single-author-per-record. **Recommended: Dexie IndexedDB
outbox table + REST POST to Supabase on reconnect, with last-write-wins per row by the observer.** Upgrade
to PowerSync only if you hit multi-user collaborative editing needs (unlikely pre-$150/mo scale). Reserve
CRDTs for later collaborative field-notebook editing features.
**On-device ML: quantized EfficientNet-Lite0, WebGPU-first with WASM fallback.** Target sub-3 MB INT8
ONNX starter model (top 500 species globally) bundled with the PWA; lazy-load regional packs (Oaxaca,
Yucatán, CDMX at 10–30 MB each) into IndexedDB with `navigator.storage.persist()` requested. ONNX
Runtime Web with `executionProviders: ['webgpu', 'wasm']` [ONNX Runtime]
(https://onnxruntime.ai/docs/tutorials/web/) is the right runtime. [Emerging AI Hubs]
(https://aicompetence.org/ai-in-browser-with-webgpu/) MobileViT-XS and EfficientFormer-L1 are viable
alternatives but EfficientNet-Lite was specifically redesigned for post-training INT8 quantization and is the
most accuracy-robust at small size.
**Vision API: route Gemini 2.5 Flash-Lite → Claude Haiku 4.5 → PlantNet Pro, with Sonnet reserved for expert
review.** At 10K MAU × 3 IDs/day × 30 days = 900K identifications/month, Haiku 4.5 alone with Batch API
(−50%) and prompt caching [Finout](https://www.finout.io/blog/anthropic-api-pricing) on the system prompt
(−90% on 400 of 500 tokens) lands at ~$700/month; adding Gemini Flash-Lite as the first-pass filter reduces
Haiku calls ~50% and cuts the bill to ~$500/month. **Critical licensing warning: BirdNET trained model
weights are [Birdnet-team](https://birdnet-team.github.io/BirdNET-Analyzer/faq.html) CC BY-NC-SA 4.0 —
non-commercial.** The repo source is MIT but the weights are not. [Birdnet-team](https://birdnetteam.github.io/birdnetR/) If Rastrum has any paid tier, email ccb-birdnet@cornell.edu [GitHub]
(https://github.com/birdnet-team/BirdNET-Analyzer) [BirdNET](https://birdnet.cornell.edu/app/) for a
commercial license pre-emptively or position the project as nonprofit-educational throughout ToS.

**Storage: Cloudflare R2, not Supabase Storage.** Zero egress fees are decisive for an image-heavy
biodiversity workload. [BuildMVPFast](https://www.buildmvpfast.com/compare/supabase-vs-r2) At 10K MAU
with typical 300 GB stored and 3 TB egress per month, Supabase Storage costs ~$4,710/month versus R2's
~$150/month. Set WAF rate-limits on bucket GETs to prevent runaway bills from scrapers. [Transactional]
(https://transactional.blog/blog/2023-cloud-storage-costs) Use Cloudflare Images for server-side resize at
the edge (free within R2 Class B op tier).
**Data layer: PostGIS + pgvector + pg_partman on Supabase, hosted in sa-east-1.** Geography type (not
geometry) for observation points; GIST indexes; monthly partitions on `observation` table via pg_partman;
HNSW index on pgvector embeddings [Neon](https://neon.com/docs/ai/ai-vector-search-optimization)
(MiniLM-384 self-hosted in Edge Functions). Materialized views for Shannon/Simpson/Chao1 diversity
indices, refreshed nightly. **Wrap all `auth.uid()` / `auth.jwt()` calls in `(SELECT ...)` inside RLS policies** —
this enables Postgres initPlan caching [Supabase](https://supabase.com/docs/guides/troubleshooting/rlsperformance-and-best-practices-Z5Jjwv) [Supabase](https://supabase.com/docs/guides/getting-started/aiprompts/database-rls-policies) and produces dramatic query-performance gains per Supabase's official
guidance. **Consider self-hosting Supabase (Apache 2.0) on AWS `mx-central-1`** (launched Jan 2025) to
satisfy LGPDPPSO data-residency requirements for Mexican government clients — this alone is a significant
B2G differentiator.
**Combined monthly cost at 10K MAU is approximately $2,000** (Supabase Pro + small compute + R2 +
~500K Claude Haiku + 600K PlantNet Pro calls + Gemini first-pass + monitoring). At 100K MAU, roughly
$11,500/month. **Per-user-per-month cost of $0.10–$0.20 is inherent to biodiversity ID** — plan freemium
limits accordingly (e.g., 10 IDs/day free, paid $5/mo for unlimited + expert review).
## 5. Data, Darwin Core, and sensitive species obscuration
Rastrum's credibility with CONABIO, GBIF, and research users depends on rigorous Darwin Core compliance
from v0.1. **The minimum-viable DwC mapping requires `occurrenceID`, `basisOfRecord`, `eventDate`,
`decimalLatitude`/`decimalLongitude`, `geodeticDatum`, `coordinateUncertaintyInMeters`,
`identificationQualifier`, `identifiedBy`, `scientificName`, `taxonRank`, `occurrenceStatus`,
`informationWithheld`, `dataGeneralizations`, `license`, and `rightsHolder`** — populate these from day one.
basisOfRecord defaults to `HumanObservation` [GitHub](https://github.com/tdwg/dwcqa/blob/master/examples/terms.md) for app captures and `MachineObservation` for camera-trap/acoustic
uploads. [Gbif](https://docs.gbif.org/camera-trap-guide/en/) [Obis]
(https://manual.obis.org/darwin_core.html) Audubon Core mandatory fields (`ac:accessURI`,
`ac:hashFunction`, `dc:license`, `ac:tag`, `ac:subjectOrientation`) belong on all media records [Tdwg]
(https://ac.tdwg.org/guide/2013-10-15) — multi-modal without AC metadata is unpublishable.
**Use the GBIF Backbone as the primary taxonomic authority** (it adopted Catalogue of Life [GBIF]
(https://www.gbif.org/dataset/d7dddbf4-2cf0-4f39-9b2a-bb099caae36c) xrelease in late 2024). Cross-

reference POWO/WCVP for plants — critical for LATAM where [Plants of the World Online]
(https://powo.science.kew.org/about) MEXU is the largest herbarium. Use IOC World Bird List for birds.
**Maintain your own `taxon_usage_history` table** that preserves the name as originally assigned at
identification time; when backbone updates mark synonyms, update `taxon.accepted_id` but never rewrite the
historical usage. This preserves DwC fidelity and enables defensible scientific citation.
**Sensitive-species location obscuration is an ethical and legal requirement, not a feature.** Mirror
iNaturalist's 0.2° × 0.2° grid-cell randomization [PubMed Central]
(https://pmc.ncbi.nlm.nih.gov/articles/PMC12451486/) as the public floor. [iNaturalist]
(https://www.inaturalist.org/posts/9649-understanding-your-privacy-settings-for-inaturalist-vermont) The
obscuration matrix should be: NOM-059 category **E** (extinct in wild) [Gobierno de México]
(https://www.gob.mx/semarnat/articulos/conoce-las-categorias-de-riesgo-de-la-nom-059-semarnat-2010para-especies-de-flora-y-fauna?state=published/) → full 5km grid obscure, admin + credentialed researchers
only; **P** (peligro de extinción) → 0.2° auto-obscure, observer + trusted + credentialed; **A** (amenazada)

→ 0.2° auto-obscure; **Pr** (sujeta a protección especial) → 0.1° default-obscure with observer opt-out;
**CITES Appendix I** always obscure; **IUCN CR/EN/VU** default obscure; **orchids (Mammillaria,
Ariocarpus) and Cactaceae** default obscure regardless of formal listing (high poach risk — Conophytum
trafficking in South Africa post-2019 is the cautionary analog). Implement `obscure_point(pt, cell_size_deg)`
as a PL/pgSQL IMMUTABLE function; store both `location` (RLS-locked) and `location_obscured` (publicreadable); Do et al. (2024, *Conservation Biology*) showed 0.2° obscuration biases species distribution
models, [PubMed Central](https://pmc.ncbi.nlm.nih.gov/articles/PMC12451486/) so **build a credentialedresearcher access path with signed data-use agreements and audit logs from v1.0** — this is not optional.
## 6. Offline-first on iOS is the hardest problem — solve it explicitly
iOS Safari is where most PWAs die. The specific constraints that will bite Rastrum are: **7-day ITP eviction**
(script-writable storage wiped after 7 days with no user interaction), **~50 MB soft cache limit [Tigren]
(https://www.tigren.com/blog/progressive-web-app-limitations/) before prompts**, **no Background Sync
API**, [MagicBell](https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide)
**Web Push requires Add-to-Home-Screen (broken in EU under DMA since iOS 17.4)**, [MagicBell]
(https://www.magicbell.com/blog/pwa-ios-limitations-safari-support-complete-guide) **WebGPU only in
Safari 26 preview**. Mitigations compound: request `navigator.storage.persist()` on install (Chrome autogrants to bookmarked sites; Firefox prompts; Safari grants based on engagement); [MDN Web Docs]
(https://developer.mozilla.org/en-US/docs/Web/API/Storage_API/Storage_quotas_and_eviction_criteria)
budget the entire offline state under 30–50 MB initial cache and lazy-load into IndexedDB; implement **onevery-app-open queue flush** as the universal sync fallback instead of Background Sync; **prompt
aggressively for A2HS** to unlock Web Push where available; and **wrap with Capacitor for the iOS App Store
by v1.2** to escape WebKit eviction entirely while reusing the PWA codebase.
Offline maps are the next hard problem. Mapbox GL JS does not support offline on web. **Recommended:
MapLibre GL JS + protomaps pmtiles format, self-hosted on R2.** Full Mexico at zoom 0-14 is ~2-3 GB (too

large per-device); ship zoom 0-10 as a ~250 MB overview, and let users "download my region" to fetch 50 km
radius chunks at ~20–60 MB each into Dexie blob storage. For the offline GBIF backbone, ship the top 10K
most-observed Mexican species (~3 MB) in the PWA bundle and fetch the long tail on demand via SQLite-inIndexedDB (absurd-sql or sqlite-wasm).
## 7. Accessibility, field UX, and gamification without dark patterns
WCAG 2.2 AA is the right bar, not AAA. The nine new criteria in 2.2 matter specifically for Rastrum: **2.4.11
Focus Not Obscured** (sticky capture-bar must use `scroll-padding-top` so focus never hides behind the
bottom action bar); **2.5.7 Dragging Movements** (map pins need tap-to-place alternatives; sliders need +/buttons); **2.5.8 Target Size** minimum 24×24 CSS px [arc42 Quality Model]
(https://quality.arc42.org/standards/wcag-2-2) (baseline 48 dp Material Design); **3.2.6 Consistent Help**
[Vispero](https://vispero.com/resources/new-success-criteria-in-wcag22/) (Rastrum Scout button fixed
bottom-right across all pages); **3.3.8 Accessible Authentication** (support passkeys/Web [Xictron]
(https://www.xictron.com/en/blog/wcag-2-2-new-success-criteria-online-shops/) Authn + email magic link,
paste allowed — no cognitive tests). Color contrast should target **7:1 for body text, not just 4.5:1**, because
outdoor sunlight legibility is a hard field-use requirement. **European Accessibility Act effective June 28,
2025** makes WCAG 2.1 AA compliance a legal floor for any EU user/funder exposure — build for EAA from
day one.
For field use specifically: **48 dp minimum touch targets (not 24 px), with a "glove mode" toggle that enlarges
to 56–64 dp**; dark mode default in field (OLED battery + sunlight); single-camera-init and throttled GPS (20second coarse polling vs continuous) for battery; haptic feedback on capture and sync confirmation; voicefirst hands-free via Web Speech API; wrap Latin binomials in `<span lang="la">` so screen readers pronounce
`Panthera onca` correctly. Ship **pre-recorded prompt audio for critical flows in
Zapoteco/Mixteco/Maya/Náhuatl** because those languages lack native TTS voice coverage — partner with
INALI, UNAM linguistics, and CIESAS.
**Gamification without "gamblification" is non-negotiable for mission alignment.** iNaturalist forum archives
show community and staff actively resist leaderboards because they degrade identification quality ("too
much focus on metrics or 'winners' is notorious for creating competition and toxicity rather than
collaboration"). Apply Yu-kai Chou's Octalysis to emphasize Epic Meaning (conservation impact),
Development/Accomplishment (mastery), and Ownership (life lists), while avoiding Scarcity and
Unpredictability. **Rastrum's gamification should be: life lists and personal progress; region/species "blankspot" missions (fill undersampled areas); community recognition by name with elder-attribution option;
badges tied to quality (verified rare species, careful track ID) — not quantity. No global leaderboards. No
streaks or FOMO mechanics. No scarcity rewards. Optional opt-in "friendly event" mode for BioBlitzes only.**
## 8. Indigenous data sovereignty is the moat — build it first, not last

**CARE principles (Collective benefit, Authority to control, Responsibility, Ethics) are the strategic moat no
competitor can replicate quickly.** iNaturalist, Wildlife Insights, eBird, and Pl@ntNet have no operationalized
FPIC framework. Building one takes years of relationship capital in LATAM that large platforms will not invest.
This is Rastrum's most durable differentiator.
Operationalization has four layers. **Layer 1: Adopt CARE principles + ISE Code of Ethics formally in v0.1**
(principle statement + basic access controls). **Layer 2: Integrate Local Contexts Hub API v2** (default since
Feb 10, 2025) for TK Labels (16+ variants — TK Attribution, TK Clan, TK Family, TK Non-Commercial, TK
Culturally Sensitive, TK Secret/Sacred, TK Seasonal, TK Verified) and BC Labels (Provenance, Consent-NonCommercial, Consent-Verified, Multiple Communities, Outreach, Research). GBIF is the first biodiversity
database to pilot Labels integration (2022, Manaaki Whenua New Zealand) — follow that pattern.
Institution/Researcher accounts require a Hub Subscriber Agreement as of Jan 13, 2025; Community
Accounts are free; sandbox is free for integration testing. **Layer 3: When a user's GPS is inside an INPImapped Indigenous territory, show a BC Provenance Notice by default and require per-project community
approval before public data release.** **Layer 4: Establish a Rastrum Consejo Asesor Indígena (CARI) with 7–
9 seats, ≥5 Indigenous members, representatives from Oaxaca (Zapoteco, Mixteco, Mixe), Yucatán (Maya),
Chiapas (Tsotsil/Tseltal), and Puebla/Veracruz (Nahua); 3-year staggered terms; quarterly bilingual meetings;
veto power on TK features, dataset releases from consulta-covered territories, and commercial partnerships.
Honoraria paid from operating budget, not project budget** (avoids extraction optics). Mexico's INPI
Protocolo de Consulta Libre, Previa e Informada (DOF 2019) is the template for regional FPIC.
**Nagoya Protocol nuances matter less than people think — but the parts that do matter are nonnegotiable.** Mexico ratified Nagoya May 16, 2012 (5th country, first megadiverse). **Photographs, audio,
and occurrence records are generally NOT genetic resources in the strict Nagoya sense**, so a pure
observation platform largely falls outside Nagoya's bright-line triggers. But the moment Rastrum collects or
displays Indigenous names, medicinal/ritual uses, or associated traditional knowledge (aTK), you enter
Nagoya scope and need PIC + MAT + IRCC on the ABS Clearing-House. Mexico's domestic implementation is
incomplete — the Ley General de Biodiversidad has been stalled since 2016 (opposed by CEMDA, CeIBA,
Greenpeace, Red Nacional Indígena over lack of consulta previa), a new initiative was filed Feb 12, 2025, and
as of April 2026 no operational domestic ABS law exists. SEMARNAT collecta-científica permits under LGVS
Arts. 85–87-bis and ad-hoc instruments fill the gap. **Practical implication: the Nagoya risk is low for core
Rastrum features but high for any ethnobotany or TK module. Treat ethnobotany as a v2 feature gated on a
completed FPIC process with at least one community partner.**
## 9. Legal structure and Mexican context
**Opinion: stand up a dual-entity structure within the first 6 months.** The "Rastrum A.C." (Asociación Civil,
3–8 weeks to incorporate, MXN 15–40K in notario fees) holds the mission, trademark, grants, community,
and data-governance rules. Pursue **donataria autorizada status with SAT** (12-month process) to enable
tax-deductible donations and access Fondo Mexicano para la Conservación de la Naturaleza, FAHHO,
Fomento Banamex, CONABIO-adjacent grants. The "Rastrum SAPI de C.V." (or initially a same-day **S.A.S.**

via tuempresa.gob.mx for MXN ~0) handles commercial licensing, paid SaaS, government contracts, and
eventual VC equity. The A.C. owns 100% of the SAPI initially, with a trademark license and services agreement
between them to preserve daylight between mission and revenue. This mirrors Mozilla Foundation + Mozilla
Corporation, WordPress.org Foundation + Automattic, and iNaturalist's 501(c)(3) spinoff with a $10M Moore
Foundation startup grant in July 2023. **Pursue B Corp certification only via the SAPI (Sistema B does not
certify nonprofits)**; Mexico has ~70 certified B Corps and offers Empresa B Pendiente for startups under 1
year.
A **U.S. 501(c)(3) fiscal sponsor** is also needed to unlock AWS Imagine, Bezos Earth Fund, CZI EOSS,
Mulago, DRK, and most U.S.-origin philanthropy. **Multiplier (formerly Trust for Conservation Innovation) is
conservation-specialized with a 9% fee**; Social Good Fund is faster (~5 business days if aligned) but has
1000:100 applicant-to-slot ratio. Start with Multiplier; move to New Venture Fund once you have a $500K+
commitment in hand.
**Open source license: shift from MIT to a hybrid stack before attracting external contributors.** MIT
maximizes adoption but leaves the SaaS loophole wide open — a well-funded competitor (Google, an iNatMexico operator, a commercial ID-as-a-Service) can fork Rastrum and close-source it. **Recommended:
AGPL-3.0 for server code** (closes the SaaS loophole; Mastodon, Nextcloud, PeerTube precedent); **Apache
2.0 for client SDKs** (adds patent grant); **CC BY 4.0 for documentation**; **CC0 for taxonomic lookup
tables**; **TK Labels + negotiated community licenses for Indigenous-language glossaries** (CARE > FAIR
here); **trained model weights tiered — small distilled models under Apache 2.0, frontier models under a
source-available Rastrum Research License** (free for non-commercial research, commercial use requires
agreement). Use **DCO (Developer Certificate of Origin, Linux-kernel style)** not CLA — lightweight, trustfriendly, no legal anxiety. Publish a separate **Rastrum Trademark Policy** (model on Mozilla's) preserving
brand integrity independent of code license.
**Trademark "Rastrum": file immediately in IMPI class 42 (SaaS), class 9 (downloadable software), and class
41 (education).** IMPI tariff is MXN ~$3,126 per class plus ~MXN 5–15K per class in attorney fees, 6–18
months to issuance. **Inventia Life Science (Sydney) has a RASTRUM™ 3D bioprinter that overlaps directly in
class 42**; confirm via MARCANET search before filing (Inventia does not appear to be registered in Mexico
based on public search). Park defensive names: "Rastrum Bio", "Rastrum MX", "Rastrum Nature"; consider
Náhuatl-derived alternatives ("Xalli", "Tlapani") only after linguistic-consultant review. Register `rastrum.mx`,
`rastrum.org.mx`, `rastrum.app`, `rastrum.ai`, `rastrum.eco` immediately. Include a **public disambiguation
statement** on the website: "Rastrum® is a biodiversity platform by [A.C. name]. Not affiliated with Inventia
Life Science's RASTRUM™ 3D bioprinter."
**Mexican data privacy law went through seismic change in March 2025.** The LFPDPPP and LGPDPPSO
were both replaced via decree March 20, 2025; **INAI was dissolved (Nov 2024 constitutional reform)** with
enforcement now under the Secretaría Anticorrupción y Buen Gobierno through a decentralized body called
"Transparencia para el Pueblo." Processors are now directly liable (not only controllers); ARCO rights
preserved; **automated/agentic decision-making notice is now required — Rastrum's AI ID features trigger

this**; sensitive data still requires express consent; cross-border transfer criteria are under-specified.
**Secondary regulations are pending and could shift DPO, cross-border, and AI notice requirements
significantly by late 2026** — design for GDPR (stricter by default), then Mexico compliance follows
automatically. Faces in photos (biometric under LFPDPPP + GDPR Art. 9) and Indigenous self-identification
(sensitive ethnicity data) are the two PII categories that need the most care — **implement client-side face
blur via TensorFlow Lite before upload** and make Indigenous self-identification strictly opt-in with clear
purpose explanation.
## 10. Funding roadmap — the 18-month playbook
**Before any paid grant dollar arrives, the founding team should close ~$400K+ in cloud and tech credits this month.**
These are 30-minute-to-2-hour applications, almost all self-serve, no legal entity required. The immediate
stack: **AWS Activate Founders ($1K, 7–10 days); NVIDIA Inception (up to $100K AWS Activate + $150K
Nebius + GPU preferred pricing; free, no equity)**; Microsoft for Startups Founders Hub (up to $150K Azure +
$2,500 OpenAI); **Anthropic AI for Science (up to $20K API credits with Tec de Monterrey MAIA affiliation —
strongest single credit win)**; Anthropic Student Builder ($50 from Tec email); GitHub Student Developer
Pack (Copilot Pro, GitHub Pro, DigitalOcean $200, and dozens more); Notion for Startups; Cloudflare for
Startups ($2,500 credits); Supabase OSS request via email. **Combined value: ~$400K+ in in-kind credits**
before a single grant cycle closes.
The grant pipeline sequences by probability × size × fit × timing:
**Q2 2026 flagship applications:** **MIT Solve 10th Anniversary Global Challenge (deadline May 21, 2026)**
is the single highest-EV target — $10K Solver baseline + up to $150K AI for Humanity Prize via Patrick J.
McGovern Foundation; Indigenous Communities + Climate tracks both fit. **National Geographic Society
Level II Explorer grant (up to $100K, ~6-month LOI-to-decision)** — apply under Wildlife + Human
Ingenuity/Tech; Founder eligible as individual. **Mohamed bin Zayed Species Conservation Fund (up to $25K,
deadline June 30, 2026)** — tie to a specific IUCN-listed threatened Oaxaca species; 3 deadlines per year.
**Rufford Small Grants (£7K, rolling, ~2-month review)** — strong fit for MAIA student status; fieldwork costs
only. **Bezos Earth Fund AI for Climate & Nature Grand Challenge Phase III** if US fiscal sponsor secured
(Phase I $50K → Phase II up to $2M; NY Botanical Gardens plant ID and WCS MERMAID are the fit pattern).
**Q3 2026:** **Conservation Leadership Programme (deadline November, $12.5K Future Conservationist for
teams of 3+)**; **Future for Nature Award (September, €50K)** — strong individual fit for the founder; **IDB Lab
Natural Capital Action Plan / Jaguar Impact Initiative** — LATAM's only dedicated multilateral biodiversityinnovation vehicle, $500K–$1M typical; **Google.org Accelerator: Generative AI** — 2026 cohort expected
Q3, ~$1.5M equivalent + pro-bono engineering; **CZI EOSS Cycle 7** ($100K–$400K) if Tec de Monterrey or
fiscal-sponsor affiliation in place.
**Q4 2026 and beyond:** **Mulago Henry Arnhold Fellowship** (referral-based, $100K unrestricted);
**SECIHTI Convocatoria Nacional 2027** via Tec de Monterrey; **Earthshot Prize 2027 nominator outreach**

(needs accredited nominator like Mills Fabrica or Commonwealth Secretariat); **Whitley Fund for Nature
2028** (target after deployment maturity — 2026 and 2027 too early); **FAHHO (Fundación Alfredo Harp Helú
Oaxaca)** direct partnership — **highest local-strategic fit given the founder's Oaxaca roots + Indigenouslanguage angle**.
**What not to bother with:** USAID (frozen under current U.S. admin); YC/Techstars/for-profit VC accelerators
(mission mismatch); Arcus/Leakey/Disney/Moore/Packard/NIH/ERC/UKRI/Wellcome/RWJF (poor fit or
invitation-only); crypto/ReFi as anchor strategy (taint risk + low yield); Indigenous funds in wrong geography
(First Nations US, Indigenous Climate Hub Canada, Fondo Acción Colombia, WWF Brazil); Mozilla MOSS
(program contracted).
**Rare alignment funders to prioritize (open source + citizen science + Indigenous + LATAM quadrant):** IDB
Lab, Bezos Earth Fund, FAHHO, National Geographic, MIT Solve, UNDP Equator, CZI EOSS, Conservation
Leadership Programme. This combination of attributes is genuinely differentiating in grant applications —
most biodiversity-AI projects pitched to U.S. funders are English-only and cloud-only.
## 11. Monetization — the honest ceiling and how to earn it
**Opinion: Rastrum's realistic 5-year ARR ceiling as a mission-led LATAM platform is $3–6M, not $30M.**
That is a success case — roughly 2–4× iNaturalist's current revenue and sufficient for a sustainable 25–40
person team — but it reframes the entire strategy. The failure mode is pricing and positioning for a Silicon
Valley SaaS outcome that the market cannot deliver.
Of the 20 monetization paths evaluated, four generate the bulk of realistic ARR. **B2B/B2G SaaS to
institutions is the largest single stream** ($800K–$1.4M at scale): CONANP multi-reserve bundles, CONABIO
data backend, state SEMARNAT counterparts (Yucatán, Oaxaca, Jalisco, CDMX, NL most active), universities,
consultorías ambientales, ecolodges, botanical gardens. **Critical reality check: CONANP's entire 2025
budget is ~USD $50M for 232 ANPs (MXN $10.2/hectare/year — the lowest in 21 years, with a further 12%
cut proposed for 2026). Do not assume CONANP will buy direct.** Instead, **partner with international
donors (BIOFIN, GEF, KfW, Moore, Packard, IDB Lab, Re:wild) to fund 3–5-ANP pilots**, using the pilots as
reference datasets to pitch multi-reserve bundles later. This is how SMART, Wildlife Insights, and BIOFIN
entered LATAM parks. **Camera trap SaaS ($360K at scale)** is the second-highest ROI with continuous
billable events and clear unit economics — target the underserved UMA market (~12,000 registered Unidades
de Manejo Ambiental, ~2,000 with camera-trap programs, and cashflow from hunting fees). Build on Wildlife
Insights' Camtrap DP interoperability standard rather than competing. **White-label deployments ($480K at
scale)** for ICMBio Brasil, SINAC Costa Rica, SERNANP Peru, MINAE, MiAmbiente Panamá, Instituto
Humboldt Colombia — plus Mexican subnational states since CONABIO already runs NaturaLista nationally.
**Training programs for community monitors ($500K at scale)**, funded by CONANP PROCODES (MXN
~$600M annual budget — apply for PROCODES-eligibility via A.C.), FMCN, WWF-México, and university coaccreditation (ECOSUR, UADY, UAM-X).

Secondary streams (~$100–$500K each): auto-generated biodiversity reports for MIA/EIA ($100–$500 per
report, sleeper hit in Mexico's MIA market), educational licenses (free for public schools, paid for private;
Oaxaca and Yucatán SEP-state pilots most promising), sponsored BioBlitzes ("Reto Naturalista México 2027
powered by Rastrum" with Grupo Bimbo/FEMSA/Citibanamex sponsorship), commercial API tiered pricing
(anchor on PlantNet Pro — €1000/year for 200K calls), ecotourism lodge partnerships ($50–$500/month per
property).
**Freemium consumer is a brand play, not a revenue engine.** At 100K MAU with 2–4% conversion at MXN
$49/month (~USD $2.60), the yield is $44–$88K/year — because LATAM naturalist users skew
student/researcher (low WTP) and because ethical freemium with a generous free tier converts at 2–4%, not
Glority's ad-heavy trial-and-lock rates. **Donations yield ~$0.30–$0.80 per active user per year** based on
iNaturalist, OpenStreetMap, and Wikipedia benchmarks — at 100K users, $30–$80K/year.
**Red lines to publish as "Rastrum Monetization Principles" (doubles as FPIC credibility signal):** never
paywall core ID; never sell raw user data to extractive industries (mining, oil & gas, industrial ag, logging —
explicit industry-exclusion list in ToS); **never tokenize or blockchain Indigenous or community data (NFT on
biodiversity is permanently off-limits)**; no dark-pattern subscriptions (one-click cancel, fully transparent
pricing, no trial-and-auto-bill); no sale of precise location data for threatened species; no advertising; no data
marketplace without community-level FPIC and revenue share; no biodiversity-credit MRV on
Indigenous/ejido/comunidad lands without documented FPIC and benefit-sharing; no greenwashing
partnerships (corporate sponsors pass a published screening for active environmental harm); full data
portability (users export all their own observations in CSV/DwC/GPX, always).
**The three-question test for any new monetization idea: Does it harm open science? Does it harm
Indigenous data sovereignty? Does it distort incentives (reward disturbance, conflict of interest, attention
drift)?** Green light requires three yesses.
## 12. Existential risks and mitigations
**Founder burnout is the single highest-probability, highest-impact risk (H/H).** Mitigations: sequence
aggressively per the v0.1/v0.5/v1.0 plan above; hire a co-founder tech lead within 6 months or accept a
slower roadmap; join a structured fellowship (MIT Solve, Ashoka, Acumen LatAm, Echoing Green); write a
vacation/sabbatical calendar into bylaws; publicly commit to 40-hour weeks as a team norm.
**Claude API dependency (M/H):** abstract Rastrum Scout behind a provider-agnostic service (Claude, GPT5, Gemini, Llama, local Mistral); fine-tune and distill a small local Spanish+Indigenous-language model for the
offline/low-cost tier; negotiate startup credits; never store the only copy of prompts/responses; maintain
semantic-cache-able design.
**PlantNet single-point-of-failure (M/M):** multi-source ID fusion (PlantNet + iNat CV + on-device model +
Claude Vision); contribute back to PlantNet's partner network; train own Mexico-region plant classifier on

CONABIO SNIB + iNat MX as a hedge.
**iNaturalist/CONABIO LATAM pivot (M/H):** differentiate on offline + Indigenous-language + ecologicalevidence + Local Contexts FPIC that iNat cannot quickly replicate; build MoUs with INPI, CONANP, and
Oaxaca UMAs before iNat does; **federate rather than compete** — Rastrum as "iNat-compatible" via Darwin
Core + GBIF IPT is friendlier and more defensible.
**Google SpeciesNet + Wildlife Insights + Lens consolidation (M/H):** be MIT/Apache-compatible with
SpeciesNet (ingest it); differentiate on offline + Indigenous languages + ecological evidence + data
sovereignty — the parts Google cannot replicate without losing scale advantages.
**Indigenous community pushback / extractive perception (M/Very H):** do FPIC before features, not after;
CARI with real veto power; BC Notices applied by default on observations from INPI-mapped Indigenous
territories until Labels negotiated; data-return workflow — communities get dashboards of their own data first,
before public release; hire Indigenous staff (goal ≥30% of team, ≥50% of community-facing roles).
**CONABIO political instability (H/H):** per Medellín & Soberón (*Science* 2024), the current administration
reduced CONABIO's autonomy; Sheinbaum administration kept the trajectory but added Alicia Bárcena at
SEMARNAT (more conservation-aligned). **Never make Rastrum financially dependent on CONABIO.**
Diversify across international (GBIF, IDB, GEF), private (Moore, Packard, Bezos Earth, Bloomberg), and
Mexican private (Fundación Coca-Cola, Televisa, Bancomer, FAHHO). Position Rastrum as the data
infrastructure that survives political shifts.
**LFPDPPP/LGPDPPSO 2025 reform aftermath (H/M):** design for GDPR (stricter by default); hire a
fractional privacy counsel; maintain public compliance log.
**Mexican B2G procurement cycles (H/M):** 12–18 months typical; go subnational first (Oaxaca, Yucatán,
Jalisco, SEPI-CDMX); leverage universities and international NGOs as adoption bridges; CONACyTFrontera/FONDEC grants to bypass CompraNet.
**Climate-driven data decay (H/M):** continual learning; monthly retraining pipeline; publish data-freshness
indicator on each taxon page; partner with CONABIO monitoreo for climate-adjusted baselines.
**Trademark dispute with Inventia RASTRUM (L-M/H):** file in MX class 42 within 30 days; disambiguation
statement; 2–3 backup names pre-cleared; budget MXN 50–150K for potential nullity proceeding; preemptive coexistence-letter outreach to Inventia IP counsel (different field of use often accepted).
## 13. Feature roadmap: v1 must-have, v2 should-have, v3 later, skip
**v1 must-have (ship now or retroactive migration will be painful):** Darwin Core `basisOfRecord` /
`occurrenceStatus` / `establishmentMeans` with structured enums; Audubon Core mandatory fields for all

media (`ac:accessURI`, `ac:hashFunction`, `dc:license`); FPIC + CARE principles adoption as policy; basic
Event structure with effort fields (retrofitting to Event Core later is costly); sensitive-taxa obscuration with
credentialed-researcher access path; community-override on data sharing.
**v2 should-have (6–12 months post-v1):** Event Core + MoF + Humboldt Extension exports (transforms
Rastrum from observation logger to research platform); POWO/Tropicos/MEXU plant taxonomy resolver; full
Audubon/Audiovisual Core 2023 terms; MAD-MEX + MapBiomas + Global Forest Watch overlays (strategic
anchor for Mexico/LATAM positioning); CONAGUA/SMN weather integration; SMART-compatible export +
Ranger/Patrol mode (opens CONANP institutional channel); **CyberTracker-style icon UI for low-literacy
users** (signature differentiator aligning with Indigenous-language positioning); AudioMoth deployment
registry + BirdNET-Analyzer pipeline; Wildbook integration for jaguar + whale shark (two flagship Mexican
species with active Wildbooks — Whiskerbook, Sharkbook); crop detection + auto-focus guidance + multiangle composite ID; Local Contexts TK/BC Labels integration; ethnobotany/TEK module with consent; eBird +
point-count + Pollard + NAAMP protocol library; phenology protocols for key Mexican species (magueys,
oaks, cacti); BioBlitz mode; SEP-aligned education module pilot; camera trap upload with MegaDetector prefilter.
**v3 nice-to-have (12–24 months):** scientific publication pipeline via Pensoft ARPHA for notable records;
eDNA sample metadata using FAIRe checklist; BOLD/GenBank cross-reference fields; soundscape indices
dashboard + OpenSoundscape training UI; Rainforest Connection Guardian alert ingestion; ARCore Geospatial
+ WebXR AR at signature PITs; herbarium digitization with LLM-powered OCR (2026 LLM OCR is a real leap;
MEXU partnership possible); IoT sensors (LoRaWAN soil + weather); marine coral/debris/seagrass modules;
LiDAR canopy overlays (GEDI); expanded Wildbook individual-ID for tapir, margay, manta; training/certification
program; biodiversity credit data-model compatibility (Wallacea/Verra) — design for but don't depend on;
CyberTracker webhook ingestion.
**Skip or defer:** **blockchain for core data provenance** (GBIF datasetKey + DOI + DataCite + Preston
content-addressed hashing solve the real problem without overhead; ECKOchain-style proposals are research
curiosity, not production); **KlimaDAO/Regen Network integration** (speculative, reputationally risky, weak
Indigenous-led support); ABCD standard (DwC dominates LATAM); MAPS banding (too specialized, requires
permits); BBS protocol (Mexico has Monitoreo de Aves); DarwinCore-Germplasm (only if specific seed-bank
partnership); local guide marketplace (scope-creep risk — potential v4 fork); full biodiversity credit registry (if
market emerges, pick established registry not build).
## 14. Community and growth: Oaxaca first, quarterly cadence
**Oaxaca is the right seed ground** for four compounding reasons: highest Indigenous-language density
(52.7% speak an Indigenous language; Zapoteco 490K, Mixteco 515K, Chinanteco, Mixe, Mazateco); highest
endemism and biodiversity; lowest connectivity (62.5% internet penetration) which validates offline-first;
strongest ejido/comunal forest institutions (Ixtlán de Juárez FSC-certified community forest enterprise;
Pueblos Mancomunados and Expediciones Sierra Norte operating since 1994–98; Capulálpam de Méndez

Pueblo Mágico; active CONANP protected areas Tehuacán-Cuicatlán, Huatulco, Lagunas de Chacahua).
Proximity to academic partners at Tec de Monterrey (MAIA program), UNAM, IPN CIIDIR Oaxaca
closes the loop.
**Q1:** MoUs with CONABIO (NaturaLista interop API terms), INECOL, IPN CIIDIR Oaxaca. Field partnerships
with Ecoturixtlán and Expediciones Sierra Norte. Zapoteco UI translation via UNAM linguistics + communitymember review. 3 community partnerships signed; Zapoteco MVP strings 100% translated. **Q2:** closed
beta with ~20 monitores comunitarios across 3 Ixtlán + Mancomunados sites; CONANP Tehuacán-Cuicatlán
pilot with 10 rangers on camera-trap batch workflow; BioBlitz #1 "Reto Sierra Norte" for Día Internacional de la
Biodiversidad (May 22); Tec and UNAM student ambassadors. 500 observations, 30 active users, <2% crash
rate, sync success ≥95%. **Q3:** register Oaxaca for City Nature Challenge 2027; open beta with NaturaLista
interop; onboard Huatulco and Lagunas de Chacahua CONANP rangers; content partnerships with Pronatura
Sur, Terra Habitus, Endesu; first public Rastrum Scout (Oaxaca-trained RAG). 2,000 observations, 150 active
users, 1 academic partnership course using Rastrum. **Q4:** add Mixteco language layer; Maya Yucateco
scaffolding; expand to Sian Ka'an (Q. Roo) and Calakmul (Campeche) leveraging the Sierra Gorda jaguarcommunity-monitor pattern CONANP proved in 2026; Tec capstone partnership; Q4 BioBlitz aligned with
CONABIO calendar; Tec/UNAM institutional license pilots. 10,000 observations, 500 active users, CNC 2027
Oaxaca ready.
**Priority academic partnerships:** Tec de Monterrey MAIA (internal hackathons, capstones, institutional
license); UNAM Instituto de Biología and FES Iztacala/Zaragoza (taxonomy curation, model validation,
student ambassadors); IPN CIIDIR Oaxaca (regional AI training data); UAM Iztapalapa (hydrobiology,
freshwater module); ECOSUR (Chiapas/Q. Roo expansion lead); INECOL (Veracruz, central/Gulf partner);
UABC, UAAAN, UADY, CINVESTAV for regional pilots. **Priority NGOs:** Pronatura (Noreste, Sur, Veracruz
chapters as regional pilots); Naturalia (large mammals — jaguar, lobo mexicano); Terra Habitus (grassroots
central MX); Endesu (insular endemics — Revillagigedo, Socorro); Reforestamos México (already partnered
with Audubon on Izta-Popo bird tourism); Conselva (NW coastal/desert); WWF México as Wildlife Insights
bridge.
**Ride the existing event calendar, don't create competing events in year one.** CNC happens late April
annually (2024 saw 83,528 participants globally, **Monterrey #2 globally by observations**). CONABIO's Reto
Naturalista Urbano drives annual surges. CONANP runs smaller recurring bioblitzes in protected areas.
Position Rastrum as participant first, event creator second.
## Conclusion
Rastrum is a real opportunity, but the founder's most dangerous temptation is to build the spec as written.
**The four decisions that most determine outcome are: (1) scope discipline — v0.1 in 3 months with photoonly + offline + Zapoteco + Darwin Core, not the full multi-modal stack; (2) legal structure — Mexican A.C. +
U.S. fiscal sponsor started this quarter, not next year; (3) license shift — AGPL/Apache/CC hybrid, not MIT,
before external contributors arrive; (4) CARE-first Indigenous data sovereignty operationalized via Local

Contexts Labels and an Indigenous advisory council with real veto power, as the core moat.** The technical
stack almost chooses itself once these are clear: SvelteKit + Supabase (with option to self-host in `mxcentral-1`) + Dexie + ONNX Runtime Web + Cloudflare R2 + PostGIS + pgvector + Claude Haiku 4.5 routed
through Gemini Flash-Lite first-pass + PlantNet Pro + Capacitor wrap.
The Oaxaca-first playbook with Zapoteco Indigenous-language UI and Ixtlán de Juárez as anchor community
partner is not just a launch strategy — **it is the credibility story that turns every grant application and every
partnership conversation into a differentiated pitch**. No competitor can match this combination quickly.
iNaturalist cannot replicate it without replacing its global posture. Google/Wildlife Insights cannot match it
without losing scale advantages. Glority will not attempt it because there is no consumer subscription
revenue in the strategy.
The realistic financial outcome is a sustainable mission-led organization with $3–6M ARR within 5 years,
funded 40% by international grants, 35% by B2G/B2B SaaS to Mexican and LATAM institutions, 15% by
training programs and sponsored events, and 10% by API licensing and consumer donations. This is smaller
than Glority's PictureThis ($100M+) and larger than iNaturalist ($4M) — it is neither failure nor Silicon Valley
outcome. It is the exact shape of a durable biodiversity commons built on the founder's specific advantages:
Mexico City residence, Oaxaca roots, MAIA academic channel, and the unusual
quadrant of open-source + Indigenous + LATAM + offline-first that no other founder is positioned to occupy.
**Act immediately on three things: apply for NVIDIA Inception and AWS Activate this week; email Fundación
Alfredo Harp Helú Oaxaca for an introduction meeting; and file a Mexican trademark search on "Rastrum" via
MARCANET to confirm the Inventia conflict is avoidable.** Everything else in this dossier can wait until those
three are done.

