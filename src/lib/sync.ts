/**
 * Sync engine — flushes the Dexie outbox to Supabase.
 *
 * Order matters: media blobs upload first, observation upsert second. If
 * the upload succeeds but the upsert fails, a replay sees uploaded=true and
 * skips re-uploading.
 *
 * Storage backend: src/lib/upload.ts auto-selects R2 (when
 * PUBLIC_R2_MEDIA_URL is set) or Supabase Storage (fallback). See module 10.
 */
import { getDB, type ObservationRecord } from './db';
import { getSupabase } from './supabase';
import { uploadMedia, resizeImage, r2Enabled } from './upload';
import type { Observation } from './types';

export interface SyncResult {
  synced: number;
  failed: number;
  skipped_guest: number;
}

async function syncOne(record: ObservationRecord): Promise<void> {
  const db = getDB();
  const supabase = getSupabase();

  // Guest observations don't sync — they have no server-side owner.
  if (record.observer_kind === 'guest') return;

  // 1. Upload every media blob that hasn't been uploaded yet. We resize
  //    images client-side first (saves storage + bandwidth, see module 10).
  const blobs = await db.mediaBlobs.where('observation_id').equals(record.id).toArray();
  for (const b of blobs) {
    if (b.uploaded) continue;
    let payload: Blob = b.blob;
    let mime = b.mime_type;
    if (b.mime_type.startsWith('image/')) {
      try {
        payload = await resizeImage(new File([b.blob], b.id, { type: b.mime_type }));
        mime = 'image/jpeg';
      } catch {
        // Resize failed (older browser?) — fall back to the original blob
      }
    }
    const ext = mime === 'image/jpeg' ? '.jpg' : '';
    const key = `observations/${record.id}/${b.id}${ext}`;
    const url = await uploadMedia(payload, key, mime);
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

  // 6. Trigger environmental enrichment (lunar / weather). Also fire-and-forget.
  triggerEnvEnrichment(record.id).catch(err => console.warn('[rastrum] enrich failed', err));
}

async function triggerEnvEnrichment(observationId: string): Promise<void> {
  const supabase = getSupabase();
  await supabase.functions.invoke('enrich-environment', {
    body: { observation_id: observationId },
  });
}

const BYO_KEY_STORAGE = 'rastrum.byoAnthropicKey';
const LOCAL_AI_OPTIN  = 'rastrum.localAiOptIn';

function readByoAnthropicKey(): string | undefined {
  if (typeof localStorage === 'undefined') return undefined;
  return localStorage.getItem(BYO_KEY_STORAGE) ?? undefined;
}

function isLocalAIOptedIn(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LOCAL_AI_OPTIN) === 'true';
}

/**
 * Run the identifier cascade against the freshly-synced observation.
 *
 * The cascade is the *plugin* layer (src/lib/identifiers/) rather than the
 * Edge Function's hardcoded waterfall. It walks every registered plugin
 * whose capabilities match (media + taxa + runtime), in cost order, and
 * stops at the first result above the accept threshold. Falls back to
 * Phi-3.5-vision on-device when the user opted in and cloud paths fail.
 */
async function triggerIdentify(observationId: string): Promise<void> {
  const supabase = getSupabase();
  const db = getDB();

  // Find the primary photo URL we just uploaded
  const blobs = await db.mediaBlobs.where('observation_id').equals(observationId).toArray();
  const primary = blobs.find(b => b.upload_url) ?? blobs[0];
  if (!primary?.upload_url) return;

  const obsRecord = await db.observations.get(observationId);
  const loc = obsRecord?.data.location;
  const habitat = obsRecord?.data.habitat ?? undefined;

  const { bootstrapIdentifiers, runCascade } = await import('./identifiers');
  bootstrapIdentifiers();

  // Exclude on-device plugins unless the user opted in. They still appear
  // in the registry (UI lists them) but the cascade engine skips them.
  const excluded = isLocalAIOptedIn() ? [] : ['webllm_phi35_vision', 'onnx_efficientnet_lite0', 'birdnet_lite'];

  const cascadeResult = await runCascade(
    {
      media: { kind: 'url', url: primary.upload_url },
      mediaKind: 'photo',
      location: loc ? { lat: loc.lat, lng: loc.lng } : undefined,
      habitat,
      byo_keys: { anthropic: readByoAnthropicKey() },
    },
    {
      media: 'photo',
      taxa: undefined,    // we don't yet know what kingdom — the cascade probes generalists too
      excluded,
    },
  );

  if (!cascadeResult.best) {
    await db.idQueue.update(observationId, {
      attempts: ((await db.idQueue.get(observationId))?.attempts ?? 0) + 1,
      last_error: 'cascade exhausted: ' + cascadeResult.attempts.map(a => a.id + (a.ok ? '✓' : '✗')).join(','),
    });
    return;
  }

  // Write the chosen identification to public.identifications. The
  // sync_primary_id_trigger then materialises denormalised columns on
  // the observation row (primary_taxon_id, obscure_level, location_obscured).
  const r = cascadeResult.best;
  const { error: insertErr } = await supabase.from('identifications').insert({
    observation_id: observationId,
    scientific_name: r.scientific_name,
    confidence: r.confidence,
    source: r.source,
    raw_response: r.raw as object,
    is_primary: true,
  });

  if (insertErr) {
    await db.idQueue.update(observationId, {
      attempts: ((await db.idQueue.get(observationId))?.attempts ?? 0) + 1,
      last_error: 'identification insert failed: ' + insertErr.message,
    });
    return;
  }

  await db.idQueue.delete(observationId);
}

// Legacy runLocalFallback was replaced by the cascade engine above; the
// Phi-3.5-vision fallback is now a registered plugin (phi-vision.ts).

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
