# Rastrum Test Cases

Field observations used to validate the photo ID pipeline.
Identified by Eugenio Padilla (biologist, San Pablo Etla, Oaxaca).

## Summary

| ID | Species | AI Result | Correct? | Failure Mode |
|----|---------|-----------|----------|-------------|
| [tc-001](tc-001-brongniartia-argentea.json) | *Brongniartia argentea* | *Krameria* sp. | ❌ | Foto cenital + especie endémica subrepresentada |
| [tc-002](tc-002-sorghum-halepense.json) | *Sorghum halepense* | *Cenchrus setaceus* | ❌ | Confusión gramíneas invasoras africanas |

## How to Add a Test Case

1. Save photo to `docs/test-cases/photos/tc-XXX.jpg`
2. Copy template below → save as `tc-XXX-scientific-name.json`
3. Commit + push

## Template

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
    "identified_by": "Eugenio Padilla",
    "nom059_status": null,
    "notes": ""
  },
  "failure_mode": "",
  "lesson": "",
  "priority": "high | medium | low"
}
```

## Failure Mode Taxonomy

| Code | Description |
|------|-------------|
| `foto_cenital_hojarasca` | Overhead angle, cluttered background |
| `especie_endemica_subrepresentada` | Endemic species with few global dataset photos |
| `confusion_gramineas` | Grass species confusion |
| `nocturna_camtrap` | Night camera trap, low light |
| `foto_borrosa` | Blurry image |
| `solo_huella_rastro` | Track/scat without animal visible |
| `juvenil_o_cria` | Juvenile/immature form |
