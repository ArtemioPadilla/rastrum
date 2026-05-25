/**
 * Image-variant URL builder for observation thumbnails.
 *
 * PBI 2.1 (#1193) — the explore-recent grid was shipping the full 1200 px
 * upload to every card, blowing the LCP on `/en/explore/recent/` to ~1.5 s.
 * R2 stores a single resized JPEG per upload (see module 10) but
 * `media.rastrum.org` is fronted by Cloudflare's image-resizing endpoint
 * (`/cdn-cgi/image/...`), so we can derive AVIF / WebP / sized variants by
 * URL rewrite — no upload pipeline change required.
 *
 * When the URL is not on a resizing-enabled host (e.g. Supabase Storage
 * fallback, local dev, third-party hotlink), `buildImageVariants()`
 * returns the raw URL only and `hasVariants` is false — callers should
 * emit a plain `<img>` instead of `<picture>` so we never serve a 404 to
 * a CDN that has no idea what `/cdn-cgi/image/...` means.
 */

const DEFAULT_WIDTHS = [320, 640, 1280] as const;

const RESIZING_HOSTS = new Set<string>([
  'media.rastrum.org',
]);

export interface ImageVariantSet {
  /** Raw URL — what `<img src>` falls back to when AVIF/WebP both fail. */
  fallback: string;
  /** True when the URL is on a Cloudflare resizing-enabled host. */
  hasVariants: boolean;
  /** AVIF srcset entries (e.g. `["url 320w", "url 640w", "url 1280w"]`). */
  avifSrcset: string;
  /** WebP srcset entries. */
  webpSrcset: string;
}

function getHost(url: string): string | null {
  try {
    return new URL(url).host;
  } catch {
    return null;
  }
}

function cdnTransform(url: string, width: number, format: 'avif' | 'webp'): string {
  // Cloudflare URL-based image resizing:
  //   https://<host>/cdn-cgi/image/<options>/<origin-path>
  // The origin path is everything after the host of the original URL.
  // We re-anchor on the same host so the worker pulls from the same R2
  // bucket via the same custom-domain binding.
  const parsed = new URL(url);
  const opts = `width=${width},format=${format},fit=cover,quality=80`;
  // Strip any leading slash from the pathname so `/cdn-cgi/image/<opts>/<path>`
  // has exactly one separator between the option string and the origin path.
  const path = parsed.pathname.replace(/^\/+/, '');
  return `${parsed.protocol}//${parsed.host}/cdn-cgi/image/${opts}/${path}${parsed.search}`;
}

/**
 * Build a variant set for a single image URL. `widths` defaults to
 * [320, 640, 1280] which covers mobile-1col → desktop-2col cards. Pass
 * a smaller set for tiny thumbnails (e.g. list view) to keep the srcset
 * string short.
 */
export function buildImageVariants(
  url: string | null | undefined,
  widths: readonly number[] = DEFAULT_WIDTHS,
): ImageVariantSet {
  if (!url || !url.trim()) {
    return { fallback: '', hasVariants: false, avifSrcset: '', webpSrcset: '' };
  }
  const trimmed = url.trim();
  const host = getHost(trimmed);
  const eligible = !!host && RESIZING_HOSTS.has(host) && !trimmed.includes('/cdn-cgi/image/');
  if (!eligible) {
    return { fallback: trimmed, hasVariants: false, avifSrcset: '', webpSrcset: '' };
  }
  const avifSrcset = widths.map((w) => `${cdnTransform(trimmed, w, 'avif')} ${w}w`).join(', ');
  const webpSrcset = widths.map((w) => `${cdnTransform(trimmed, w, 'webp')} ${w}w`).join(', ');
  return { fallback: trimmed, hasVariants: true, avifSrcset, webpSrcset };
}

/**
 * Sizes attribute for the explore-recent card grid:
 *   - mobile (≤640 px) — 1 col → ~100vw
 *   - sm+ (≥641 px) — 2 col → ~50vw
 * Grid view (3-col on md+) hits these same buckets; the 1280 w variant
 * stays the upper bound at retina-2x desktop widths.
 */
export const EXPLORE_CARD_SIZES = '(max-width: 640px) 100vw, 50vw';
