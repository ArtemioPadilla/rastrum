/**
 * Pure helpers for the camera + video flows in the observation form.
 *
 * These live outside the Astro component so we can unit-test them with
 * Vitest. Anything that touches `document` / `MediaRecorder` / DOM APIs
 * stays in the component; this module only exposes deciding-logic.
 */

export interface IsTypeSupportedFn {
  (mime: string): boolean;
}

/**
 * Codec preference order for video recording, per `video-support` in
 * progress.json: H.265 → AV1 → VP9 → VP8 → whatever the browser supports.
 *
 * Each entry is a full MIME string suitable for `MediaRecorder.isTypeSupported`.
 * Container hopping is intentional — Safari prefers MP4 with hvc1 (HEVC),
 * Chrome/Firefox prefer WebM with VP9/AV1.
 */
export const VIDEO_MIME_PREFERENCE: ReadonlyArray<string> = [
  'video/mp4;codecs=hvc1',         // H.265 in MP4 (Safari)
  'video/mp4;codecs=hev1',         // H.265 alt tag
  'video/webm;codecs=av01',        // AV1 in WebM (Chrome 116+)
  'video/mp4;codecs=av01',         // AV1 in MP4
  'video/webm;codecs=vp9,opus',    // VP9 in WebM (Chrome/Firefox)
  'video/webm;codecs=vp9',
  'video/webm;codecs=vp8,opus',
  'video/webm;codecs=vp8',
  'video/webm',
  'video/mp4',
];

/**
 * Pick the best supported MIME type from `VIDEO_MIME_PREFERENCE`.
 * Returns the first entry that `isTypeSupported` accepts, or
 * `'video/webm'` as a last-ditch fallback (every modern browser
 * accepts at least the un-tagged container).
 */
export function pickVideoMime(isTypeSupported: IsTypeSupportedFn): string {
  for (const m of VIDEO_MIME_PREFERENCE) {
    if (isTypeSupported(m)) return m;
  }
  return 'video/webm';
}

/** Maximum recording duration enforced client-side. */
export const VIDEO_MAX_SECS = 30;

/**
 * Frame-extraction parameters used by the thumbnail generator. Pulled
 * out so tests can pin the exact values instead of relying on opaque
 * magic numbers in the component code.
 *
 * `seekToSec` — small offset from t=0 to dodge the black first frame
 *               that some encoders emit before the keyframe lands.
 * `quality`   — JPEG quality factor for `canvas.toBlob`.
 */
export const VIDEO_THUMB_PARAMS = {
  seekToSec: 0.1,
  quality: 0.8,
  mime: 'image/jpeg' as const,
};

/**
 * Compute the destination width/height for a video frame thumbnail,
 * preserving the source aspect ratio while clamping the longest side
 * to `maxSide`. Returns integer pixel dimensions.
 *
 * Defensive: a non-finite or zero source dimension falls back to a
 * square `maxSide × maxSide` thumbnail (avoids `NaN`/`Infinity` in
 * canvas calls — same defensive pattern as the GPS NaN guards in
 * ObservationForm.astro).
 */
export function computeThumbDims(
  srcW: number,
  srcH: number,
  maxSide = 320,
): { w: number; h: number } {
  if (!Number.isFinite(srcW) || !Number.isFinite(srcH) || srcW <= 0 || srcH <= 0) {
    return { w: maxSide, h: maxSide };
  }
  const ratio = srcW / srcH;
  if (ratio >= 1) {
    return { w: maxSide, h: Math.max(1, Math.round(maxSide / ratio)) };
  }
  return { w: Math.max(1, Math.round(maxSide * ratio)), h: maxSide };
}

/** Default starting view for the map picker when no GPS fix exists. */
export const MEXICO_DEFAULT_CENTER = { lat: 19.4, lng: -99.1, zoom: 5 } as const;

/**
 * Validate a (lat, lng) pair before pushing it into the location state.
 * Mirrors the finite-coords guard in the form's submit path.
 */
export function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat < -90 || lat > 90) return false;
  if (lng < -180 || lng > 180) return false;
  return true;
}
