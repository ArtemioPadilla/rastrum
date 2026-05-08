/**
 * Contextual photo praise — EXIF-driven, not content-driven.
 *
 * The PWA reads EXIF on upload (already, for GPS + datetime). This helper
 * picks a single praise key from the camera-settings tags so the UI can
 * show a small, honest compliment next to the thumbnail.
 *
 * Hard rules:
 *  • If EXIF is empty / missing — return `null`. We never lie.
 *  • Praise is technical (lighting, depth-of-field, shutter, focal length),
 *    never aesthetic. ML aesthetic scoring is explicitly out of scope.
 *  • One praise message at most — pick the highest-priority match.
 */

export type PraiseKey =
  | 'good_light'
  | 'portrait_aperture'
  | 'sharp_action'
  | 'balanced_exposure'
  | 'long_lens';

export interface PhotoExifSubset {
  ISO?: unknown;
  FNumber?: unknown;
  ExposureTime?: unknown;
  FocalLength?: unknown;
}

function num(v: unknown): number | null {
  if (typeof v === 'number' && Number.isFinite(v)) return v;
  return null;
}

/**
 * Return the praise key for a parsed EXIF object, or `null` if the EXIF
 * payload is empty / has no actionable camera-settings tags.
 *
 * Priority order (first match wins):
 *  1. `sharp_action`        — fast shutter (ExposureTime ≤ 1/500s)
 *  2. `portrait_aperture`   — wide aperture (FNumber ≤ 2.8)
 *  3. `long_lens`           — telephoto (FocalLength ≥ 200mm)
 *  4. `good_light`          — low ISO (< 400)
 *  5. `balanced_exposure`   — moderate ISO (400 ≤ ISO < 800)
 */
export function pickPraise(exif: PhotoExifSubset | null | undefined): PraiseKey | null {
  if (!exif) return null;

  const iso = num(exif.ISO);
  const fNumber = num(exif.FNumber);
  const exposureSec = num(exif.ExposureTime);
  const focalMm = num(exif.FocalLength);

  if (iso == null && fNumber == null && exposureSec == null && focalMm == null) {
    return null;
  }

  if (exposureSec != null && exposureSec > 0 && exposureSec <= 1 / 500) {
    return 'sharp_action';
  }
  if (fNumber != null && fNumber > 0 && fNumber <= 2.8) {
    return 'portrait_aperture';
  }
  if (focalMm != null && focalMm >= 200) {
    return 'long_lens';
  }
  if (iso != null && iso > 0 && iso < 400) {
    return 'good_light';
  }
  if (iso != null && iso >= 400 && iso < 800) {
    return 'balanced_exposure';
  }

  return null;
}
