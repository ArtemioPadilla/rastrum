# Module 03 — Offline-First / PWA / Sync

**Version target:** v0.1
**Status:** shipped — Dexie outbox + `syncOutbox()` + identify trigger live; service worker shell-cached; offline pmtiles archive served from page-managed Cache API via SW range-slicing.
**Last verified:** 2026-05-06 — `src/lib/db.ts` (RastrumDB), `src/lib/sync.ts`, `public/sw.js` running in production. Workbox-style background sync queue intentionally deferred (visibilitychange + online events suffice).

---

## Overview

All observations are written to IndexedDB first, synced to Supabase when connectivity returns. PWA installable on Android (TWA/Bubblewrap) and iOS (A2HS). Capacitor wrapper for iOS App Store in v1.2.

---

## PWA Manifest

`public/manifest.webmanifest`:
```json
{
  "name": "Rastrum",
  "short_name": "Rastrum",
  "description": "Biodiversity identification — offline first",
  "start_url": "/en/",
  "display": "standalone",
  "background_color": "#09090b",
  "theme_color": "#10b981",
  "icons": [
    { "src": "/icons/icon-192.png", "sizes": "192x192", "type": "image/png", "purpose": "any maskable" },
    { "src": "/icons/icon-512.png", "sizes": "512x512", "type": "image/png", "purpose": "any maskable" }
  ],
  "screenshots": [
    { "src": "/screenshots/mobile-home.png", "sizes": "390x844", "type": "image/png", "form_factor": "narrow" }
  ],
  "categories": ["education", "science", "nature"],
  "lang": "es"
}
```

---

## Service Worker

The shipped implementation is hand-rolled in [`public/sw.js`](../../../public/sw.js) — a flat classic SW (no Workbox bundle, no build step). Operator runbook at [`docs/runbooks/sw-cache.md`](../../runbooks/sw-cache.md). The Workbox sketch below is historical: it documents the strategy shape we landed on, not the current code. Three implementation details that don't appear in the sketch:

- **Hand-rolled cache buckets per strategy** — `caches.open(VERSION)` for the shell (network-first HTML, cache-first hashed assets, SWR for unhashed paths), versioned via the `VERSION` constant. Bumping `VERSION` invalidates the shell on the next visit.
- **Page-managed offline-map cache** — `src/lib/offline-map.ts` writes the full ~50 MB Mexico pmtiles archive into `caches.open('rastrum/pmtiles')` as a single 200 Response when the user clicks "Download offline map" in Profile → Edit. The SW intercepts `media.rastrum.org/maps/*.pmtiles` requests and slices the cached body into 206 Partial Content responses to satisfy MapLibre's byte-range fetches; falls through to network on cache miss. The slicing algorithm is pinned by [`tests/unit/sw-pmtiles-range.test.ts`](../../../tests/unit/sw-pmtiles-range.test.ts).
- **`PERSISTENT_CACHES` allowlist** — `rastrum/pmtiles` and `rastrum-share-target-v1` are page-managed caches that the SW deliberately preserves across `VERSION` upgrades. Without this, every SW upgrade silently wiped a user's downloaded offline map (fixed in PR #636).

Historical Workbox sketch (kept for design context):

```typescript
// sw.ts
import { precacheAndRoute, cleanupOutdatedCaches } from 'workbox-precaching';
import { registerRoute, NavigationRoute } from 'workbox-routing';
import { CacheFirst, NetworkFirst, StaleWhileRevalidate } from 'workbox-strategies';
import { ExpirationPlugin } from 'workbox-expiration';

cleanupOutdatedCaches();

// Precache app shell
precacheAndRoute(self.__WB_MANIFEST);

// Cache-first for ONNX model bundles (large, rarely change)
registerRoute(
  ({ url }) => url.pathname.includes('/models/'),
  new CacheFirst({
    cacheName: 'models-v1',
    plugins: [new ExpirationPlugin({ maxEntries: 10 })],
  })
);

// Cache-first for map tiles (pmtiles chunks)
registerRoute(
  ({ url }) => url.pathname.includes('/tiles/'),
  new CacheFirst({
    cacheName: 'tiles-v1',
    plugins: [new ExpirationPlugin({ maxAgeSeconds: 30 * 24 * 60 * 60 })],
  })
);

// Network-first for API calls (with offline fallback)
registerRoute(
  ({ url }) => url.hostname.includes('supabase.co'),
  new NetworkFirst({
    cacheName: 'api-v1',
    networkTimeoutSeconds: 5,
  })
);

// Offline fallback page
registerRoute(
  new NavigationRoute(async () => {
    return caches.match('/offline.html') || Response.error();
  })
);
```

---

## Dexie Database Schema

```typescript
import Dexie, { type Table } from 'dexie';

export interface ObservationRecord {
  id: string;
  observer_id: string;
  data: Observation;          // full observation JSON
  sync_status: 'pending' | 'synced' | 'error';
  sync_error?: string;
  created_at: string;
  updated_at: string;
}

export interface MediaBlob {
  id: string;                 // matches MediaFile.id
  observation_id: string;
  blob: Blob;
  uploaded: boolean;
  upload_url?: string;        // Cloudflare R2 URL once uploaded
}

export interface IDQueueItem {
  observation_id: string;
  queued_at: string;
  attempts: number;
  last_error?: string;
}

export class RastrumDB extends Dexie {
  observations!: Table<ObservationRecord>;
  mediaBlobs!: Table<MediaBlob>;
  idQueue!: Table<IDQueueItem>;

  constructor() {
    super('rastrum-v1');
    this.version(1).stores({
      observations: 'id, observer_id, sync_status, created_at',
      mediaBlobs:   'id, observation_id, uploaded',
      idQueue:      'observation_id, queued_at',
    });
  }
}

export const db = new RastrumDB();
```

---

## Sync Engine

```typescript
// lib/sync.ts

export async function syncOutbox(): Promise<SyncResult> {
  const pending = await db.observations
    .where('sync_status').equals('pending')
    .toArray();

  if (!pending.length) return { synced: 0, failed: 0 };

  const results = await Promise.allSettled(
    pending.map(record => syncObservation(record))
  );

  return {
    synced: results.filter(r => r.status === 'fulfilled').length,
    failed: results.filter(r => r.status === 'rejected').length,
  };
}

async function syncObservation(record: ObservationRecord): Promise<void> {
  // 1. Upload media blobs to Cloudflare R2
  const blobs = await db.mediaBlobs
    .where('observation_id').equals(record.id)
    .filter(b => !b.uploaded)
    .toArray();

  for (const blob of blobs) {
    const url = await uploadToR2(blob.blob, `observations/${record.id}/${blob.id}.jpg`);
    await db.mediaBlobs.update(blob.id, { uploaded: true, upload_url: url });
  }

  // 2. Build final observation with media URLs
  const mediaUrls = await db.mediaBlobs
    .where('observation_id').equals(record.id)
    .toArray();

  const observationPayload = {
    ...record.data,
    photos: record.data.photos.map(p => ({
      ...p,
      url: mediaUrls.find(m => m.id === p.id)?.upload_url,
    })),
  };

  // 3. POST to Supabase
  const { error } = await supabase
    .from('observations')
    .upsert(observationPayload, { onConflict: 'id' });

  if (error) throw error;

  // 4. Mark synced
  await db.observations.update(record.id, {
    sync_status: 'synced',
    updated_at: new Date().toISOString(),
  });
}
```

---

## Sync Triggers

```typescript
// Trigger sync on every app open (universal fallback — no Background Sync)
document.addEventListener('visibilitychange', () => {
  if (document.visibilityState === 'visible' && navigator.onLine) {
    syncOutbox().catch(console.error);
    flushIDQueue().catch(console.error);
  }
});

// Trigger on reconnect
window.addEventListener('online', () => {
  syncOutbox().catch(console.error);
  flushIDQueue().catch(console.error);
});
```

---

## Storage Persistence

```typescript
// Request persistent storage on first install
async function requestPersistentStorage(): Promise<void> {
  if (navigator.storage?.persist) {
    const granted = await navigator.storage.persist();
    if (!granted) {
      // Show gentle prompt: "Add to home screen to keep your observations safe offline"
      showA2HSPrompt();
    }
  }
}
```

---

## iOS-Specific Constraints

| Constraint | Mitigation |
|-----------|-----------|
| 7-day ITP eviction | Request `storage.persist()` on install; prompt A2HS |
| ~50MB initial cache limit | Keep SW precache under 30MB; lazy-load models |
| No Background Sync | `visibilitychange` + `online` event listeners |
| Web Push requires A2HS | Aggressive prompt on first observation save |
| WebGPU only Safari 26+ | WASM fallback in ONNX Runtime Web |

---

## Cache Size Budget

| Asset | Size | Strategy |
|-------|------|---------|
| App shell (HTML/JS/CSS) | ~800 KB | Precache |
| ONNX base model | ~2.8 MB | CacheFirst |
| Top 10K Mexico species labels | ~300 KB | Precache |
| Map overview (zoom 0–10) | ~250 MB | User-initiated download |
| Oaxaca regional ONNX pack | ~18 MB | User-initiated download |
| **Initial install** | **~4 MB** | ✅ under 50MB limit |
