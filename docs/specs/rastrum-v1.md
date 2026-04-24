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

### v0.3 — Community (Month 5-6)

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

**Goal**: A complete, offline-capable platform ready for real fieldwork.

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

### v2.0 — Regional Intelligence (Future)

**Goal**: Rastrum becomes a data source, not just a data consumer.

- Regional ML models trained on Rastrum's community-validated observation data,
  purpose-built for Neotropical taxa.
- AR species overlay: point your camera at a landscape and see species annotations
  in real time (experimental).
- Acoustic monitoring integration: deploy BirdNET-Pi stations that feed observations
  directly into Rastrum.
- Biodiversity dashboard: hotspot maps, species richness indices, temporal trends
  for conservation partners.
- Multi-language expansion: Quechua, Nahuatl, Guarani common names and UI
  translations.
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
