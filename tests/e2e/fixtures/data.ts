/**
 * Data fixtures for journey tests — seed Dexie (IndexedDB) with realistic
 * observations so views have content to render against the static preview.
 */
import type { Page } from '@playwright/test';

const SAMPLE_SPECIES = [
  { scientific: 'Quercus rugosa', common: 'Encino', kingdom: 'Plantae' },
  { scientific: 'Tillandsia usneoides', common: 'Heno', kingdom: 'Plantae' },
  { scientific: 'Amanita muscaria', common: 'Amanita', kingdom: 'Fungi' },
  { scientific: 'Danaus plexippus', common: 'Monarca', kingdom: 'Animalia' },
  { scientific: 'Ambystoma mexicanum', common: 'Ajolote', kingdom: 'Animalia' },
];

export async function seedObservations(page: Page, count = 5): Promise<void> {
  await page.addInitScript((n: number) => {
    const species = [
      { scientific: 'Quercus rugosa', common: 'Encino' },
      { scientific: 'Tillandsia usneoides', common: 'Heno' },
      { scientific: 'Amanita muscaria', common: 'Amanita' },
      { scientific: 'Danaus plexippus', common: 'Monarca' },
      { scientific: 'Ambystoma mexicanum', common: 'Ajolote' },
    ];

    const request = indexedDB.open('rastrum-v1', 2);
    request.onupgradeneeded = () => {
      const db = request.result;
      if (!db.objectStoreNames.contains('observations')) {
        db.createObjectStore('observations', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('mediaBlobs')) {
        db.createObjectStore('mediaBlobs', { keyPath: 'id' });
      }
      if (!db.objectStoreNames.contains('idQueue')) {
        db.createObjectStore('idQueue', { keyPath: 'observation_id' });
      }
      if (!db.objectStoreNames.contains('chatTurns')) {
        db.createObjectStore('chatTurns', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => {
      const db = request.result;
      const tx = db.transaction('observations', 'readwrite');
      const store = tx.objectStore('observations');
      for (let i = 0; i < n; i++) {
        const sp = species[i % species.length];
        store.put({
          id: `e2e-obs-${String(i).padStart(4, '0')}`,
          observer_kind: 'user',
          data: {
            id: `e2e-obs-${String(i).padStart(4, '0')}`,
            observerRef: { kind: 'user', id: 'e2e-user-00000000-0000-0000-0000-000000000001' },
            createdAt: new Date(Date.now() - i * 86_400_000).toISOString(),
            photos: [{ id: `media-${i}`, mediaType: 'photo', url: '/placeholder-obs.jpg' }],
            primaryPhotoIndex: 0,
            location: {
              lat: 17.06 + (i * 0.01),
              lng: -96.72 + (i * 0.01),
              accuracyM: 10,
              altitudeM: 1500 + i * 100,
              capturedFrom: 'gps',
            },
            identification: {
              scientificName: sp.scientific,
              commonNameEs: sp.common,
              commonNameEn: sp.common,
              taxonId: `taxon-${i}`,
              confidence: 0.7 + (i * 0.05),
              source: 'plantnet',
              status: i < 3 ? 'accepted' : 'needs_review',
            },
            habitat: 'forest_pine_oak',
            weather: 'sunny',
            evidenceType: 'direct_sighting',
            license: 'CC BY 4.0',
            contentSensitive: false,
            notes: null,
            moonPhase: null,
            moonIllumination: null,
            precipitation24hMm: null,
            ndviValue: null,
            phenologicalSeason: null,
            syncStatus: i < 3 ? 'synced' : 'pending',
            syncedAt: i < 3 ? new Date().toISOString() : null,
            appVersion: '1.0.0',
            deviceOs: 'test',
          },
          sync_status: i < 3 ? 'synced' : 'pending',
          sync_error: undefined,
          sync_attempts: 0,
          created_at: new Date(Date.now() - i * 86_400_000).toISOString(),
          updated_at: new Date(Date.now() - i * 86_400_000).toISOString(),
        });
      }
    };
  }, count);
}

export { SAMPLE_SPECIES };
