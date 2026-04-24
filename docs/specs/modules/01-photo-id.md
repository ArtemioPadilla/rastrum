# Module 01 — Photo ID Pipeline

**Version target:** v0.1
**Status:** Not started

---

## Overview

Multi-model cascade for species identification from a single photo or multi-photo observation. First-pass is PlantNet (plants only), second-pass is Claude Haiku 4.5. Offline fallback is EfficientNet-Lite0 ONNX.

---

## API: PlantNet

**Endpoint:** `POST https://my-api.plantnet.org/v2/identify/all`

**Auth:** `api-key` query param (env: `PLANTNET_API_KEY`)

**Request:**
```typescript
const form = new FormData();
form.append('images', imageBlob, 'photo.jpg');
form.append('organs', 'auto'); // auto-detect: leaf, flower, fruit, bark, habit

const res = await fetch(
  `https://my-api.plantnet.org/v2/identify/all?api-key=${key}&lang=es&nb-results=5`,
  { method: 'POST', body: form }
);
```

**Response shape:**
```typescript
interface PlantNetResult {
  query: { project: string; organs: string[] };
  results: Array<{
    score: number;                          // 0.0–1.0 confidence
    species: {
      scientificNameWithoutAuthor: string;
      scientificNameAuthorship: string;
      genus: { scientificNameWithoutAuthor: string };
      family: { scientificNameWithoutAuthor: string };
      commonNames: string[];
    };
    gbif: { id: number };
  }>;
  remainingIdentificationRequests: number;
}
```

**Decision logic:**
- If `results[0].score >= 0.7` → accept as PlantNet result, skip Claude
- If `results[0].score < 0.7` → pass top-3 candidates to Claude Haiku for disambiguation
- If PlantNet returns error or no results → go directly to Claude Haiku

---

## API: Claude Haiku 4.5 (Vision)

**Model:** `claude-haiku-4-5` via Anthropic SDK
**When used:** PlantNet confidence < 0.7, non-plant species, or fauna/fungi

**System prompt (cached — never changes):**
```
You are a field biologist assistant specializing in Mexican biodiversity.
Identify the species in the photo. Respond ONLY with valid JSON matching the schema.
If you cannot identify, set confidence to 0 and explain in notes.
Focus on species found in Mexico, Central America, and the Caribbean.
```

**User message:**
```typescript
const userMessage = [
  {
    type: 'image',
    source: { type: 'base64', media_type: 'image/jpeg', data: base64Image }
  },
  {
    type: 'text',
    text: plantNetCandidates
      ? `PlantNet suggests: ${plantNetCandidates}. Confirm or correct.`
      : `Location: ${lat}, ${lng}. Habitat: ${habitat}. Identify this species.`
  }
];
```

**Expected JSON response:**
```typescript
interface ClaudeIDResult {
  scientific_name: string;          // e.g. "Quercus rugosa"
  common_name_es: string;           // Spanish common name
  common_name_en: string;
  family: string;
  kingdom: 'Plantae' | 'Animalia' | 'Fungi' | 'Chromista' | 'Bacteria' | 'Unknown';
  confidence: number;               // 0.0–1.0
  nom_059_status: string | null;    // 'P' | 'A' | 'Pr' | 'E' | null
  notes: string | null;
  alternative_species: Array<{
    scientific_name: string;
    confidence: number;
  }>;
}
```

**Batch API:** Use `anthropic.beta.messages.batches.create()` for non-realtime flows (camera trap processing). Saves 50% cost.

**Prompt caching:** System prompt uses `cache_control: { type: 'ephemeral' }`. Saves ~90% on system prompt tokens.

---

## Offline Fallback: EfficientNet-Lite0 ONNX

**Bundle:** `public/models/efficientnet-lite0-int8.onnx` (~2.8 MB)
**Runtime:** ONNX Runtime Web (`ort`) with `executionProviders: ['webgpu', 'wasm']`

```typescript
import * as ort from 'onnxruntime-web';

async function identifyOffline(imageData: ImageData): Promise<OfflineResult> {
  const session = await ort.InferenceSession.create('/models/efficientnet-lite0-int8.onnx', {
    executionProviders: ['webgpu', 'wasm'],
  });

  const tensor = preprocessImage(imageData); // resize to 224x224, normalize
  const feeds = { images: tensor };
  const output = await session.run(feeds);
  const scores = output['Softmax:0'].data as Float32Array;

  // Top-5 from labels file
  return getTopK(scores, 5, LABELS_MEX); // regional labels file
}
```

**Regional packs (lazy-loaded into IndexedDB):**
- `models/oaxaca-pack.onnx` (~18 MB) — Oaxaca endemic species
- `models/yucatan-pack.onnx` (~15 MB) — Yucatán/Caribbean species

---

## Routing Logic

```typescript
async function identify(photo: File, context: ObservationContext): Promise<IDResult> {
  // 1. Check connectivity + model availability
  const online = navigator.onLine;
  const isPlant = context.userHint === 'plant' || await quickPlantCheck(photo);

  if (!online) {
    return identifyOffline(await toImageData(photo));
  }

  // 2. PlantNet first (plants only, fast, cheap)
  if (isPlant) {
    const pn = await plantNetIdentify(photo);
    if (pn.results[0]?.score >= 0.7) {
      return formatPlantNetResult(pn);
    }
    // Low confidence → augment with Claude
    return claudeIdentify(photo, context, pn.results.slice(0, 3));
  }

  // 3. Claude Haiku for fauna/fungi/unknown
  return claudeIdentify(photo, context, null);
}
```

---

## Pre-ID Quality Check

Before submitting to API, warn user if:
```typescript
function checkImageQuality(file: File): QualityWarning[] {
  const warnings: QualityWarning[] = [];
  if (file.size < 50_000) warnings.push({ type: 'LOW_RES', msg: 'Image may be too small for accurate ID' });
  // Blur detection via Laplacian variance (client-side canvas)
  const blurScore = computeLaplacianVariance(imageData);
  if (blurScore < 100) warnings.push({ type: 'BLURRY', msg: 'Image appears blurry' });
  return warnings;
}
```

---

## Cost Model

| Volume | Model | Monthly cost |
|--------|-------|-------------|
| 10K MAU × 3 IDs/day | Gemini Flash-Lite (50%) + Haiku 4.5 (50%) | ~$500 |
| Camera trap batches | Haiku Batch API (-50%) | ~$200 |
| Expert review | Sonnet (5% of IDs) | ~$300 |

---

## Data Stored

```sql
INSERT INTO identifications (
  observation_id,
  taxon_id,           -- FK to taxa table
  confidence,
  source,             -- 'plantnet' | 'claude_haiku' | 'claude_sonnet' | 'onnx_offline' | 'human'
  raw_response,       -- JSONB, full API response
  is_primary,         -- true for the accepted ID
  created_at
) VALUES (...);
```
