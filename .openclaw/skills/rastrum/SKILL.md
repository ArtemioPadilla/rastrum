---
name: rastrum
description: Use when working with the Rastrum biodiversity app — submitting observations, testing the photo ID pipeline (PlantNet + Claude Haiku), documenting test cases, or querying the Supabase backend. Triggers on: species ID testing, camera trap analysis, observation upload, Darwin Core export, or any rastrum.artemiop.com interaction.
---

# Rastrum Skill

Interact with the Rastrum biodiversity app directly — test photo ID pipeline,
submit observations, and document field cases from Eugenio's camera trap data.

## Environment

```bash
# Required env vars (set in ~/.openclaw/.env or export before running)
RASTRUM_URL=https://rastrum.artemiop.com
SUPABASE_URL=          # from Artemio
SUPABASE_ANON_KEY=     # from Artemio
PLANTNET_API_KEY=      # from Artemio
ANTHROPIC_API_KEY=     # already available in OpenClaw
```

## Quick Reference

### Test Photo ID Pipeline (no browser needed)

```bash
# PlantNet only
curl -s -X POST \
  "https://my-api.plantnet.org/v2/identify/all?api-key=$PLANTNET_API_KEY&lang=es&nb-results=5" \
  -F "images=@/path/to/photo.jpg" \
  -F "organs=auto" | jq '.results[:3] | .[] | {name: .species.scientificNameWithoutAuthor, score: .score}'

# Full cascade: PlantNet → Claude Haiku (via Supabase Edge Function)
curl -s -X POST "$SUPABASE_URL/functions/v1/identify" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"image_url\": \"$IMAGE_URL\", \"lat\": $LAT, \"lng\": $LNG}"
```

### Upload Observation to Supabase

```bash
# 1. Get presigned R2 upload URL
UPLOAD=$(curl -s -X POST "$SUPABASE_URL/functions/v1/get-upload-url" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d "{\"key\": \"observations/test/$UUID.jpg\", \"contentType\": \"image/jpeg\"}")

PRESIGNED_URL=$(echo $UPLOAD | jq -r '.url')

# 2. Upload photo to R2
curl -s -X PUT "$PRESIGNED_URL" \
  -H "Content-Type: image/jpeg" \
  --data-binary @/path/to/photo.jpg

# 3. Insert observation record
curl -s -X POST "$SUPABASE_URL/rest/v1/observations" \
  -H "Authorization: Bearer $SUPABASE_ANON_KEY" \
  -H "apikey: $SUPABASE_ANON_KEY" \
  -H "Content-Type: application/json" \
  -d @observation.json
```

### Extract EXIF from Photo

```bash
# Install: pip install exifread pillow
python3 - << 'EOF'
import exifread, json, sys
with open(sys.argv[1], 'rb') as f:
    tags = exifread.process_file(f, details=False)

lat = tags.get('GPS GPSLatitude')
lng = tags.get('GPS GPSLongitude')
date = tags.get('EXIF DateTimeOriginal')
print(json.dumps({'lat': str(lat), 'lng': str(lng), 'date': str(date)}))
EOF
```

### Read Camera Trap EXIF + Extract Timestamp

```bash
python3 << 'EOF'
from PIL import Image
from PIL.ExifTags import TAGS
import os, json, glob

results = []
for path in glob.glob('/path/to/camtrap/*.JPG'):
    img = Image.open(path)
    exif = {TAGS.get(k, k): v for k, v in (img._getexif() or {}).items()}
    results.append({
        'file': os.path.basename(path),
        'datetime': str(exif.get('DateTime', '')),
        'make': exif.get('Make', ''),
        'model': exif.get('Model', ''),
    })

print(json.dumps(results, indent=2))
EOF
```

## Test Case Documentation Format

Save to `docs/test-cases/{slug}.json`:

```json
{
  "id": "tc-001",
  "date": "2026-04-24",
  "location": "San Pablo Etla, Oaxaca",
  "photo_path": "docs/test-cases/photos/tc-001.jpg",
  "habitat": "bosque_encino",
  "pipeline": {
    "plantnet": {
      "top_result": "Krameria cytisoides",
      "confidence": 0.31,
      "raw_response": {}
    },
    "claude_haiku": {
      "result": "Krameria sp.",
      "confidence": 0.45
    }
  },
  "ground_truth": {
    "scientific_name": "Brongniartia argentea",
    "identified_by": "Eugenio Padilla",
    "notes": "Fabaceae endémica México. Hojas pinnadas plateadas sobre hojarasca de encino."
  },
  "failure_mode": "foto_cenital_hojarasca",
  "lesson": "Ángulo cenital + hojarasca = baja confianza. Pedir foto lateral de rama."
}
```

## Rastrum Repo

```bash
# Always pull before working
cd /tmp/rastrum && git pull

# Useful paths
docs/specs/modules/   # Implementation specs per module
docs/test-cases/      # Field test cases (create if missing)
docs/progress.json    # Roadmap status
supabase/functions/   # Edge Functions (identify, get-upload-url, etc.)
src/lib/identifiers/  # ID pipeline code
```

## Common Tasks

| Task | Command |
|------|---------|
| Check roadmap | `cat /tmp/rastrum/docs/progress.json \| python3 -c "..."` |
| Pull latest | `cd /tmp/rastrum && git pull` |
| Test PlantNet | `curl` with image file (see above) |
| Add test case | Save JSON to `docs/test-cases/` + commit |
| Read ID pipeline | `cat /tmp/rastrum/src/lib/identifiers/cascade.ts` |

## Key Species for Oaxaca Test Cases

High-value species to test (low representation in global datasets):
- *Brongniartia argentea* — Fabaceae, endémica México ← ya documentada
- *Quercus rugosa* — encino rugoso, común Sierra Juárez
- *Puma concolor* — NOM-059 Pr, cámara trampa
- *Tayassu pecari* — jabalí labios blancos, NOM-059 A
- *Sorghum halepense* — invasora, Valle de Oaxaca ← ya documentada

## Notes

- WhatsApp media lands at `/home/ubuntu/.openclaw/media/inbound/`
- Videos need frame extraction before ID (use ffmpeg or video-frames skill)
- Eugenio is the expert validator — his corrections are ground truth
- Camera trap batches from Eugenio: up to 7GB per deployment
