/**
 * Pick the best image URL for an observation card.
 *
 * #1075: list/grid card surfaces (home "Ve a buscar"/"Cerca de ti",
 * /explore/recent?view=list, /explore/species grid) selected only
 * `media_files.url` and rendered an empty box whenever that column was
 * null — even though the very same observation's `/share/obs/` gallery
 * loaded fine, because the gallery falls back to `thumbnail_url`
 * (`p.thumbnail_url ?? p.url`, PhotoGallery.astro). Cards want the small
 * variant anyway, so prefer the thumbnail and fall back to the full URL.
 *
 * Returns `null` when neither is usable so callers can render their own
 * empty/placeholder state instead of a broken `<img>`.
 */
export function pickCardImageUrl(
  m: { url?: string | null; thumbnail_url?: string | null } | null | undefined,
): string | null {
  if (!m) return null;
  const thumb = m.thumbnail_url?.trim();
  if (thumb) return thumb;
  const full = m.url?.trim();
  return full || null;
}
