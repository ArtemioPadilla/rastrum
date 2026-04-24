# Rastrum v1.0 — Product Specification

## Vision

### Mission

Every living thing tells a story. Rastrum exists to help anyone — from seasoned field biologists to curious hikers — read those stories by identifying species from photographs, sound recordings, video, and the subtle traces organisms leave behind. We are building the bridge between observation and understanding, one species at a time.

### The Problem

Biodiversity observation today is fragmented across dozens of tools, each specialized for a narrow taxon or input type. A botanist uses one app, a birder another, and someone encountering animal tracks has almost nothing. Most platforms operate only in English, locking out millions of observers across Latin America and the Global South. Offline field use — the reality of biological fieldwork — is an afterthought. And critically, the AI models that power identification are trained overwhelmingly on data from North America and Europe, leaving Neotropical species chronically under-represented.

### The Solution

Rastrum is a unified, multilingual, open-source platform that accepts any form of biological evidence — photo, audio, video, tracks, scat, burrows, nests — and routes it through an ensemble AI pipeline (PlantNet, BirdNET, Claude Vision) to produce ranked identification candidates. Community experts validate results, building a growing open dataset that feeds back into regional model training. The entire system works offline in the field and exports to global biodiversity standards, connecting local observations to planetary-scale conservation.

---

## Core Features

### 1. Photo Identification

Photographs are routed to the most appropriate model based on preliminary classification:

- **Plants and Fungi** — PlantNet API, which provides taxon-specific confidence scores and morphological feature matching against a curated reference library.
- **Animals, Lichens, and General** — Claude Vision, which accepts free-form images and returns structured identification hypotheses with reasoning.
- **Output** — Top-3 candidate species, each with a confidence score (0-100), taxonomic hierarchy, and supporting visual evidence highlights.
- **Fallback** — If the top confidence is below 60%, the observation is automatically flagged for expert review.

### 2. Audio Identification

- **Engine** — BirdNET neural network for birds; extended models for frogs, insects, and marine mammals as they become available.
- **Interface** — Waveform and spectrogram display with selectable time regions for isolating target vocalizations.
- **Metadata** — Habitat type, elevation, time of day, and weather conditions are recorded alongside audio to improve identification accuracy.
- **Batch mode** — Upload multiple recordings from autonomous recorders (AudioMoth, Song Meter) for bulk processing.

### 3. Video Analysis

- **Frame extraction** — Intelligent keyframe selection at moments of maximum information (movement peaks, profile views, close-ups) using scene-change detection.
- **Parallel audio pipeline** — Audio track is extracted and processed through BirdNET/audio models simultaneously with visual analysis.
- **Temporal context** — Behavioral annotations (flight pattern, gait, feeding behavior) are captured across frames to aid identification.

### 4. Ecological Evidence

Indirect evidence of species presence is a first-class input type:

- **Supported types** — Tracks/footprints, scat/droppings, burrows, nests, feeding signs (browse damage, bark stripping, prey remains), and territorial markings.
- **Size reference** — A known-size reference object (coin, ruler, hand) is required in frame for dimensional analysis.
- **Substrate context** — Soil type, moisture, vegetation context are factored into identification.
- **Model** — Claude Vision with specialized prompting for trace evidence interpretation.

### 5. Observation Log

Every identification is wrapped in a rich observation record:

- **GPS coordinates** — Automatic from device, manual pin-drop, or named locality lookup.
- **Timestamp** — Device time with timezone, adjustable for recordings made earlier.
- **Weather** — Temperature, humidity, wind, cloud cover (auto-fetched from nearest station or manual entry).
- **Habitat type** — Structured vocabulary: forest, grassland, wetland, desert, marine, urban, agricultural, etc.
- **Observer notes** — Free-text field for behavioral observations, context, and field conditions.
- **Effort data** — Transect length, observation duration, party size (for standardized survey protocols).

### 6. Expert Curation

- **Community validation** — Any registered user can agree/disagree with an identification and suggest alternatives.
- **Expert badge system** — Users earn taxon-specific expert badges through sustained, accurate identification contributions. Badges are granted per taxonomic group (e.g., "Expert: Neotropical Orchids").
- **Weighted consensus** — Expert votes carry more weight than general community votes. Consensus thresholds vary by taxonomic difficulty.
- **Dispute resolution** — When experts disagree, a structured discussion thread opens with evidence requirements. Unresolved disputes are escalated to regional taxonomic authorities.

### 7. Species Pages

Each species in the database has a rich profile page:

- **Range map** — Known distribution polygon plus observation point overlay.
- **Phenology** — Seasonal activity chart (flowering, breeding, migration) by region.
- **Conservation status** — IUCN Red List category, national listings (NOM-059 for Mexico, etc.), CITES appendix.
- **Similar species** — Comparison table with key distinguishing features and photos.
- **Taxonomy** — Full hierarchical classification with synonyms and common names in multiple languages.
- **Observations** — Gallery of community-submitted observations with identification confidence.

### 8. Offline Mode

- **Regional model caching** — Users select geographic regions; compressed models and reference data are downloaded for offline use.
- **Queue system** — Observations made offline are queued and automatically synced when connectivity returns.
- **Degraded-graceful** — Offline identifications use cached models with reduced candidate pools; full ensemble scoring runs on sync.
- **Storage management** — Dashboard showing cached region sizes with options to update or remove.

### 9. Export and Interoperability

- **Darwin Core** — All observations export to Darwin Core Archive format for direct submission to GBIF.
- **iNaturalist** — Cross-posting to iNaturalist with observation linkage.
- **CSV/GeoJSON** — Standard formats for GIS analysis and custom workflows.
- **API** — RESTful API for programmatic access to observations and identifications.

---

## Roadmap

| Phase | Timeline | Milestone | Key Deliverables |
|-------|----------|-----------|-----------------|
| **v0.1 Alpha** | Month 1-2 | Foundation | Astro skeleton with i18n, Supabase schema, photo ID MVP (PlantNet only), basic observation log |
| **v0.2 Beta** | Month 3-4 | Intelligence | Claude Vision integration, GPS tagging, weather auto-fetch, observation detail pages |
| **v0.3** | Month 5-6 | Community | Audio ID (BirdNET), user accounts, expert validation system, community voting |
| **v1.0** | Month 7-9 | Full Platform | Video support, offline mode, Darwin Core export, PWA installation, species pages |
| **v2.0** | Future | Next Frontier | Regional ML models trained on community data, AR species overlay, autonomous recorder integration |

---

## Data Model

### Supabase Schema

```
users
├── id: uuid (PK)
├── email: text (unique)
├── display_name: text
├── avatar_url: text
├── role: enum (observer, expert, admin)
├── expert_taxa: text[] — taxonomic groups for expert badge
├── created_at: timestamptz
└── updated_at: timestamptz

observations
├── id: uuid (PK)
├── user_id: uuid (FK → users)
├── latitude: float8
├── longitude: float8
├── observed_at: timestamptz
├── habitat_type: text
├── weather_json: jsonb — {temp, humidity, wind, clouds}
├── notes: text
├── status: enum (pending, identified, validated, disputed)
├── created_at: timestamptz
└── updated_at: timestamptz

media_files
├── id: uuid (PK)
├── observation_id: uuid (FK → observations)
├── file_type: enum (photo, audio, video, evidence)
├── storage_path: text
├── mime_type: text
├── metadata_json: jsonb — EXIF, duration, dimensions
├── created_at: timestamptz
└── sort_order: int

species
├── id: uuid (PK)
├── scientific_name: text (unique)
├── common_name_en: text
├── common_name_es: text
├── taxonomy_json: jsonb — {kingdom, phylum, class, order, family, genus}
├── iucn_status: text
├── range_geojson: jsonb
├── phenology_json: jsonb
├── description_en: text
├── description_es: text
└── created_at: timestamptz

identifications
├── id: uuid (PK)
├── observation_id: uuid (FK → observations)
├── species_id: uuid (FK → species)
├── source: enum (plantnet, birdnet, claude_vision, user, expert)
├── confidence: float4 (0-1)
├── rank: int — position in candidate list (1, 2, 3)
├── reasoning: text
├── raw_response_json: jsonb
├── created_at: timestamptz
└── created_by: uuid (FK → users, nullable for AI)

expert_validations
├── id: uuid (PK)
├── identification_id: uuid (FK → identifications)
├── expert_id: uuid (FK → users)
├── verdict: enum (agree, disagree, uncertain)
├── suggested_species_id: uuid (FK → species, nullable)
├── comment: text
├── created_at: timestamptz
└── updated_at: timestamptz
```

### Key Relationships

- One **observation** has many **media_files** (multi-evidence support).
- One **observation** has many **identifications** (AI candidates + user suggestions).
- One **identification** has many **expert_validations** (community review).
- **species** is the canonical reference table; identifications point to it.

### Row-Level Security

- Users can read all observations but only edit their own.
- Expert validations require the `expert` or `admin` role.
- Media file uploads are restricted to the observation owner.

---

## AI Pipeline Architecture

```
                        ┌─────────────────────────────────────────────┐
                        │              INPUT RECEIVED                  │
                        │    (photo / audio / video / evidence)        │
                        └──────────────────┬──────────────────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │ Preprocessor │
                                    │  - Resize    │
                                    │  - Normalize │
                                    │  - Classify  │
                                    │    input type│
                                    └──────┬──────┘
                                           │
                    ┌──────────────────────┼──────────────────────┐
                    │                      │                      │
             ┌──────▼──────┐       ┌──────▼──────┐       ┌──────▼──────┐
             │   PlantNet   │       │   BirdNET    │       │Claude Vision│
             │              │       │              │       │             │
             │ Plants/Fungi │       │ Birds/Frogs  │       │  General    │
             │ Specialized  │       │ Audio-based  │       │  Multimodal │
             └──────┬──────┘       └──────┬──────┘       └──────┬──────┘
                    │                      │                      │
                    └──────────────────────┼──────────────────────┘
                                           │
                                    ┌──────▼──────┐
                                    │  Ensemble    │
                                    │  Scoring     │
                                    │              │
                                    │ - Normalize  │
                                    │   scores     │
                                    │ - Weight by  │
                                    │   source     │
                                    │   expertise  │
                                    │ - Merge      │
                                    │   candidates │
                                    └──────┬──────┘
                                           │
                                    ┌──────▼──────┐
                                    │   Top-3      │
                                    │  Candidates  │
                                    └──────┬──────┘
                                           │
                              ┌────────────┼────────────┐
                              │                         │
                       ┌──────▼──────┐           ┌──────▼──────┐
                       │ High conf.  │           │ Low conf.   │
                       │ (≥ 80%)     │           │ (< 80%)     │
                       │             │           │             │
                       │ Auto-accept │           │ Expert      │
                       │ + community │           │ Review      │
                       │   display   │           │ Queue       │
                       └─────────────┘           └─────────────┘
```

### Pipeline Details

1. **Preprocessing** — Images are resized to model-optimal dimensions, normalized for exposure/white-balance. Audio is converted to standard sample rate, noise-reduced. Video triggers parallel frame + audio extraction.

2. **Model Routing** — A lightweight classifier determines input type and routes to the appropriate specialist model(s). Photos of plants/fungi go to PlantNet first; audio goes to BirdNET; everything else (animals, evidence, ambiguous) goes to Claude Vision. Multi-modal inputs may hit multiple models.

3. **Ensemble Scoring** — Results from all invoked models are normalized to a common confidence scale. Scores are weighted by model reliability for the detected taxon group. Duplicate species across models have their scores merged.

4. **Thresholding** — High-confidence results (>= 80%) are presented directly with community validation enabled. Low-confidence results are routed to the expert review queue for priority attention.

---

## Conservation Impact

### Data Contribution

- All validated observations are formatted as Darwin Core records and submitted to the **Global Biodiversity Information Facility (GBIF)**, the world's largest open biodiversity database.
- Observation data includes precise geolocation, temporal, and habitat metadata that is often missing from existing datasets for Latin American species.

### Institutional Partnerships

- **CONABIO** (Mexico) — National Biodiversity Commission, primary partner for Mexican species data and regional model validation.
- **CONANP** (Mexico) — National Commission of Natural Protected Areas, for observations within protected areas.
- **Regional herbaria and museums** — University of Costa Rica, Instituto de Biologia UNAM, Jardim Botanico do Rio de Janeiro, and others for taxonomic verification.

### Biodiversity Mapping

- Aggregate observation data generates **real-time biodiversity hotspot maps** that reveal species richness, seasonal patterns, and distribution shifts.
- Maps are publicly available and exportable for conservation planning, environmental impact assessments, and land-use decisions.

### Invasive Species Detection

- Known invasive species are flagged immediately upon identification, triggering alerts to relevant land managers and conservation authorities.
- Historical observation data enables tracking invasion fronts and predicting spread patterns.

### Community Science

- Rastrum lowers the barrier to meaningful biodiversity contribution by supporting multiple languages, offline use, and diverse evidence types.
- Every observation, regardless of observer expertise, becomes part of a growing dataset that strengthens identification models and conservation knowledge for under-studied regions.

---

## Technical Requirements

### Performance

- Photo identification response time: < 5 seconds (online), < 10 seconds (offline, cached model).
- Audio identification: < 8 seconds for recordings up to 60 seconds.
- PWA installation size: < 50 MB (base), regional cache varies by area.

### Security

- Supabase Row-Level Security on all tables.
- Media files served via signed URLs with expiration.
- User location data is coarsened for public display (grid cell, not exact coordinates) unless the observer opts in to precise sharing.

### Accessibility

- WCAG 2.1 AA compliance.
- Screen reader support for identification results.
- High-contrast mode compatible with dark/light themes.

### Internationalization

- Full interface in English and Spanish (Latin American).
- Species common names in both languages.
- Architecture supports additional locale addition without code changes.
