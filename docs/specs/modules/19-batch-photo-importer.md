# Module 19 — Batch Photo Importer

**Version target:** v1.0
**Status:** shipped — Google Photos / Drive / file-upload importer with EXIF GPS + datetime extraction live.
**GitHub Issue:** #19
**Requested by:** Eugenio Padilla (field biologist, 2026-04-25)
**Last verified:** 2026-04-26 — `src/lib/batch-import.ts` running in production.

---

## Overview

Field biologists have years of photos on their phones/cameras with GPS
coordinates embedded in EXIF. This module lets them import those photos
in bulk — Rastrum reads the coordinates, date, and other metadata
automatically, then presents a review workflow to add species names.

---

## The Problem

- Eugenio has hundreds of field photos with precise GPS in EXIF
- WhatsApp strips EXIF on send → coordinates lost
- Entering observations one by one is impractical for existing data
- No bridge from existing field data to Rastrum currently exists

---

## Import Sources

| Source | EXIF preserved | Method |
|--------|---------------|--------|
| Direct file upload (JPG/HEIC) | ✅ | `<input multiple>` → FileReader |
| Google Photos shared album link | ✅ | API or scrape metadata |
| iNaturalist CSV export | N/A | CSV parser → pre-filled obs |
| Darwin Core CSV | N/A | Standard import |
| SD card / USB | ✅ | Same as file upload |

---

## UX Flow

```
1. User goes to /es/perfil/importar/
2. Selects import source:
   [📁 Archivos desde mi dispositivo]
   [🌐 Álbum de Google Fotos]
   [📊 CSV de iNaturalist]

3. For file upload:
   - Drag & drop or select multiple JPGs
   - Progress bar: "Leyendo metadatos... 24/47 fotos"
   - EXIF extracted client-side (no upload yet)

4. Batch review screen:
   ┌─────────────────────────────────────────┐
   │ 47 fotos listas para importar           │
   │ 43 con GPS · 4 sin ubicación           │
   ├───────────────┬─────────────────────────┤
   │ [foto thumb]  │ 📍 17.1440°N 96.7447°W │
   │               │ 📅 24 abr 2026 15:30   │
   │               │ ❓ Especie: [________] │
   │               │ 🌿 Hábitat: [dropdown] │
   │ [← Anterior]  │ [Siguiente →]          │
   └───────────────┴─────────────────────────┘

5. Quick-fill options:
   - "Aplicar especie a todas las fotos del mismo día"
   - "Marcar todas como 'necesita revisión'"
   - AI batch identify (PlantNet on all photos)

6. Import: creates observations in Dexie → syncs to Supabase
```

---

## EXIF Extraction (client-side)

```typescript
import ExifReader from 'exifreader'; // or piexifjs

async function extractExif(file: File) {
  const buffer = await file.arrayBuffer();
  const tags = ExifReader.load(buffer);
  return {
    lat: tags['GPSLatitude']?.description,
    lng: tags['GPSLongitude']?.description,
    altitude: tags['GPSAltitude']?.description,
    datetime: tags['DateTimeOriginal']?.description,
    make: tags['Make']?.description,
    model: tags['Model']?.description,
  };
}
```

---

## Camera Trap Special Case

Camera traps produce hundreds of photos per deployment. Additional fields:
- Deployment ID (manual entry or auto from folder name)
- Camera model (from EXIF)
- Detection confidence (MegaDetector integration — v2.0)
- Species per burst (multiple photos of same event)

---

## Acceptance Criteria

- [ ] User can select 50+ photos at once
- [ ] EXIF GPS read client-side (no server roundtrip for metadata)
- [ ] Photos without GPS flagged — user can assign location manually
- [ ] Batch review: one photo at a time with species input
- [ ] "Apply to all" for single-species surveys
- [ ] Progress indicator for upload + sync
- [ ] All observations appear in /perfil/observaciones after import
- [ ] Works for JPEG and HEIC formats

---

## Related

- Module 14 (User API Tokens) — power users can script batch import via API
- Module 09 (Camera Trap Ingest) — advanced pipeline with MegaDetector (v2.0)
- Issue #19 on GitHub
