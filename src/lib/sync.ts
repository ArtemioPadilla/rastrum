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
import {
  SYNC_EVENTS, emit, setLastSyncAt, announcePendingCount,
  type SyncDoneDetail, type SyncProgressDetail, type SyncRowDetail,
} from './sync-events';

export interface SyncResult {
  synced: number;
  failed: number;
  skipped_guest: number;
  /**
   * The most recent failure's error message + the offending stage. Lets
   * the form surface the real reason ("R2 upload 401", "PostgREST 403",
   * "Edge Function not configured: CF_ACCOUNT_ID", etc.) instead of
   * staying silent on the silent-fail path. Null when no failure.
   */
  last_error: string | null;
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
    const url = await uploadMedia(payload, key, mime, {
      onProgress: (loaded, total) => {
        emit<SyncProgressDetail>(SYNC_EVENTS.progress, {
          observation_id: record.id,
          blob_id: b.id,
          loaded,
          total,
        });
      },
    });
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
        media_type: (
          b.mime_type.startsWith('image/') ? 'photo' :
          b.mime_type.startsWith('audio/') ? 'audio' :
          b.mime_type.startsWith('video/') ? 'video' : 'photo'
        ) as 'photo' | 'audio' | 'video',
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

const LOCAL_AI_OPTIN = 'rastrum.localAiOptIn';
const LOCAL_AI_DOWNLOAD_WARNED = 'rastrum.localAiDownloadWarned';

/**
 * WebLLM is ON by default (issue #12 — privacy-first, offline-capable).
 * Users can opt OUT in profile settings if bandwidth is a concern.
 * On first use, a download warning is shown (see ObservationForm).
 */
function isLocalAIEnabled(): boolean {
  if (typeof localStorage === 'undefined') return true; // SSR: default on
  // Legacy opt-in key still respected for users who explicitly enabled it
  if (localStorage.getItem(LOCAL_AI_OPTIN) === 'true') return true;
  // New default: on unless user explicitly opted out
  return localStorage.getItem(LOCAL_AI_OPTIN) !== 'false';
}

export function hasShownLocalAIDownloadWarning(): boolean {
  if (typeof localStorage === 'undefined') return false;
  return localStorage.getItem(LOCAL_AI_DOWNLOAD_WARNED) === 'true';
}

export function markLocalAIDownloadWarningShown(): void {
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(LOCAL_AI_DOWNLOAD_WARNED, 'true');
  }
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

  // Find the primary uploaded blob — prefer image when both photos and audio
  // exist, since the photo cascade has more registered providers today.
  // BirdNET-Lite (audio) is wired but not yet bundled; it'll auto-route once
  // the model lands. See docs/specs/modules/12-birdnet-audio.md.
  const blobs = await db.mediaBlobs.where('observation_id').equals(observationId).toArray();
  const uploadedBlobs = blobs.filter(b => b.upload_url);
  if (uploadedBlobs.length === 0) return;

  const photoBlob = uploadedBlobs.find(b => b.mime_type.startsWith('image/'));
  const audioBlob = uploadedBlobs.find(b => b.mime_type.startsWith('audio/'));
  const primary = photoBlob ?? audioBlob ?? uploadedBlobs[0];
  const mediaKind: 'photo' | 'audio' | 'video' =
    primary.mime_type.startsWith('image/') ? 'photo' :
    primary.mime_type.startsWith('audio/') ? 'audio' :
    primary.mime_type.startsWith('video/') ? 'video' : 'photo';

  const obsRecord = await db.observations.get(observationId);
  const loc = obsRecord?.data.location;
  const habitat = obsRecord?.data.habitat ?? undefined;
  const evidenceType = obsRecord?.data.evidenceType;

  const { bootstrapIdentifiers, runCascade } = await import('./identifiers');
  bootstrapIdentifiers();

  // WebLLM (Phi-3.5-vision) is ON by default — local, private, no key needed.
  // Exclude it only if user explicitly opted out (bandwidth concern).
  // Claude is excluded when no BYO key is set — avoids silent crashes.
  const { getKey } = await import('./byo-keys');
  const hasAnthropicKey = !!getKey('claude_haiku', 'anthropic');
  const localAIEnabled = isLocalAIEnabled();

  const excluded: string[] = [];
  if (!localAIEnabled) excluded.push('webllm_phi35_vision', 'onnx_efficientnet_lite0', 'birdnet_lite');
  if (!hasAnthropicKey) excluded.push('claude_haiku');

  // Camera-trap photos prefer the MegaDetector + SpeciesNet pipeline.
  // When PUBLIC_MEGADETECTOR_ENDPOINT is unset the plugin reports
  // model_not_bundled and the cascade transparently falls through to
  // the standard waterfall (PlantNet → Claude → on-device).
  const preferred: string[] = [];
  if (mediaKind === 'photo' && evidenceType === 'camera_trap') {
    preferred.push('camera_trap_megadetector');
  }

  // Plugins read their own keys from byo-keys.ts at identify-time, so we
  // don't pre-collect them here. Pass an empty byo_keys object as a default.
  const cascadeResult = await runCascade(
    {
      media: { kind: 'url', url: primary.upload_url! },
      mediaKind,
      location: loc ? { lat: loc.lat, lng: loc.lng } : undefined,
      habitat,
      byo_keys: {},
    },
    {
      media: mediaKind,
      taxa: mediaKind === 'audio' ? 'Animalia.Aves' : undefined,
      excluded,
      preferred,
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

/**
 * Flush all pending observations. Safe to call on every `online` event.
 *
 * Drafts (sync_status='draft') are intentionally skipped — they're missing
 * required GPS and live local-only until the user adds location and the UI
 * flips them back to 'pending'. See `ux-save-as-draft` in the v1.1 backlog.
 */
/**
 * Wraps the actual outbox flush in a Web Lock so two tabs of the same
 * user can't both walk the queue simultaneously (which double-uploads
 * blobs and can cause UNIQUE conflicts on identifications). Lock is
 * scoped per-origin via navigator.locks; if the API isn't available
 * (older Safari), we fall through and rely on the existing per-row
 * `uploaded` flag to prevent double-PUT.
 */
export async function syncOutbox(): Promise<SyncResult> {
  const locks = (typeof navigator !== 'undefined' ? (navigator as Navigator & { locks?: LockManager }).locks : undefined);
  if (locks?.request) {
    return await locks.request('rastrum-sync-outbox', { mode: 'exclusive' }, async () => syncOutboxInner());
  }
  return syncOutboxInner();
}

async function syncOutboxInner(): Promise<SyncResult> {
  const db = getDB();
  // Pending AND error rows both belong in the queue. An 'error' row is one
  // that previously failed (e.g. CORS, network blip); we want manual retry
  // and the auto-retry-on-mount to re-attempt them, not just the never-tried
  // 'pending' rows.
  const queued = await db.observations
    .where('sync_status').anyOf('pending', 'error')
    .toArray();
  if (!queued.length) {
    const empty: SyncResult = { synced: 0, failed: 0, skipped_guest: 0, last_error: null };
    emit<SyncDoneDetail>(SYNC_EVENTS.done, empty);
    await announcePendingCount();
    return empty;
  }

  emit(SYNC_EVENTS.start, { total: queued.length });

  let synced = 0, failed = 0, skipped_guest = 0;
  let last_error: string | null = null;

  for (const rec of queued) {
    if (rec.observer_kind === 'guest') { skipped_guest++; continue; }
    try {
      await syncOne(rec);
      synced++;
      emit<SyncRowDetail>(SYNC_EVENTS.rowDone, { observation_id: rec.id });
    } catch (err) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      last_error = msg;
      console.warn('[rastrum] syncOne failed', rec.id, msg);
      await db.observations.update(rec.id, {
        sync_status: 'error',
        sync_error: msg,
        sync_attempts: (rec.sync_attempts ?? 0) + 1,
        updated_at: new Date().toISOString(),
      });
      emit<SyncRowDetail>(SYNC_EVENTS.rowFail, { observation_id: rec.id, error: msg });
    }
  }
  if (synced > 0) setLastSyncAt();
  const result: SyncResult = { synced, failed, skipped_guest, last_error };
  emit<SyncDoneDetail>(SYNC_EVENTS.done, result);
  await announcePendingCount();
  return result;
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

  // Warn the user before unload while a sync is in flight. Otherwise the
  // browser cancels the XHR PUT mid-upload and the row drops back to
  // 'error' state — the next page mount picks it up via auto-retry, but
  // the user just lost progress on a connection they may not have again.
  // Tracked via the start/done sync events.
  let busy = false;
  window.addEventListener(SYNC_EVENTS.start, () => { busy = true; });
  window.addEventListener(SYNC_EVENTS.done,  () => { busy = false; });
  window.addEventListener('beforeunload', (e: BeforeUnloadEvent) => {
    if (!busy) return;
    e.preventDefault();
    // Most browsers ignore the message and show their own generic prompt
    // ("Leave site? Changes you made may not be saved"), but legacy
    // Chrome/Firefox still honour the returnValue/return-string contract.
    e.returnValue = '';
  });
}
