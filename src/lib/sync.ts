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

  // If the observation was saved while the user was not yet authenticated (guest),
  // try to re-resolve the observer now. If there's an active session, upgrade
  // the record in Dexie so future syncs also pick it up.
  //
  // NOTE: syncOutboxInner() also has a guest-upgrade path added in the fix for
  // the skipped_guest bug (2026-04-28). If this upgrade logic changes, update
  // both places. The duplication is intentional: syncOutboxInner upgrades before
  // the loop so the re-fetched record has the right observer_kind; this path
  // handles edge cases where syncOne is called directly.
  let observerRef = obs.observerRef;
  if (observerRef.kind !== 'user') {
    try {
      const { data: { session } } = await getSupabase().auth.getSession();
      if (session?.user?.id) {
        observerRef = { kind: 'user', id: session.user.id };
        const db = await getDB();
        await db.observations.update(record.id, {
          data: { ...obs, observerRef },
          observer_kind: 'user',
        });
      }
    } catch { /* leave as guest, will retry next sync */ }
  }

  if (observerRef.kind !== 'user') return;

  const serverRow = {
    id:              obs.id,
    observer_id:     observerRef.id,
    observed_at:     obs.createdAt,
    location:        `SRID=4326;POINT(${obs.location.lng} ${obs.location.lat})`,
    accuracy_m:      obs.location.accuracyM,
    altitude_m:      obs.location.altitudeM,
    location_source: obs.location.capturedFrom,
    habitat:         obs.habitat,
    weather:         obs.weather,
    evidence_type:   obs.evidenceType ?? 'direct_sighting',
    camera_station_id: obs.cameraStationId ?? null,
    license:         obs.license ?? null,
    content_sensitive: obs.contentSensitive ?? false,
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
        media_type: ((): 'photo' | 'audio' | 'video' => {
          const mime = b.mime_type || '';
          if (mime.startsWith('image/')) return 'photo';
          if (mime.startsWith('audio/')) return 'audio';
          if (mime.startsWith('video/')) return 'video';
          // Fallback: check the upload URL or blob ID for audio/video extensions
          const ref = (b.upload_url ?? b.id ?? '').toLowerCase();
          if (/\.(webm|ogg|mp3|wav|m4a|aac|flac|opus)$/i.test(ref)) return 'audio';
          if (/\.(mp4|mov|avi|mkv|webm)$/i.test(ref)) return 'video';
          // Last resort: check the observation's evidence_type — sound evidence is audio
          if (obs.evidenceType === 'sound') return 'audio';
          return 'photo';
        })(),
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

  // 3.5. Render the OG card client-side and PUT it to R2 alongside
  //      the photo. The card lives at og/<obs-id>.png and is referenced
  //      by share/obs/<id> via the og:image meta tag — a static file
  //      served by the Cloudflare CDN, no per-request server compute.
  //      Best-effort: a render failure does NOT fail the whole sync.
  try {
    const primaryBlob = blobs.find(b => b.mime_type.startsWith('image/')) ?? blobs[0];
    if (primaryBlob?.upload_url) {
      const { renderObservationOgPng } = await import('./og-card');
      const png = await renderObservationOgPng({
        scientificName: obs.identification.scientificName || '',
        commonName:     obs.identification.commonNameEs || obs.identification.commonNameEn,
        observedAt:     obs.createdAt,
        photoUrl:       primaryBlob.upload_url,
        meta:           [obs.habitat, obs.weather].filter(Boolean).join(' · '),
      });
      const ogKey = `og/${record.id}.png`;
      await uploadMedia(png, ogKey, 'image/png').catch(err => {
        console.warn('[rastrum] OG card upload failed (non-fatal)', err);
      });
    }
  } catch (err) {
    console.warn('[rastrum] OG card render failed (non-fatal)', err);
  }

  // 4. Mark synced in Dexie
  await db.observations.update(record.id, {
    sync_status: 'synced',
    updated_at: new Date().toISOString(),
  });

  // 4.5. If the client already identified the species (e.g. BirdNET on audio,
  //      EfficientNet on image), persist that identification directly. Audio
  //      has no server-side identifier in the cascade, so without this step
  //      the observation lands as "Unknown species" forever.
  //
  //      Fix #343: also persist identifications with status 'needs_review',
  //      and accept pipeline results that have confidence > 0 even when
  //      scientificName is still empty (partial results with common names).
  const clientId = obs.identification;
  const hasIdentification = clientId.scientificName || (clientId.confidence > 0 && clientId.source !== 'human');
  // #582: never persist identifications whose source produces non-binomial
  // scientific names. EfficientNet writes English ImageNet labels into
  // scientific_name which corrupts taxa rows + DwC exports. Treat as a
  // hint only — fall through to the server cascade for a real ID.
  const NON_BINOMIAL_SOURCES = new Set(['onnx_efficientnet_lite0']);
  if (hasIdentification && NON_BINOMIAL_SOURCES.has(clientId.source ?? '')) {
    console.warn('[rastrum] skipping non-binomial source persist:', clientId.source);
  } else if (hasIdentification && (clientId.status === 'accepted' || clientId.status === 'needs_review')) {
    const supabase = getSupabase();

    // Upsert taxa row so observations.primary_taxon_id can be resolved by
    // the sync_primary_identification trigger. On conflict (scientific_name
    // already exists) update common names only — kingdom/family come from
    // authoritative upstream sources.
    let taxonId: string | null = null;
    if (clientId.scientificName) {
      try {
        const taxonPayload: Record<string, unknown> = {
          scientific_name: clientId.scientificName,
          common_name_es: clientId.commonNameEs ?? null,
          common_name_en: clientId.commonNameEn ?? null,
          taxon_rank: 'species',
        };
        const { data: taxonRow } = await supabase
          .from('taxa')
          .upsert(taxonPayload, { onConflict: 'scientific_name', ignoreDuplicates: false })
          .select('id')
          .maybeSingle();
        if (taxonRow?.id) taxonId = taxonRow.id as string;
      } catch {
        // taxa upsert is non-fatal — trigger fallback handles scientific_name lookup
      }
    }

    const { error: clientIdErr } = await supabase.from('identifications').insert({
      observation_id: record.id,
      scientific_name: clientId.scientificName,
      taxon_id: taxonId,
      confidence: Math.max(0, Math.min(1, clientId.confidence ?? 0)),
      source: clientId.source ?? 'human',
      is_primary: true,
      raw_response: {
        common_name_en: clientId.commonNameEn,
        common_name_es: clientId.commonNameEs,
        client_persisted: true,
      },
    });
    if (clientIdErr) {
      console.warn('[rastrum] client identification persist failed', clientIdErr);
      // Fall through to server cascade as a backstop.
    } else {
      // Identification persisted; skip the server cascade for this observation.
      triggerEnvEnrichment(record.id).catch(err => console.warn('[rastrum] enrich failed', err));
      return;
    }
  }

  // 5. No client identification (or persistence failed) — queue the server cascade.
  const existingQueue = await db.idQueue.get(record.id);
  if (!existingQueue) {
    await db.idQueue.put({
      observation_id: record.id,
      queued_at: new Date().toISOString(),
      attempts: 0,
    });
  }

  // 5b. Trigger the identify Edge Function async (fire-and-forget; the queue
  //     catches retries). The function does its own DB writes.
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
 * Edge Function's hardcoded list. It walks every registered plugin
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
  // Large models (Phi-3.5 2.4 GB, BirdNET ~50 MB) gate on localAIEnabled.
  // EfficientNet-Lite0 is only ~2.8 MB — run it whenever it's downloaded,
  // regardless of the localAI bandwidth toggle.
  if (!localAIEnabled) excluded.push('webllm_phi35_vision', 'birdnet_lite');
  const { getOnnxBaseCacheStatus, getOnnxBaseWeightsBaseUrl } = await (await import('./identifiers/onnx-base-cache'));
  const efficientNetCached = getOnnxBaseWeightsBaseUrl()
    ? await getOnnxBaseCacheStatus().then(s => s.modelCached && s.labelsCached).catch(() => false)
    : false;
  if (!efficientNetCached) excluded.push('onnx_efficientnet_lite0');
  if (!hasAnthropicKey) excluded.push('claude_haiku');

  // Camera-trap photos prefer the MegaDetector + SpeciesNet pipeline.
  // When PUBLIC_MEGADETECTOR_ENDPOINT is unset the plugin reports
  // model_not_bundled and the cascade transparently falls through to
  // the standard cost-sorted race (PlantNet ∥ Claude ∥ on-device).
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

  // #582: skip non-binomial sources — they produce English ImageNet labels
  // that pollute taxa.scientific_name and DwC exports. Cascade can still
  // surface them as alternates in the UI, but never as the primary ID.
  const NON_BINOMIAL_SOURCES_ID = new Set(['onnx_efficientnet_lite0']);
  if (NON_BINOMIAL_SOURCES_ID.has(r.source)) {
    console.warn('[rastrum] cascade winner is non-binomial source, not persisting:', r.source);
    await db.idQueue.update(observationId, {
      attempts: ((await db.idQueue.get(observationId))?.attempts ?? 0) + 1,
      last_error: 'non-binomial source: ' + r.source,
    });
    return;
  }

  // Apply taxonomy synonym correction for known outdated names (#345)
  const { correctIdentificationName } = await import('./taxonomy-synonyms');
  const correctedName = correctIdentificationName(r.scientific_name);
  const { error: insertErr } = await supabase.from('identifications').insert({
    observation_id: observationId,
    scientific_name: correctedName,
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

  // #334: Persist secondary species detections from BirdNET's sliding-window
  // analysis. Each distinct species detected across audio segments gets its
  // own non-primary identification row, enabling the obs-detail page to show
  // "Also detected: ..." and Darwin Core exports to include all species.
  const rawResponse = r.raw as Record<string, unknown> | undefined;
  const allSpecies = rawResponse?.allSpecies as Array<{
    scientific_name: string;
    common_name_en: string | null;
    maxScore: number;
  }> | undefined;

  if (allSpecies && allSpecies.length > 1 && r.source === 'birdnet_lite') {
    const sigmoid = (x: number) => 1 / (1 + Math.exp(-x));
    const secondarySpecies = allSpecies
      .filter(sp => sp.scientific_name !== r.scientific_name)
      .slice(0, 4); // Cap at 4 secondary IDs to avoid noise

    for (const sp of secondarySpecies) {
      const correctedSecondary = correctIdentificationName(sp.scientific_name);
      await supabase.from('identifications').insert({
        observation_id: observationId,
        scientific_name: correctedSecondary,
        confidence: sigmoid(sp.maxScore),
        source: 'birdnet_lite',
        is_primary: false,
        raw_response: { secondary_detection: true, max_score: sp.maxScore, common_name_en: sp.common_name_en },
      }).then(({ error }) => {
        if (error) console.warn('[rastrum] secondary BirdNET ID insert failed', correctedSecondary, error.message);
      });
    }
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
  const supabase = getSupabase();

  // Auth guard: bail early when there's no valid session. Without this,
  // Supabase queries fail silently with an expired/missing JWT and the
  // UI stays in a loading state indefinitely (#342).
  try {
    const { data: { session } } = await supabase.auth.getSession();
    if (!session) {
      const noAuth: SyncResult = { synced: 0, failed: 0, skipped_guest: 0, last_error: 'no_session' };
      emit<SyncDoneDetail>(SYNC_EVENTS.done, noAuth);
      return noAuth;
    }
  } catch {
    const noAuth: SyncResult = { synced: 0, failed: 0, skipped_guest: 0, last_error: 'session_check_failed' };
    emit<SyncDoneDetail>(SYNC_EVENTS.done, noAuth);
    return noAuth;
  }

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
    // Guest rows were saved before the user authenticated. Before skipping,
    // try to upgrade the record to the current authenticated user so it can
    // be synced. The same upgrade runs inside syncOne() but the guard below
    // was skipping guest rows before syncOne() ever ran — meaning observations
    // saved offline before login never synced even after the user logged in.
    if (rec.observer_kind === 'guest') {
      try {
        const { data: { session } } = await supabase.auth.getSession();
        if (session?.user?.id) {
          const upgradedData: Observation = {
            ...(rec.data as Observation),
            observerRef: { kind: 'user', id: session.user.id },
          };
          await db.observations.update(rec.id, {
            observer_kind: 'user',
            data: upgradedData,
          });
          // Re-fetch the updated record so syncOne uses the upgraded observer
          const upgraded = await db.observations.get(rec.id);
          if (upgraded) {
            try {
              await syncOne(upgraded);
              synced++;
              emit<SyncRowDetail>(SYNC_EVENTS.rowDone, { observation_id: rec.id });
            } catch (err) {
              failed++;
              const msg = err instanceof Error ? err.message : String(err);
              last_error = msg;
              console.warn('[rastrum] syncOne (upgraded guest) failed', rec.id, msg);
              await db.observations.update(rec.id, {
                sync_status: 'error', sync_error: msg,
                sync_attempts: (rec.sync_attempts ?? 0) + 1,
                updated_at: new Date().toISOString(),
              });
              emit<SyncRowDetail>(SYNC_EVENTS.rowFail, { observation_id: rec.id, error: msg });
            }
            continue;
          }
        }
      } catch { /* couldn't upgrade, leave as guest for next sync */ }
      skipped_guest++;
      continue;
    }
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

  // Telemetry beacon — fire-and-forget after we record any failure. One
  // beacon per syncOutbox call, regardless of how many rows failed; the
  // Edge Function aggregates per (user, error_hash, day). See runbook #2.
  if (failed > 0 && last_error) {
    void sendSyncErrorBeacon({ message: last_error, blob_count: failed });
  }

  const result: SyncResult = { synced, failed, skipped_guest, last_error };
  emit<SyncDoneDetail>(SYNC_EVENTS.done, result);
  await announcePendingCount();
  return result;
}

async function sendSyncErrorBeacon(opts: { message: string; blob_count: number }): Promise<void> {
  if (typeof navigator === 'undefined') return;
  try {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    const supabaseUrl = (import.meta.env.PUBLIC_SUPABASE_URL as string | undefined) ?? '';
    if (!supabaseUrl) return;
    const url = `${supabaseUrl.replace(/\/$/, '')}/functions/v1/sync-error`;
    const body = JSON.stringify({
      user_id: user?.id ?? null,
      error_message: opts.message.slice(0, 500),
      blob_count: opts.blob_count,
      sync_attempts: 1,
      app_version: (import.meta.env.PUBLIC_BUILD_VERSION as string | undefined) ?? 'unknown',
    });
    if (typeof navigator.sendBeacon === 'function') {
      // sendBeacon is the right API for telemetry — survives navigation
      // and avoids the keepalive-fetch limit. Content-Type defaults to
      // text/plain;charset=utf-8 which is fine for our function.
      navigator.sendBeacon(url, new Blob([body], { type: 'application/json' }));
    } else {
      fetch(url, {
        method: 'POST', body, keepalive: true,
        headers: { 'content-type': 'application/json' },
      }).catch(() => { /* swallow */ });
    }
  } catch { /* never let telemetry break sync */ }
}

/**
 * Promote any draft observation that now has a real GPS fix back to
 * 'pending', so the outbox flush picks it up. A "real fix" = lat+lng
 * are finite AND not (0,0). Drafts created at (0,0) by the form's
 * fallback path are explicitly excluded.
 */
export async function promoteDraftsWithGps(): Promise<number> {
  const db = getDB();
  const drafts = await db.observations.where('sync_status').equals('draft').toArray();
  let promoted = 0;
  for (const rec of drafts) {
    const loc = rec.data?.location;
    const hasFix = loc
      && Number.isFinite(loc.lat) && Number.isFinite(loc.lng)
      && !(loc.lat === 0 && loc.lng === 0);
    if (!hasFix) continue;
    await db.observations.update(rec.id, {
      sync_status: 'pending',
      updated_at: new Date().toISOString(),
    });
    // Mirror the change in the embedded Observation snapshot too — the row
    // marshals through `data` when the sync engine serialises it.
    if (rec.data) {
      rec.data.syncStatus = 'pending';
      await db.observations.update(rec.id, { data: rec.data });
    }
    promoted++;
  }
  if (promoted > 0) await announcePendingCount();
  return promoted;
}

/** Register listeners that auto-flush the outbox when the app is visible/online. */
export function registerSyncTriggers(): void {
  if (typeof window === 'undefined') return;
  const maybeSync = async () => {
    // Promote any drafts whose location got filled in since last visit
    // (manual entry on a previous mount, EXIF GPS recovered from a photo,
    // map-picker click). Without this, drafts stay in limbo even after the
    // user has fixed the missing field.
    await promoteDraftsWithGps().catch(() => { /* draft promotion non-fatal */ });
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
