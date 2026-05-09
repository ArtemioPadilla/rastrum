/**
 * Contextual photo praise — EXIF-driven, optionally taxon-aware.
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
 *  • taxonGroup is optional — when provided, the lookup table prefers a
 *    taxon-aware message over the agnostic fallback. Unknown taxon groups
 *    fall back to the agnostic message.
 */

export type PraiseKey =
  | 'good_light'
  | 'portrait_aperture'
  | 'sharp_action'
  | 'balanced_exposure'
  | 'long_lens';

export type TaxonGroup = 'bird' | 'mammal' | 'reptile' | 'amphibian' | 'plant' | 'fungus';

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

const VALID_TAXON_GROUPS: ReadonlySet<string> = new Set([
  'bird', 'mammal', 'reptile', 'amphibian', 'plant', 'fungus',
]);

/**
 * Return the taxon-aware i18n key path for a praise key + taxon group,
 * or null when the taxon group is unknown / not in v1 list.
 *
 * The resolved key lives at `photo_praise.<key>.<taxonGroup>` in the i18n
 * tree. If the key doesn't exist in the translations, the caller falls back
 * to the agnostic key `upload.praise.<key>`.
 */
export function taxonPraiseI18nPath(
  key: PraiseKey,
  taxonGroup: TaxonGroup | string | null | undefined,
): string | null {
  if (!taxonGroup) return null;
  if (!VALID_TAXON_GROUPS.has(taxonGroup)) return null;
  return `photo_praise.${key}.${taxonGroup}`;
}

/**
 * Return the praise key for a parsed EXIF object, or `null` if the EXIF
 * payload is empty / has no actionable camera-settings tags.
 *
 * When `taxonGroup` is provided and is one of the 6 known groups, the
 * returned key signals that a taxon-aware message should be looked up
 * at `photo_praise.<key>.<taxonGroup>` before falling back to the
 * agnostic `upload.praise.<key>`.
 *
 * Priority order (first match wins):
 *  1. `sharp_action`        — fast shutter (ExposureTime ≤ 1/500s)
 *  2. `portrait_aperture`   — wide aperture (FNumber ≤ 2.8)
 *  3. `long_lens`           — telephoto (FocalLength ≥ 200mm)
 *  4. `good_light`          — low ISO (< 400)
 *  5. `balanced_exposure`   — moderate ISO (400 ≤ ISO < 800)
 */
export function pickPraise(
  exif: PhotoExifSubset | null | undefined,
  taxonGroup?: TaxonGroup | string | null,
): PraiseKey | null {
  if (!exif) return null;

  const iso = num(exif.ISO);
  const fNumber = num(exif.FNumber);
  const exposureSec = num(exif.ExposureTime);
  const focalMm = num(exif.FocalLength);

  if (iso == null && fNumber == null && exposureSec == null && focalMm == null) {
    return null;
  }

  // taxonGroup parameter is used by the caller to decide which i18n branch to
  // render. The key itself is the same regardless of taxon — only the copy differs.
  void taxonGroup;

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
