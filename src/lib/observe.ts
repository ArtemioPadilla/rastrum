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
import { announcePendingCount } from './sync-events';
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
  cameraStationId?: string | null;
  license?: 'CC BY 4.0' | 'CC BY-NC 4.0' | 'CC0' | null;
  notes?: string | null;
  contentSensitive?: boolean;
  appVersion?: string;
  deviceOs?: string | null;
  /**
   * When true, the row is saved with `sync_status: 'draft'` and the sync
   * engine skips it. Drafts are typically created when the user submits
   * without a finite GPS fix (cell-dead zones).
   */
  asDraft?: boolean;
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
    cameraStationId: draft.cameraStationId ?? null,
    license:       draft.license       ?? null,
    contentSensitive: draft.contentSensitive ?? false,
    notes:         draft.notes         ?? null,
    moonPhase: null,
    moonIllumination: null,
    precipitation24hMm: null,
    ndviValue: null,
    phenologicalSeason: null,
    syncStatus: draft.asDraft ? 'draft' : 'pending',
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
    sync_status: draft.asDraft ? 'draft' : 'pending',
    sync_attempts: 0,
    created_at: obs.createdAt,
    updated_at: obs.createdAt,
  });

  // Header sync pill listens for this — without it the pill stays at its
  // last known count until a sync event fires.
  if (!draft.asDraft) announcePendingCount().catch(() => { /* SSR */ });

  return obs;
}

/**
 * Resolve the current ObserverRef.
 *
 * **Critical:** a network failure must NOT downgrade a signed-in user to
 * guest — that would orphan the observation as a guest row that `syncOne`
 * refuses to sync, losing the data forever even after connectivity returns.
 *
 * Resolution order (each step is local-only, no network):
 *   1. `auth.getSession()` — supabase-js reads its persisted session from
 *      localStorage. No network round-trip in the cached path.
 *   2. Direct localStorage read of `sb-<project-ref>-auth-token` as a
 *      defensive fallback (in case getSession() throws synchronously).
 *   3. Only if BOTH return nothing do we treat the user as a guest.
 *
 * The optional timeout exists purely to bound step 1 in pathological cases;
 * step 2 is sync. We never network-fetch the user here.
 */
export async function resolveObserverRef(timeoutMs: number = 8_000): Promise<ObserverRef> {
  const guest: ObserverRef = { kind: 'guest', localId: 'local-' + crypto.randomUUID() };

  // Fast path: read the persisted session straight out of localStorage
  // BEFORE awaiting `auth.getSession()`. supabase-js's auth lock can
  // serialize getSession() calls on slow Android Chrome and the 2 s
  // timeout fired prematurely (issue #127, Eugenio Oaxaca) — a cached
  // signed-in user looked like a guest and the success message read
  // "Sign in to sync" despite an active session. The fast path closes
  // that race without a network or auth-lock dependency.
  const cachedId = readCachedUserIdFromLocalStorage();
  if (cachedId) return { kind: 'user', id: cachedId };

  try {
    const sessionPromise = getSupabase().auth.getSession();
    const timeout = new Promise<never>((_, reject) =>
      setTimeout(() => reject(new Error('session timeout')), timeoutMs),
    );
    const { data: { session } } = await Promise.race([sessionPromise, timeout]);
    if (session?.user?.id) return { kind: 'user', id: session.user.id };
  } catch {
    // session lookup failed — only fall through to guest if localStorage
    // also had no cached user above.
  }

  return guest;
}

/**
 * Last-ditch synchronous fallback: read the supabase-js persisted session
 * straight out of localStorage. supabase-js stores it under
 * `sb-<project-ref>-auth-token` as JSON `{ access_token, refresh_token, user, ... }`.
 * Used only if `auth.getSession()` itself rejects, e.g. during a partial
 * mutex wedge or a corrupted in-memory state.
 */
function readCachedUserIdFromLocalStorage(): string | null {
  if (typeof localStorage === 'undefined') return null;
  try {
    for (let i = 0; i < localStorage.length; i++) {
      const k = localStorage.key(i);
      if (!k || !k.startsWith('sb-') || !k.endsWith('-auth-token')) continue;
      const raw = localStorage.getItem(k);
      if (!raw) continue;
      const parsed = JSON.parse(raw) as { user?: { id?: string } } | null;
      const uid = parsed?.user?.id;
      if (typeof uid === 'string' && uid.length > 0) return uid;
    }
  } catch {
    // localStorage disabled or JSON malformed — fall through
  }
  return null;
}
