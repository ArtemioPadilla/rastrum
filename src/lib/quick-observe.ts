/**
 * Quick Observation builder — collapses photo + best-effort GPS into a
 * single Dexie outbox row. The identify cascade and (when GPS is missing
 * at capture time) a draft → pending promotion both run through the
 * existing sync engine.
 *
 * See issue #721 / docs/specs/modules/02-photo-id.md (Quick Observation
 * section, M02 v1.1) for design rationale (Fogg Principle of Reduction).
 */

import type { ObservationDraft, MediaInput } from './observe';

export interface QuickGpsInput {
  lat: number;
  lng: number;
  accuracyM: number;
  altitudeM: number | null;
  source: 'gps' | 'exif';
}

export interface QuickObserveBuildArgs {
  observerRef: ObservationDraft['observerRef'];
  /** The captured photo (or audio/video). Single file for the quick path. */
  file: { blob: Blob; mimeType: string; sizeBytes: number };
  /**
   * Best-known location at save time. EXIF preferred over live GPS — the
   * photo was taken AT that location, not where the user is right now.
   * Pass `null` when neither has resolved by the moment we hit the outbox;
   * the row is then saved as 'draft' and `promoteDraftsWithGps()` flips it
   * to 'pending' once a fix arrives via the existing sync trigger.
   */
  location: QuickGpsInput | null;
  /** Optional extra context (rarely used in quick mode). */
  notes?: string | null;
  blobId?: string;
}

const NULL_ISLAND_EPS = 1e-6;

/**
 * Decide the media kind from a MIME type. Mirrors the fallback chain in
 * sync.ts — quick captures from iOS Safari sometimes have empty MIME.
 */
export function mediaKindFromMime(mimeType: string): MediaInput['mediaType'] {
  if (mimeType.startsWith('audio/')) return 'audio';
  if (mimeType.startsWith('video/')) return 'video';
  return 'photo';
}

/**
 * Reject EXIF/GPS coordinates of (0, 0) — the well-known "null island"
 * default emitted by camera apps that strip GPS tags. lat=0 alone is a
 * legitimate equator reading (Ecuador, Kenya, etc.) so only the *pair*
 * is treated as garbage.
 */
export function isNullIsland(lat: number, lng: number): boolean {
  return Math.abs(lat) < NULL_ISLAND_EPS && Math.abs(lng) < NULL_ISLAND_EPS;
}

/**
 * Build a quick-mode `ObservationDraft` ready for `saveObservationToOutbox`.
 *
 * Behaviour summary:
 *   - If `location` is null OR a null-island pair, the draft is saved as
 *     `asDraft: true` (sync engine skips until GPS is available).
 *   - Identification is left blank (`status: 'pending'`); the cascade runs
 *     async via the existing post-sync `triggerIdentify` flow.
 *   - Defaults: `evidenceType` for audio is 'sound', else 'direct_sighting'.
 */
export function buildQuickObservationDraft(args: QuickObserveBuildArgs): ObservationDraft {
  const { file, location, observerRef, notes = null, blobId } = args;
  const mediaType = mediaKindFromMime(file.mimeType);
  const finalLocation = location && !isNullIsland(location.lat, location.lng)
    ? {
        lat: location.lat,
        lng: location.lng,
        accuracyM: location.accuracyM,
        altitudeM: location.altitudeM,
        capturedFrom: location.source,
      }
    : null;

  return {
    observerRef,
    media: [{
      blob: file.blob,
      blobId: blobId ?? crypto.randomUUID(),
      mimeType: file.mimeType,
      sizeBytes: file.sizeBytes,
      mediaType,
    }],
    location: finalLocation ?? {
      lat: 0,
      lng: 0,
      accuracyM: 0,
      altitudeM: null,
      capturedFrom: 'gps',
    },
    notes,
    evidenceType: mediaType === 'audio' ? 'sound' : 'direct_sighting',
    asDraft: !finalLocation,
  };
}

/**
 * One-shot navigator.geolocation wrapper bounded by a hard timeout. Returns
 * null on any failure (denied, unavailable, timeout) — the caller saves a
 * draft in that case and the sync engine promotes it later.
 *
 * The default 12s timeout is generous on purpose — we don't want to bail
 * prematurely on a cold-start GPS lock when the user is outside.
 */
export function getQuickGps(
  navigatorRef: { geolocation?: { getCurrentPosition: (
    success: (pos: { coords: { latitude: number; longitude: number; accuracy: number; altitude: number | null } }) => void,
    error: (err: { code: number }) => void,
    options?: PositionOptions,
  ) => void } } = (typeof navigator !== 'undefined' ? navigator : ({} as never)),
  timeoutMs = 12_000,
): Promise<QuickGpsInput | null> {
  if (!navigatorRef.geolocation?.getCurrentPosition) return Promise.resolve(null);
  return new Promise((resolve) => {
    let settled = false;
    const finish = (v: QuickGpsInput | null) => {
      if (settled) return;
      settled = true;
      resolve(v);
    };
    const t = setTimeout(() => finish(null), timeoutMs);
    navigatorRef.geolocation!.getCurrentPosition(
      (pos) => {
        clearTimeout(t);
        finish({
          lat: pos.coords.latitude,
          lng: pos.coords.longitude,
          accuracyM: pos.coords.accuracy,
          altitudeM: pos.coords.altitude,
          source: 'gps',
        });
      },
      () => { clearTimeout(t); finish(null); },
      { enableHighAccuracy: true, timeout: timeoutMs, maximumAge: 60_000 },
    );
  });
}
