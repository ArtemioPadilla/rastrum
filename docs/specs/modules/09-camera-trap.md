# Module 09 — Camera Trap Analysis (Fototrampeo)

**Version target:** v1.0 (months 7–12)
**Status:** on-device pre-filter implemented. Plugin (`src/lib/identifiers/camera-trap-megadetector.ts`) runs MegaDetector v5a as YOLOv5 ONNX in the browser via `onnxruntime-web` (helpers in `megadetector-yolo.ts`, cache in `megadetector-cache.ts`). Empty / human / vehicle frames throw `FilteredFrameError`, which the cascade catches and short-circuits — no cloud quota burned on non-animal frames. Animal frames throw a fall-through, so the species cascade (PlantNet → Claude → Phi → EfficientNet) runs against the full frame. Bulk-upload UI shipped at `/profile/import/camera-trap`. The cascade prefers this plugin for `evidence_type=camera_trap` photos.
**Operator action remaining:** convert MegaDetector v5a to ONNX (one-shot via the upstream `export.py`) and host `megadetector_v5a.onnx` behind a CORS-open `PUBLIC_MEGADETECTOR_WEIGHTS_URL`. Until that's done the plugin reports `model_not_bundled` and the cascade transparently falls through.
**Spec author:** Eugenio Padilla + Claude (2026-04-24)
**Last verified:** 2026-04-27.

---

## Next steps

In priority order, what would deepen this pipeline beyond the v1.0 cut:

1. **Bbox-aware species cascade** — when MegaDetector finds an animal, pass the bbox forward in `IdentifyInput.prior_candidates` (or extend the input shape) so PlantNet/Claude/Phi run on a tight crop, not the full frame. Crops are a ×3-×5 accuracy bump on small subjects in distant traps. Effort: ~1 day in `cascade.ts` + each plugin's preprocess. Blocker: shape extension to `IdentifyInput` (mediaCrop?: bbox).
2. **Distilled SpeciesNet for on-device animal classification** — a small (~100 MB) ONNX-quantised animal classifier trained on iWildCam categories slots in as a sibling on-device model. Frees us from depending on cloud LLMs for species ID on common camera-trap species (deer, peccary, jaguarundi, ocelot, etc). Effort: training pipeline + hosting + plugin (~1 week).
3. **Server-side fallback (already-wired alternate path)** — keep `PUBLIC_MEGADETECTOR_ENDPOINT` as a switchable server route for low-end devices that can't run the ONNX. Need a small "use server-side detector" toggle in Profile → Edit → AI settings, defaults off. The server path is already implemented at git history ref `9174d32` and can be re-enabled by reverting one commit.
4. **Hosting recipe** — a Modal.com app (or Lambda / Replicate variant) packaged under `infra/megadetector/` for one-shot deploy to fill `PUBLIC_MEGADETECTOR_WEIGHTS_URL` (and optionally the server endpoint). Effort: ~1 day.
5. **CONANP fototrampeo export profile** — the existing DwC-A export module already supports `evidence_type=camera_trap`; a CONANP-specific column profile (camera ID, trap-night counts, detection-event grouping) would make the bulk-upload artefact directly publishable.
6. **Audio camera-trap** — many modern traps record audio alongside photo. BirdNET-Lite already lives on-device; wiring evidence_type=camera_trap photos with attached audio into the same review queue is mostly UI work.

---

## Overview

Bulk upload and automated analysis of camera trap images and videos.
Three-stage pipeline: (1) MegaDetector filters empty/human/animal frames,
(2) SpeciesNet classifies to species, (3) Rastrum enriches with NOM-059 status,
exports to CONANP fototrampeo format and Darwin Core.

Replaces the manual workflow currently sold as $800–$1,749 MXN courses by
organizations like Cencoatl Capacitación Profesional.

---

## Pipeline Overview

```
Camera trap SD card / ZIP upload
        |
        v
[1] MegaDetector v5 (Microsoft/WILDLABS)
    Classifies each frame: animal | person | vehicle | empty
    Confidence threshold: 0.2 (low = keep for review, don't discard)
        |
        |-- empty (conf > 0.8)  → discard from review queue
        |-- person / vehicle    → flag, obscure location, notify
        |-- animal              → pass to SpeciesNet
        v
[2] SpeciesNet (Google, open-source March 2025)
    Classifies to species from 2,000+ species
    Returns top-5 with confidence scores
        |
        |-- conf >= 0.7 → Accept as primary ID
        |-- conf < 0.7  → Queue for expert review
        v
[3] Rastrum enrichment
    - Match to GBIF backbone taxon
    - Check NOM-059 / CITES / IUCN status
    - Apply location obscuration if sensitive
    - Generate activity histogram (24h)
    - Export: Darwin Core + CONANP fototrampeo format
```

---

## MegaDetector Integration

**Model:** MegaDetector v5a (YOLO-based, ~200MB)
**Run:** Server-side (Supabase Edge Function or dedicated worker)

```typescript
// Edge Function: functions/megadetector/index.ts
interface MegaDetectorResult {
  file: string;
  detections: Array<{
    category: '1' | '2' | '3' | '4'; // 1=animal, 2=person, 3=vehicle, 4=empty
    conf: number;
    bbox: [number, number, number, number]; // [x, y, width, height] normalized
  }>;
  max_detection_conf: number;
}

async function runMegaDetector(imageUrl: string): Promise<MegaDetectorResult> {
  // POST to self-hosted MegaDetector endpoint (AWS Lambda or Supabase Edge)
  const res = await fetch(Deno.env.get('MEGADETECTOR_ENDPOINT')!, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ url: imageUrl }),
  });
  return res.json();
}
```

**Self-hosting options (in cost order):**
1. AWS Lambda container (GPU-less, ~3s/image) — ~$0.002/image
2. Modal.com (GPU, ~0.3s/image) — ~$0.005/image
3. Replicate API (MegaDetector model hosted) — ~$0.01/image

---

## SpeciesNet Integration

**Model:** SpeciesNet (Google Research, open-sourced March 2025)
**GitHub:** github.com/google/species-net
**Coverage:** 2,000+ species, strong on Neotropical fauna

```typescript
interface SpeciesNetResult {
  predictions: Array<{
    scientific_name: string;
    common_name: string;
    gbif_id: number;
    confidence: number;
    taxonomy: {
      kingdom: string; phylum: string; class: string;
      order: string; family: string; genus: string;
    };
  }>;
  bbox_used: [number, number, number, number]; // crop sent to classifier
}

async function runSpeciesNet(imageUrl: string, bbox: number[]): Promise<SpeciesNetResult> {
  const res = await fetch(Deno.env.get('SPECIESNET_ENDPOINT')!, {
    method: 'POST',
    body: JSON.stringify({ url: imageUrl, bbox }),
  });
  return res.json();
}
```

**Fallback for low-confidence:** Route to Claude Haiku 4.5 with crop + top-3 SpeciesNet candidates for disambiguation — same pattern as photo ID module 01.

---

## Bulk Upload Flow

```typescript
interface CameraTrapUpload {
  id: string;
  project_name: string;            // e.g. "Sierra Juárez Norte - Sitio 3"
  camera_id: string;               // physical camera identifier
  deployment_start: string;        // ISO date
  deployment_end: string;
  location: { lat: number; lng: number; accuracy_m: number };
  habitat: string;
  files: File[];                   // ZIP or individual images/videos
  total_images: number;
}

// Processing states per image
type FrameStatus =
  | 'queued'
  | 'megadetector_running'
  | 'speciesnet_running'
  | 'needs_review'    // confidence < 0.7
  | 'accepted'        // confidence >= 0.7 + no flag
  | 'flagged_person'  // human detected
  | 'empty';          // no animal detected
```

---

## Activity Histogram

Per-species or per-camera 24h activity:

```sql
-- Activity histogram query
SELECT
  species_name,
  EXTRACT(HOUR FROM observed_at AT TIME ZONE 'America/Mexico_City') AS hour_local,
  COUNT(*) AS detections
FROM camera_trap_detections
WHERE camera_deployment_id = $1
  AND confidence >= 0.5
GROUP BY species_name, hour_local
ORDER BY species_name, hour_local;
```

Renders as radial clock chart (0–23h) per species — standard in camera trap analysis.

---

## CONANP Fototrampeo Export Format

Based on CONANP's *Manual de Fototrampeo en Áreas Naturales Protegidas* (2017):

```typescript
interface CONANPRecord {
  // Station metadata
  nombre_anp: string;               // "Sierra de Juárez"
  nombre_sitio: string;             // "Sitio 3 - Norte"
  id_camara: string;
  latitud: number;
  longitud: number;
  datum: 'WGS84';
  altitud_msnm: number;
  tipo_vegetacion: string;
  fecha_instalacion: string;        // DD/MM/YYYY
  fecha_retiro: string;

  // Detection record
  nombre_cientifico: string;
  nombre_comun: string;
  fecha_foto: string;               // DD/MM/YYYY
  hora_foto: string;                // HH:MM:SS
  numero_individuos: number;
  sexo?: 'M' | 'H' | 'ND';
  edad?: 'Adulto' | 'Juvenil' | 'Cría' | 'ND';
  comportamiento?: string;
  observaciones?: string;
  archivo_foto: string;             // filename
  confianza_modelo: number;         // 0.00–1.00
}
```

Export as `.xlsx` (CONANP standard) + `.csv` + Darwin Core Archive.

---

## Database Tables

```sql
-- Camera deployments
CREATE TABLE camera_deployments (
  id              uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  observer_id     uuid NOT NULL REFERENCES users(id),
  project_name    text NOT NULL,
  camera_id       text NOT NULL,
  location        geography(Point, 4326) NOT NULL,
  habitat         text,
  deployment_start timestamptz NOT NULL,
  deployment_end  timestamptz,
  total_images    integer DEFAULT 0,
  processed_images integer DEFAULT 0,
  anp_name        text,            -- CONANP ANP name if inside protected area
  created_at      timestamptz DEFAULT now()
);

-- Individual frame detections
CREATE TABLE camera_trap_detections (
  id                  uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  deployment_id       uuid NOT NULL REFERENCES camera_deployments(id),
  filename            text NOT NULL,
  image_url           text NOT NULL,
  observed_at         timestamptz,              -- from EXIF or filename
  -- MegaDetector
  md_category         text,                     -- 'animal'|'person'|'vehicle'|'empty'
  md_confidence       numeric,
  md_bbox             jsonb,                    -- [x,y,w,h]
  -- SpeciesNet / ID
  scientific_name     text,
  common_name_es      text,
  taxon_id            uuid REFERENCES taxa(id),
  confidence          numeric,
  id_source           text,                     -- 'speciesnet'|'claude_haiku'|'human'
  top_predictions     jsonb,                    -- top-5 candidates
  -- Review
  status              text DEFAULT 'queued',
  reviewed_by         uuid REFERENCES users(id),
  reviewed_at         timestamptz,
  -- Individuals
  individual_count    integer DEFAULT 1,
  sex                 text,
  age_class           text,
  behavior_notes      text,
  created_at          timestamptz DEFAULT now()
);

CREATE INDEX idx_ctd_deployment ON camera_trap_detections(deployment_id, observed_at);
CREATE INDEX idx_ctd_taxon ON camera_trap_detections(taxon_id);
CREATE INDEX idx_ctd_status ON camera_trap_detections(status) WHERE status = 'needs_review';
```

---

## UI — Review Queue

```
┌─────────────────────────────────────────────────────────┐
│ Sierra Juárez Norte · Sitio 3 · 847 imágenes            │
│ ████████████░░░░░ 68% processed                         │
├─────────────────────────────────────────────────────────┤
│ [Vacías: 412] [Personas: 3⚠️] [Animales: 312] [Cola: 120]│
├─────────────────────────────────────────────────────────┤
│                                                         │
│ [📷 2026-04-18 02:34]  Puma concolor  ████ 0.90         │
│ [📷 2026-04-18 02:35]  Puma concolor  ███░ 0.74         │
│ [📷 2026-04-19 21:12]  Odocoileus sp  ██░░ 0.51  [Revisar]│
│ [📷 2026-04-20 03:01]  ??? desconocido           [Revisar]│
│                                                         │
│ [Exportar CONANP .xlsx]  [Exportar Darwin Core]         │
└─────────────────────────────────────────────────────────┘
```

---

## Cost Model

| Volume | Cost |
|--------|------|
| 1,000 images/month | ~$2 (Lambda + SpeciesNet) |
| 10,000 images/month | ~$20 |
| 50,000 images/month (institutional) | ~$100 |

**vs. Cencoatl course:** $800–$1,749 MXN one-time for manual workflow.
Rastrum automates it for ~$2–$20/month at community scale.

---

## Priority Species for Oaxaca Deployments

Based on Eugenio Padilla's field knowledge (Sierra Juárez, Valle de Oaxaca):

| Species | NOM-059 | Priority |
|---------|---------|---------|
| *Puma concolor* | Pr | High |
| *Odocoileus virginianus* | — | High |
| *Tayassu pecari* | A | High |
| *Nasua narica* | — | Medium |
| *Procyon lotor* | — | Medium |
| *Canis latrans* | — | Medium |
| *Leopardus pardalis* | P | Critical |
| *Tapirus bairdii* | P | Critical |
| *Ursus americanus* | A | High |
