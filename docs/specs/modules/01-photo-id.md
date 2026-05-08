# Module 01 — Photo ID Pipeline

**Version target:** v0.1
**Status:** shipped (PlantNet + Claude Haiku cascade live; on-device fallbacks via module 11/13)
**Last verified:** 2026-04-26 — `supabase/functions/identify/index.ts` + `src/lib/identifiers/{plantnet,claude}.ts` running in production.

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

## Offline Fallback

> **Scope note:** v0.1 ships **online-only**. The ONNX fallback lands in v0.3,
> regional packs in v0.5. When offline at v0.1, the app queues photos in Dexie
> and identifies them when connectivity returns (see module 03).

### EfficientNet-Lite0 ONNX (v0.3+)

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

### Regional packs (v0.5+, lazy-loaded into IndexedDB)

- `models/oaxaca-pack.onnx` (~18 MB) — Oaxaca endemic species
- `models/yucatan-pack.onnx` (~15 MB) — Yucatán/Caribbean species

---

## Routing Logic

```typescript
async function identify(photo: File, context: ObservationContext): Promise<IDResult> {
  const online = navigator.onLine;
  const isPlant = context.userHint === 'plant' || await quickPlantCheck(photo);

  // v0.1: no offline ID. Queue in Dexie; the sync engine runs identify()
  // when connectivity returns. See module 03.
  if (!online) {
    throw new QueueForLaterError('offline: observation queued, ID deferred');
  }

  // v0.3+: attempt on-device ONNX when offline and model is cached
  // if (!online && await hasOnnxModel()) {
  //   return identifyOffline(await toImageData(photo));
  // }

  // 1. PlantNet first (plants only, fast, cheap)
  if (isPlant) {
    const pn = await plantNetIdentify(photo);
    if (pn.results[0]?.score >= 0.7) {
      return formatPlantNetResult(pn);
    }
    // Low confidence → augment with Claude
    return claudeIdentify(photo, context, pn.results.slice(0, 3));
  }

  // 2. Claude Haiku for fauna/fungi/unknown
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

All figures assume Claude Haiku 4.5 list pricing (April 2026): **$1 / MTok input,
$5 / MTok output**. Prompt caching on the system prompt shaves ~90% off system
tokens; batch API saves 50% on non-realtime flows.

**Per-image token budget (Haiku 4.5, vision):**

| Component | Tokens |
|---|---|
| Image (1024×1024, `tokens ≈ width × height / 750`) | ~1,400 |
| System prompt (cached) | ~220 amortised (90% cache hit) |
| Context (location, habitat, PlantNet candidates) | ~200 |
| **Input total** | **~1,820** |
| JSON response (10 fields + 2 alternatives) | ~180 output |
| **Per-image cost** | **~1,820 × $1e-6 + 180 × $5e-6 ≈ $0.00282** |

**Monthly cost scenarios** (PlantNet handles ~50% of plant photos without
Claude; Claude is invoked for the other 50% plus all fauna/fungi/evidence):

| Volume | Claude calls | Monthly Claude cost | PlantNet (free tier) |
|---|---|---|---|
| 1K MAU × 2 IDs/day × 30d = 60K IDs | 30K | ~$85 | 30K (within free tier) |
| 10K MAU × 2 IDs/day × 30d = 600K IDs | 300K | ~$850 | 300K (paid tier est. ~$150) |
| Camera trap batches (async, Batch API –50%) | 100K | ~$140 | n/a |
| Expert review escalations (Sonnet 4.6) | 5% of 600K = 30K | ~$600 | n/a |

**Risk notes:**
- Haiku vision pricing has moved twice since Jan 2026; re-verify before launch.
- PlantNet free tier is 500 req/day per key; at 10K MAU we will need the paid
  tier or a key-pool strategy.
- Gemini Flash-Lite was considered as a cheap first-pass and **rejected** — it
  underperforms on Neotropical taxa and adds a third vendor.

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

---

## Disambiguation flow (issue #615)

When the cascade returns two candidates with similar confidence, the user
gets a banner above the result card asking for a second, more diagnostic
photo.

**Trigger** — pure helper `shouldDisambiguate(best, alternates, thresholds)`
in `src/lib/disambiguation.ts`:

- top-2 must exist and have different `scientific_name`
- `(top1.confidence - top2.confidence) < gap` (default `0.15`)
- Both confidences `>= floor` (default `0.30`)

**Thresholds** live in `public.cascade_config` (RLS public read). Two seeded
keys: `disambiguation_gap_threshold`, `disambiguation_min_confidence`.
Tunable at runtime via the admin console without a deploy.

**LLM prompt** — generated by extending the existing `identify` Edge Function
with `mode: 'disambiguate'`. The same BYO/sponsorship/pool credential chain
the photo cascade uses applies — disambiguation never bypasses quota. The
prompt is cached in `public.taxon_pair_disambiguations` keyed by canonical
(alphabetical) `(taxon_a, taxon_b)`. Subsequent callers hit the cache.

**UI** — `DisambiguationBanner.astro` is event-driven:

- consumers dispatch `rastrum:disambiguation-show` with `{top1, top2}`
- the banner fetches the prompt + paints
- user taps "Take another photo" → banner dispatches `rastrum:disambiguation-retry`
  → consumers re-open their capture path
- "Skip" closes the banner; the existing alternates list under the result
  card is the manual path

**v1.1 follow-ups** (deferred):

- Per-trait labelled capture modes (e.g. specifically a "leaf-underside" shot)
- Image-grid examples of the diagnostic feature
- Multi-photo cascade input (today, the second photo replaces the cascade
  input rather than being appended)
- Static offline taxon-pair fallback bundled in the PWA
