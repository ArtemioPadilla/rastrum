/**
 * Shared observation-creation helper.
 *
 * Both the single-photo ObservationForm and the batch importer need to
 * push an Observation + media blobs into the Dexie outbox in exactly the
 * same shape, so the sync engine handles them identically. This module
 * centralises that path so the two callsites can't drift.
 *
 * See docs/specs/modules/02-observation.md and docs/specs/modules/19-batch-photo-importer.md.
 */
import { getDB, requestPersistentStorage } from './db';
import { getSupabase } from './supabase';
import type {
  EvidenceType, HabitatType, MediaFile, Observation, ObserverRef, WeatherTag,
} from './types';

export interface MediaInput {
  blob: Blob;
  blobId: string;
  mimeType: string;
  sizeBytes: number;
  mediaType: MediaFile['mediaType'];
}

export interface ObservationDraft {
  /** Optional explicit id; defaults to a fresh UUID. */
  id?: string;
  observerRef: ObserverRef;
  /** ISO 8601 string. Defaults to "now". */
  createdAt?: string;
  media: MediaInput[];
  /** Index into `media` of the primary photo. Defaults to 0. */
  primaryPhotoIndex?: number;
  location: {
    lat: number;
    lng: number;
    accuracyM: number;
    altitudeM: number | null;
    capturedFrom: 'gps' | 'exif' | 'manual';
  };
  identification?: Partial<Observation['identification']>;
  habitat?: HabitatType | null;
  weather?: WeatherTag | null;
  evidenceType?: EvidenceType;
  notes?: string | null;
  appVersion?: string;
  deviceOs?: string | null;
}

/** Build a fully-formed Observation from a draft, filling defaults. */
export function buildObservation(draft: ObservationDraft): Observation {
  const id = draft.id ?? crypto.randomUUID();
  const createdAt = draft.createdAt ?? new Date().toISOString();
  const photos: MediaFile[] = draft.media.map((m) => ({
    id: m.blobId,
    mediaType: m.mediaType,
    mimeType: m.mimeType,
    sizeBytes: m.sizeBytes,
  }));

  const id_ = draft.identification ?? {};
  return {
    id,
    observerRef: draft.observerRef,
    createdAt,
    photos,
    primaryPhotoIndex: draft.primaryPhotoIndex ?? 0,
    location: draft.location,
    identification: {
      scientificName: id_.scientificName ?? '',
      commonNameEs:   id_.commonNameEs   ?? null,
      commonNameEn:   id_.commonNameEn   ?? null,
      taxonId:        id_.taxonId        ?? null,
      confidence:     id_.confidence     ?? 0,
      source:         id_.source         ?? 'human',
      status:         id_.status         ?? (id_.scientificName ? 'accepted' : 'pending'),
    },
    habitat:       draft.habitat       ?? null,
    weather:       draft.weather       ?? null,
    evidenceType:  draft.evidenceType  ?? 'direct_sighting',
    notes:         draft.notes         ?? null,
    moonPhase: null,
    moonIllumination: null,
    precipitation24hMm: null,
    ndviValue: null,
    phenologicalSeason: null,
    syncStatus: 'pending',
    syncedAt: null,
    appVersion: draft.appVersion ?? 'v0.1',
    deviceOs:   draft.deviceOs   ?? (typeof navigator !== 'undefined' ? navigator.userAgent : null),
  };
}

/**
 * Persist an observation draft to the Dexie outbox with all its media
 * blobs. Returns the saved Observation. Caller decides whether to also
 * call `syncOutbox()`.
 */
export async function saveObservationToOutbox(draft: ObservationDraft): Promise<Observation> {
  const db = getDB();
  await requestPersistentStorage();
  const obs = buildObservation(draft);

  for (const m of draft.media) {
    await db.mediaBlobs.put({
      id: m.blobId,
      observation_id: obs.id,
      blob: m.blob,
      mime_type: m.mimeType,
      size_bytes: m.sizeBytes,
      uploaded: false,
    });
  }

  await db.observations.put({
    id: obs.id,
    observer_kind: draft.observerRef.kind,
    data: obs,
    sync_status: 'pending',
    sync_attempts: 0,
    created_at: obs.createdAt,
    updated_at: obs.createdAt,
  });

  return obs;
}

/**
 * Resolve the current ObserverRef from Supabase auth, with a hard timeout
 * so an unreachable auth server does not hang submission. Falls back to a
 * fresh guest ref — guest observations stay local-only by design.
 */
export async function resolveObserverRef(timeoutMs: number = 5_000): Promise<ObserverRef> {
  const guest: ObserverRef = { kind: 'guest', localId: 'local-' + crypto.randomUUID() };
  try {
    const authPromise = getSupabase().auth.getUser();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('auth timeout')), timeoutMs),
    );
    const { data: { user } } = await Promise.race([authPromise, timeout]);
    return user ? { kind: 'user', id: user.id } : guest;
  } catch {
    return guest;
  }
}
