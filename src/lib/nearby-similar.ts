/**
 * Pure helpers for `NearbySimilarCard.astro` (#616).
 *
 * The component itself uses Astro's inline-script syntax which bundles
 * into the page; these helpers live in their own module so the unit
 * tests can exercise them without booting JSDOM. Anything stateful
 * (DOM hydration, supabase RPC) stays inside the .astro file.
 */

export interface NearbySimilarRow {
  taxon_id: string;
  scientific_name: string;
  common_name_en: string | null;
  common_name_es: string | null;
  slug: string | null;
  obs_count: number;
  last_observed_at: string;
  distance_m: number;
}

export interface NearbySimilarCopy {
  title: string;
  subtitle: string;
  seen_n_times: string;
  seen_once: string;
  n_km_away: string;
  n_m_away: string;
  view_species: string;
  empty_state: string;
}

/** Formats raw metres into a localized "X km" / "Y m" string. */
export function formatDistance(meters: number, copy: NearbySimilarCopy): string {
  if (!Number.isFinite(meters) || meters < 0) return '';
  if (meters < 1000) {
    return copy.n_m_away.replace('{n}', String(Math.round(meters)));
  }
  const km = meters < 10000
    ? (meters / 1000).toFixed(1)
    : String(Math.round(meters / 1000));
  return copy.n_km_away.replace('{n}', km);
}

/** Builds the right-aligned pill text — "seen 2× · 1.2 km away". */
export function formatPill(row: NearbySimilarRow, copy: NearbySimilarCopy): string {
  const seen = row.obs_count > 1
    ? copy.seen_n_times.replace('{n}', String(row.obs_count))
    : copy.seen_once;
  return `${seen} · ${formatDistance(row.distance_m, copy)}`;
}

/** Returns the localized species-detail href for an RPC row. */
export function speciesHref(row: NearbySimilarRow, lang: 'en' | 'es'): string {
  const base = lang === 'es' ? '/es/explorar/especies/' : '/en/explore/species/';
  if (row.slug) return base + encodeURIComponent(row.slug);
  return base + '?taxon=' + encodeURIComponent(row.taxon_id);
}
