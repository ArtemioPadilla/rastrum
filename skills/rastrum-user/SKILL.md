---
name: rastrum-user
description: Use when a Rastrum user wants to submit observations, identify species from photos, query their records, or export data via their personal API token. Triggers on: submitting a field observation, identifying a plant or animal, listing past observations, or exporting Darwin Core data from Rastrum.
---

# Rastrum User Skill

Submit biodiversity observations, identify species, and query your Rastrum
records using your personal API token.

## Setup (one time)

1. Go to **rastrum.org/es/perfil/tokens**
2. Click **Nuevo token** → copy the token shown (only visible once)
3. Save it: `export RASTRUM_TOKEN=rst_xxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxxx`

## Quick Reference

### Identify a Species from Photo

```bash
curl -s -X POST "https://rastrum.org/functions/v1/api/identify" \
  -H "Authorization: Bearer $RASTRUM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "image_url": "https://your-photo-url.jpg",
    "lat": 17.11,
    "lng": -96.74
  }'
```

### Submit an Observation

```bash
curl -s -X POST "https://rastrum.org/functions/v1/api/observe" \
  -H "Authorization: Bearer $RASTRUM_TOKEN" \
  -H "Content-Type: application/json" \
  -d '{
    "scientific_name": "Brongniartia argentea",
    "lat": 17.11,
    "lng": -96.74,
    "observed_at": "2026-04-24T15:30:00Z",
    "notes": "Bosque de encino, hojarasca",
    "photo_url": "https://media.rastrum.app/..."
  }'
```

### List Your Observations

```bash
curl -s "https://rastrum.org/functions/v1/api/observations?limit=20" \
  -H "Authorization: Bearer $RASTRUM_TOKEN" | jq '.[]'
```

### Export Darwin Core CSV

```bash
curl -s "https://rastrum.org/functions/v1/api/export?format=darwin_core" \
  -H "Authorization: Bearer $RASTRUM_TOKEN" -o my-observations.csv
```

## Token Scopes

| Scope | Permission |
|-------|-----------|
| `observe` | Submit and read your observations |
| `identify` | Use the photo ID pipeline |
| `export` | Export Darwin Core / CONANP CSV |

## Notes

- Token format: `rst_` followed by 32 hex characters
- Tokens are scoped — create separate tokens per tool
- Revoke tokens anytime at rastrum.org/perfil/tokens
- Photo ID uses PlantNet + Claude Haiku cascade
- All observations are geolocated and exportable as Darwin Core
