/**
 * Contextual species suggestions (issue #723).
 *
 * Surfaces taxa likely to be encountered at a given lat/lng + month,
 * derived from Rastrum's own observation density (Option A — same
 * proxy used by falta-dex). The SQL RPC `probable_taxa_at()` does
 * the heavy lifting; this module is a thin client + pure helpers
 * for the chip-strip UI.
 */
import { getSupabase } from './supabase';

export interface ProbableTaxon {
  taxon_id: string;
  scientific_name: string;
  common_name_es: string | null;
  common_name_en: string | null;
  slug: string | null;
  thumbnail_url: string | null;
  n_obs: number;
  last_seen_distance_km: number | null;
  has_observed_by_viewer: boolean | null;
}

export interface SuggestParams {
  lat: number;
  lng: number;
  /** 1–12 (calendar month, ±1 wrap-around handled server-side) */
  month: number;
  /** capped at 50 server-side */
  limit?: number;
}

/**
 * Fetch contextual suggestions. Returns an empty array on any error
 * (anon RLS, network failure, missing extension) — the chip strip is
 * a soft surface; never block the form on a failed call.
 */
export async function fetchProbableTaxa(p: SuggestParams): Promise<ProbableTaxon[]> {
  if (!isValidLatLng(p.lat, p.lng) || !isValidMonth(p.month)) return [];
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase.rpc('probable_taxa_at', {
      p_lat: p.lat,
      p_lng: p.lng,
      p_month: p.month,
      p_limit: clampLimit(p.limit),
    });
    if (error) return [];
    return (data ?? []) as ProbableTaxon[];
  } catch {
    return [];
  }
}

export function isValidLatLng(lat: number, lng: number): boolean {
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) return false;
  if (lat === 0 && lng === 0) return false;
  return lat >= -90 && lat <= 90 && lng >= -180 && lng <= 180;
}

export function isValidMonth(month: number): boolean {
  return Number.isInteger(month) && month >= 1 && month <= 12;
}

export function clampLimit(limit: number | undefined): number {
  if (limit == null || !Number.isFinite(limit) || limit <= 0) return 10;
  if (limit > 50) return 50;
  return Math.floor(limit);
}

/**
 * Choose the display common name for the user's locale, falling back
 * to the other locale, then to the scientific name. Never returns
 * null — UI rendering depends on a non-empty label.
 */
export function pickCommonName(
  taxon: Pick<ProbableTaxon, 'scientific_name' | 'common_name_en' | 'common_name_es'>,
  lang: 'en' | 'es',
): string {
  const primary = lang === 'es' ? taxon.common_name_es : taxon.common_name_en;
  const secondary = lang === 'es' ? taxon.common_name_en : taxon.common_name_es;
  return (primary ?? secondary ?? taxon.scientific_name).trim();
}

/**
 * Format the distance pill. Sub-kilometre distances round up to
 * "<1 km" so the pill never reads "0.0 km" (which a casual user
 * would interpret as "exactly here" rather than "very close").
 */
export function formatDistancePill(km: number | null, lang: 'en' | 'es'): string {
  if (km == null || !Number.isFinite(km) || km < 0) return '';
  if (km < 1) return lang === 'es' ? '<1 km' : '<1 km';
  if (km < 10) return `${km.toFixed(1)} km`;
  return `${Math.round(km)} km`;
}

/**
 * Build a stable cache key for sessionStorage so the chip strip
 * survives a page bounce within the same session without re-querying.
 * Coords are bucketed to ~1 km (3 decimal places) so tiny GPS jitter
 * doesn't bust the cache.
 */
export function suggestCacheKey(p: SuggestParams): string {
  const lat = Math.round(p.lat * 1000) / 1000;
  const lng = Math.round(p.lng * 1000) / 1000;
  return `rastrum.suggest.${p.month}.${lat}.${lng}`;
}
