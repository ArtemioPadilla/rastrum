---
name: rastrum
description: Use when working with the Rastrum biodiversity platform — testing the photo ID pipeline (PlantNet + Claude Haiku cascade), submitting observations via API, processing camera trap batches, documenting field test cases, or interacting with the Supabase backend. Triggers on: species identification testing, camera trap analysis, observation upload, Darwin Core export, or any rastrum.org interaction.
---

# Rastrum Skill

Interact with the Rastrum biodiversity platform — test the photo ID pipeline,
submit observations, process camera trap data, and document field test cases.

## Environment Variables

```bash
# Required — add to .env.local (see .env.example)
PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...
PLANTNET_API_KEY=xxxx
ANTHROPIC_API_KEY=sk-ant-...
CF_ACCOUNT_ID=xxxx
R2_ACCESS_KEY_ID=xxxx
R2_SECRET_ACCESS_KEY=xxxx
R2_BUCKET_NAME=rastrum-media
```

## Quick Reference

### Test PlantNet Identification

```bash
curl -s -X POST \
  "https://my-api.plantnet.org/v2/identify/all?api-key=$PLANTNET_API_KEY&lang=es&nb-results=5" \
  -F "images=@photo.jpg" \
  -F "organs=auto" \
  | jq '.results[:3][] | {name: .species.scientificNameWithoutAuthor, score: .score}'
```

### Test Full ID Cascade (PlantNet → Claude Haiku)

```bash
# Via Supabase Edge Function
curl -s -X POST "$PUBLIC_SUPABASE_URL/functions/v1/identify" \
  -H "Authorization: Bearer $PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"image_url": "https://...", "lat": 17.11, "lng": -96.74}'
```

### Upload Observation via API

```bash
# 1. Get presigned R2 URL
UPLOAD=$(curl -s -X POST "$PUBLIC_SUPABASE_URL/functions/v1/get-upload-url" \
  -H "Authorization: Bearer $PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d '{"key": "observations/test/photo.jpg", "contentType": "image/jpeg"}')

# 2. Upload to R2
curl -s -X PUT "$(echo $UPLOAD | jq -r '.url')" \
  -H "Content-Type: image/jpeg" \
  --data-binary @photo.jpg

# 3. Insert observation record
curl -s -X POST "$PUBLIC_SUPABASE_URL/rest/v1/observations" \
  -H "Authorization: Bearer $PUBLIC_SUPABASE_ANON_KEY" \
  -H "apikey: $PUBLIC_SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d @observation.json
```

### Extract EXIF from Field Photo

```bash
python3 << 'EOF'
import exifread, json, sys
with open(sys.argv[1], 'rb') as f:
    tags = exifread.process_file(f, details=False)
print(json.dumps({
    'lat': str(tags.get('GPS GPSLatitude')),
    'lng': str(tags.get('GPS GPSLongitude')),
    'date': str(tags.get('EXIF DateTimeOriginal')),
}))
EOF
```

### Process Camera Trap Batch (EXIF timestamps)

```bash
python3 << 'EOF'
from PIL import Image
from PIL.ExifTags import TAGS
import os, json, glob, sys

results = []
for path in glob.glob(f'{sys.argv[1]}/*.JPG'):
    img = Image.open(path)
    exif = {TAGS.get(k,k): v for k,v in (img._getexif() or {}).items()}
    results.append({
        'file': os.path.basename(path),
        'datetime': str(exif.get('DateTime', '')),
        'make': exif.get('Make', ''),
        'model': exif.get('Model', ''),
    })
print(json.dumps(results, indent=2))
EOF
```

## Test Case Format

Save to `docs/test-cases/{slug}.json`:

```json
{
  "id": "tc-XXX",
  "date": "YYYY-MM-DD",
  "location": "Locality, State, México",
  "coords_approx": { "lat": 0.0, "lng": 0.0 },
  "habitat": "bosque_encino | selva_baja | matorral | ripario | urban | camtrap",
  "photo_angle": "lateral | cenital | flor | fruto | corteza",
  "pipeline": {
    "plantnet": { "top_result": "", "confidence": 0.0 },
    "claude_vision": { "result": "", "confidence": 0.0, "reasoning": "" }
  },
  "ground_truth": {
    "scientific_name": "",
    "family": "",
    "identified_by": "expert name",
    "nom059_status": null,
    "notes": ""
  },
  "failure_mode": "",
  "lesson": "",
  "priority": "high | medium | low"
}
```

## Key Paths

| Path | Purpose |
|------|---------|
| `docs/specs/modules/` | Implementation specs per module |
| `docs/test-cases/` | Field validation cases |
| `docs/progress.json` | Roadmap status |
| `supabase/functions/identify/` | ID cascade Edge Function |
| `src/lib/identifiers/` | Client-side ID pipeline |
| `.env.example` | Required environment variables |

## Common Failure Modes

| Code | Description |
|------|-------------|
| `cenital_hojarasca` | Overhead angle, cluttered background |
| `endemica_subrepresentada` | Endemic species with few training images |
| `confusion_gramineas` | Grass species confusion |
| `nocturna_camtrap` | Night camera trap, low light |
| `borrosa` | Blurry or out-of-focus image |
| `rastro_sin_animal` | Track/scat without animal visible |
| `juvenil` | Juvenile or immature form |

## Development Commands

```bash
make dev          # Start local dev server
make test         # Run unit tests (Vitest)
make e2e          # Run Playwright E2E suite
make schema       # Apply Supabase schema
make deploy-fn    # Deploy Edge Functions
```
