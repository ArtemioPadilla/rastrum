/**
 * Sync engine — flushes the Dexie outbox to Supabase.
 *
 * Order matters: media blobs upload to Supabase Storage first, observation
 * upsert second. If the upload succeeds but the upsert fails, a replay will
 * see uploaded=true and skip re-uploading.
 *
 * Storage: we use Supabase Storage bucket `media` for v0.1 — not R2 yet.
 * R2 migration happens at v0.3 when we also ship offline pmtiles.
 */
import { getDB, type ObservationRecord } from './db';
import { getSupabase } from './supabase';
import type { Observation } from './types';

const MEDIA_BUCKET = 'media';

export interface SyncResult {
  synced: number;
  failed: number;
  skipped_guest: number;
}

/** Upload one blob to Supabase Storage. Returns the public URL. */
async function uploadBlob(
  blob: Blob,
  path: string,
  mimeType: string
): Promise<string> {
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from(MEDIA_BUCKET)
    .upload(path, blob, { contentType: mimeType, upsert: true });
  if (error) throw error;
  const { data } = supabase.storage.from(MEDIA_BUCKET).getPublicUrl(path);
  return data.publicUrl;
}

async function syncOne(record: ObservationRecord): Promise<void> {
  const db = getDB();
  const supabase = getSupabase();

  // Guest observations don't sync — they have no server-side owner.
  if (record.observer_kind === 'guest') return;

  // 1. Upload every media blob that hasn't been uploaded yet
  const blobs = await db.mediaBlobs.where('observation_id').equals(record.id).toArray();
  for (const b of blobs) {
    if (b.uploaded) continue;
    const url = await uploadBlob(
      b.blob,
      `observations/${record.id}/${b.id}`,
      b.mime_type
    );
    await db.mediaBlobs.update(b.id, { uploaded: true, upload_url: url });
  }

  // 2. Upsert the observation row
  const obs: Observation = record.data;
  if (obs.observerRef.kind !== 'user') return;

  const serverRow = {
    id:              obs.id,
    observer_id:     obs.observerRef.id,
    observed_at:     obs.createdAt,
    location:        `SRID=4326;POINT(${obs.location.lng} ${obs.location.lat})`,
    accuracy_m:      obs.location.accuracyM,
    altitude_m:      obs.location.altitudeM,
    location_source: obs.location.capturedFrom,
    habitat:         obs.habitat,
    weather:         obs.weather,
    evidence_type:   obs.evidenceType ?? 'direct_sighting',
    notes:           obs.notes,
    sync_status:     'synced' as const,
    app_version:     obs.appVersion,
    device_os:       obs.deviceOs,
  };
  const { error: upsertErr } = await supabase
    .from('observations')
    .upsert(serverRow, { onConflict: 'id' });
  if (upsertErr) throw upsertErr;

  // 3. Insert media_files rows for every uploaded blob
  const uploaded = await db.mediaBlobs.where('observation_id').equals(record.id).toArray();
  if (uploaded.length) {
    const mediaRows = uploaded
      .filter(b => b.upload_url)
      .map((b, idx) => ({
        id: b.id,
        observation_id: record.id,
        media_type: 'photo' as const,
        url: b.upload_url!,
        mime_type: b.mime_type,
        file_size_bytes: b.size_bytes,
        sort_order: idx,
        is_primary: idx === obs.primaryPhotoIndex,
      }));
    const { error: mediaErr } = await supabase
      .from('media_files')
      .upsert(mediaRows, { onConflict: 'id' });
    if (mediaErr) throw mediaErr;
  }

  // 4. Mark synced in Dexie + enqueue ID request if not already
  await db.observations.update(record.id, {
    sync_status: 'synced',
    updated_at: new Date().toISOString(),
  });
  const existingQueue = await db.idQueue.get(record.id);
  if (!existingQueue) {
    await db.idQueue.put({
      observation_id: record.id,
      queued_at: new Date().toISOString(),
      attempts: 0,
    });
  }

  // 5. Trigger the identify Edge Function async (fire-and-forget; the queue
  //    catches retries). The function does its own DB writes.
  triggerIdentify(record.id).catch(err => console.warn('[rastrum] identify failed', err));
}

/** Invoke the identify Edge Function for an observation that's freshly synced. */
async function triggerIdentify(observationId: string): Promise<void> {
  const supabase = getSupabase();
  const db = getDB();

  // Find the primary photo URL we just uploaded
  const blobs = await db.mediaBlobs.where('observation_id').equals(observationId).toArray();
  const primary = blobs.find(b => b.upload_url) ?? blobs[0];
  if (!primary?.upload_url) return;  // shouldn't happen, but be defensive

  // Pull the GPS for context (improves Claude's ID)
  const obsRecord = await db.observations.get(observationId);
  const loc = obsRecord?.data.location;

  const { error } = await supabase.functions.invoke('identify', {
    body: {
      observation_id: observationId,
      image_url: primary.upload_url,
      location: loc ? { lat: loc.lat, lng: loc.lng } : undefined,
    },
  });
  if (error) {
    // Don't fail sync — keep the row in idQueue for nightly retry
    await db.idQueue.update(observationId, {
      attempts: ((await db.idQueue.get(observationId))?.attempts ?? 0) + 1,
      last_error: error.message,
    });
    return;
  }

  // Success — drop the queue entry
  await db.idQueue.delete(observationId);
}

/** Flush all pending observations. Safe to call on every `online` event. */
export async function syncOutbox(): Promise<SyncResult> {
  const db = getDB();
  const pending = await db.observations.where('sync_status').equals('pending').toArray();
  if (!pending.length) return { synced: 0, failed: 0, skipped_guest: 0 };

  let synced = 0, failed = 0, skipped_guest = 0;

  for (const rec of pending) {
    if (rec.observer_kind === 'guest') { skipped_guest++; continue; }
    try {
      await syncOne(rec);
      synced++;
    } catch (err) {
      failed++;
      await db.observations.update(rec.id, {
        sync_error: err instanceof Error ? err.message : String(err),
        sync_attempts: (rec.sync_attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      });
    }
  }
  return { synced, failed, skipped_guest };
}

/** Register listeners that auto-flush the outbox when the app is visible/online. */
export function registerSyncTriggers(): void {
  if (typeof window === 'undefined') return;
  const maybeSync = () => {
    if (navigator.onLine) {
      syncOutbox().catch(err => console.warn('[rastrum] sync failed', err));
    }
  };
  window.addEventListener('online', maybeSync);
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'visible') maybeSync();
  });
}
