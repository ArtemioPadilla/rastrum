# Module 02 — Observation Form & GPS

**Version target:** v0.1
**Status:** Not started

---

## Overview

Core data entry flow. User opens app, taps "New Observation", camera opens, photo taken, GPS auto-filled, form pre-populated from EXIF, user confirms and submits. Works fully offline — saved to Dexie outbox first.

---

## Observation Data Model

```typescript
// Discriminated union: guest observations live only in Dexie; authenticated
// observations sync to Supabase. The sync engine refuses to upload anything
// whose observer_ref.kind === 'guest' (see module 04).
type ObserverRef =
  | { kind: 'user';  id: string /* uuid */ }
  | { kind: 'guest'; localId: string /* local-only, never synced as-is */ };

interface Observation {
  // Identity
  id: string;                        // UUID v4, generated client-side
  observer_ref: ObserverRef;         // see discriminated union above
  created_at: string;                // ISO 8601 UTC

  // Media
  photos: MediaFile[];               // at least 1 required for v0.1
  primary_photo_index: number;       // which photo to use for ID

  // Location
  location: {
    lat: number;
    lng: number;
    accuracy_m: number;              // GPS accuracy in meters
    altitude_m: number | null;
    captured_from: 'gps' | 'exif' | 'manual';
  };

  // Taxonomy
  identification: {
    scientific_name: string;
    common_name_es: string | null;
    common_name_en: string | null;
    taxon_id: string | null;         // FK taxa.id if matched
    confidence: number;              // 0.0–1.0
    source: IDSource;
    status: 'pending' | 'accepted' | 'needs_review';
  };

  // Field context
  habitat: HabitatType | null;
  weather: WeatherTag | null;
  notes: string | null;              // free text, max 2000 chars

  // Environmental enrichment (auto-filled post-submission)
  moon_phase: string | null;
  moon_illumination: number | null;
  precipitation_24h_mm: number | null;
  ndvi_value: number | null;
  phenological_season: string | null;

  // Metadata
  sync_status: 'pending' | 'synced' | 'error';
  synced_at: string | null;
  app_version: string;
  device_os: string | null;
}

type HabitatType =
  | 'forest_pine_oak' | 'cloud_forest' | 'tropical_dry_forest'
  | 'riparian' | 'wetland' | 'grassland' | 'agricultural'
  | 'urban' | 'coastal' | 'reef' | 'scrubland' | 'cave';

type WeatherTag = 'sunny' | 'cloudy' | 'overcast' | 'light_rain' | 'heavy_rain' | 'fog' | 'storm';
type IDSource = 'plantnet' | 'claude_haiku' | 'claude_sonnet' | 'onnx_offline' | 'human';
```

---

## GPS Flow

```typescript
async function getLocation(): Promise<GPSResult> {
  return new Promise((resolve, reject) => {
    if (!navigator.geolocation) {
      reject(new Error('Geolocation not supported'));
      return;
    }

    // Throttled: 20-second coarse polling (not continuous) to save battery
    navigator.geolocation.getCurrentPosition(
      (pos) => resolve({
        lat: pos.coords.latitude,
        lng: pos.coords.longitude,
        accuracy_m: pos.coords.accuracy,
        altitude_m: pos.coords.altitude,
        captured_from: 'gps',
      }),
      (err) => reject(err),
      {
        enableHighAccuracy: true,
        timeout: 10_000,
        maximumAge: 20_000,   // accept cached position up to 20s old
      }
    );
  });
}
```

**Fallback chain:**
1. EXIF GPS (if available from uploaded photo) → `captured_from: 'exif'`
2. Live GPS → `captured_from: 'gps'`
3. Manual map pin → `captured_from: 'manual'`

---

## EXIF Auto-Population

Using `exifr` (browser-compatible):

```typescript
import { parse } from 'exifr';

async function extractExif(file: File): Promise<ExifData> {
  const exif = await parse(file, {
    gps: true,
    tiff: true,
    exif: true,
    iptc: true,
    xmp: true,
  });

  return {
    lat: exif?.latitude,
    lng: exif?.longitude,
    altitude: exif?.GPSAltitude,
    capturedAt: exif?.DateTimeOriginal || exif?.CreateDate,
    deviceMake: exif?.Make,
    deviceModel: exif?.Model,
    keywords: exif?.Keywords,        // XMP/IPTC species hints
    description: exif?.Description,
  };
}
```

**Pre-fill form fields from EXIF:**
- `DateTimeOriginal` → observation timestamp
- `GPSLatitude/Longitude` → auto-fill location (show "Location from photo" badge)
- `Keywords` → suggest to notes field

---

## Observation Form — Field List

```
Required:
  □ Photo(s) — camera or gallery
  □ Location — GPS/EXIF/manual (must be confirmed)
  □ Date/time — auto from EXIF or now()

Optional (collapse by default on mobile):
  □ Habitat type — dropdown (HabitatType)
  □ Weather — pill selector
  □ Notes — textarea (2000 char limit)
  □ Number of individuals — numeric input
  □ Evidence type — for ecological evidence: track/scat/burrow/nest/feather/bone
```

---

## Form Validation

```typescript
function validateObservation(obs: Partial<Observation>): ValidationError[] {
  const errors: ValidationError[] = [];
  if (!obs.photos?.length) errors.push({ field: 'photos', msg: 'At least one photo required' });
  if (!obs.location) errors.push({ field: 'location', msg: 'Location required' });
  if (obs.location?.accuracy_m && obs.location.accuracy_m > 500) {
    errors.push({ field: 'location', msg: 'GPS accuracy is low (>500m). Consider adding manually.', severity: 'warning' });
  }
  return errors;
}
```

---

## Offline Save Flow

```typescript
async function saveObservation(obs: Observation): Promise<void> {
  // 1. Save photos to IndexedDB blobs
  for (const photo of obs.photos) {
    await db.mediaBlobs.put({ id: photo.id, blob: photo.blob });
  }

  // 2. Save observation to outbox
  await db.observations.put({ ...obs, sync_status: 'pending' });

  // 3. Trigger ID in background (queue if offline)
  if (navigator.onLine) {
    await triggerIdentification(obs.id);
  } else {
    await db.idQueue.put({ observation_id: obs.id, queued_at: new Date().toISOString() });
  }

  // 4. Attempt sync immediately if online
  if (navigator.onLine) {
    syncOutbox().catch(console.error);
  }
}
```

---

## Sensitive Species Privacy

After identification, check if species requires location obscuration:

```typescript
async function applyLocationPrivacy(obs: Observation, taxon: Taxon): Promise<Observation> {
  const obscureLevel = getObscurationLevel(taxon); // from taxa.nom059_status + CITES

  if (obscureLevel === 'none') return obs;

  const grid_size = obscureLevel === 'full' ? 5 / 111 : 0.2; // degrees
  return {
    ...obs,
    location_obscured: {
      lat: Math.round(obs.location.lat / grid_size) * grid_size,
      lng: Math.round(obs.location.lng / grid_size) * grid_size,
    }
  };
}
```

**Warn user:** "This species (NOM-059 P) has its location obscured to protect it from poaching. Original coordinates stored privately."
