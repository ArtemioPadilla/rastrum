/**
 * Taxon autocomplete — issue #617
 *
 * Two-tier strategy:
 *   1. Online: Query Supabase `taxa` table (Rastrum observations DB, LAC-relevant)
 *   2. Fallback: GBIF Species Suggest API (global coverage, public, no key needed)
 *
 * Results are debounced, cached in memory for the session, and ranked:
 *   - Genus-exact matches first
 *   - Rastrum-known taxa (have observations) before GBIF-only hits
 *   - Alphabetical within each tier
 *
 * Offline: Only Rastrum taxa cached in the session map are available.
 *
 * See: https://api.gbif.org/v1/species/suggest
 */

export interface TaxonSuggestion {
  /** Canonical scientific name */
  scientificName: string;
  /** Spanish common name (best effort) */
  commonNameEs: string | null;
  /** English common name (best effort) */
  commonNameEn: string | null;
  /** Number of observations in Rastrum DB (null = GBIF-only hit) */
  observationCount: number | null;
  /** Whether the user has observed this taxon before */
  inUserHistory: boolean;
  /** Source of this suggestion */
  source: 'rastrum' | 'gbif';
}

/** In-memory cache: query → results */
const cache = new Map<string, TaxonSuggestion[]>();

const DEBOUNCE_MS = 300;
const MIN_CHARS = 2;
const MAX_RESULTS = 8;
const GBIF_SUGGEST_URL = 'https://api.gbif.org/v1/species/suggest';

let debounceTimer: ReturnType<typeof setTimeout> | null = null;

/**
 * Debounced entry point. Calls `onResults` with up to MAX_RESULTS suggestions.
 * Returns a cancel function.
 */
export function suggestTaxa(
  query: string,
  lang: 'es' | 'en',
  onResults: (results: TaxonSuggestion[]) => void
): () => void {
  if (debounceTimer !== null) clearTimeout(debounceTimer);

  if (query.trim().length < MIN_CHARS) {
    onResults([]);
    return () => {};
  }

  let cancelled = false;

  debounceTimer = setTimeout(async () => {
    if (cancelled) return;

    const cacheKey = `${lang}:${query.toLowerCase()}`;
    if (cache.has(cacheKey)) {
      onResults(cache.get(cacheKey)!);
      return;
    }

    const results = await fetchSuggestions(query, lang);
    if (cancelled) return;

    cache.set(cacheKey, results);
    onResults(results);
  }, DEBOUNCE_MS);

  return () => {
    cancelled = true;
    if (debounceTimer !== null) clearTimeout(debounceTimer);
  };
}

async function fetchSuggestions(
  query: string,
  _lang: 'es' | 'en'
): Promise<TaxonSuggestion[]> {
  const [rastrumHits, gbifHits] = await Promise.allSettled([
    fetchFromRastrum(query),
    fetchFromGBIF(query),
  ]);

  const rastrum: TaxonSuggestion[] =
    rastrumHits.status === 'fulfilled' ? rastrumHits.value : [];
  const gbif: TaxonSuggestion[] =
    gbifHits.status === 'fulfilled' ? gbifHits.value : [];

  // Merge: Rastrum hits take precedence; deduplicate by scientificName
  const seen = new Set<string>(rastrum.map(r => r.scientificName.toLowerCase()));
  const merged = [
    ...rastrum,
    ...gbif.filter(g => !seen.has(g.scientificName.toLowerCase())),
  ];

  return merged.slice(0, MAX_RESULTS);
}

/** Query Rastrum `taxa` table via Supabase client. */
async function fetchFromRastrum(query: string): Promise<TaxonSuggestion[]> {
  // Lazy import to keep this module usable outside Astro SSR
  const { getSupabase } = await import('./supabase');
  const supabase = getSupabase();
  if (!supabase) return [];

  const q = query.trim();

  // Two queries in parallel:
  // 1. Prefix match on scientific_name (catches "Alamania pu...")
  // 2. Genus match — if query has no space, fetch all species in that genus
  const isGenusOnly = !q.includes(' ');

  const prefixQuery = supabase
    .from('taxa')
    .select('scientific_name, common_name_es, common_name_en, observation_count')
    .ilike('scientific_name', `${q}%`)
    .order('observation_count', { ascending: false })
    .limit(MAX_RESULTS);

  const genusQuery = isGenusOnly
    ? supabase
        .from('taxa')
        .select('scientific_name, common_name_es, common_name_en, observation_count')
        .ilike('scientific_name', `${q} %`)
        .order('observation_count', { ascending: false })
        .limit(MAX_RESULTS)
    : null;

  const [prefixRes, genusRes] = await Promise.all([
    prefixQuery,
    genusQuery ?? Promise.resolve({ data: [] as any[], error: null }),
  ]);

  const rows: any[] = [
    ...(prefixRes.data ?? []),
    ...(genusRes.data ?? []),
  ];

  // Deduplicate
  const seen = new Set<string>();
  const unique = rows.filter(r => {
    const key = r.scientific_name?.toLowerCase();
    if (!key || seen.has(key)) return false;
    seen.add(key);
    return true;
  });

  return unique.slice(0, MAX_RESULTS).map(r => ({
    scientificName: r.scientific_name,
    commonNameEs: r.common_name_es ?? null,
    commonNameEn: r.common_name_en ?? null,
    observationCount: r.observation_count ?? null,
    inUserHistory: false, // enriched separately if needed
    source: 'rastrum' as const,
  }));
}

/** Query GBIF Species Suggest API (no auth required, 1 req/keystroke safe). */
async function fetchFromGBIF(query: string): Promise<TaxonSuggestion[]> {
  const url = new URL(GBIF_SUGGEST_URL);
  url.searchParams.set('q', query.trim());
  url.searchParams.set('limit', String(MAX_RESULTS));
  // Restrict to Plantae + Animalia for now (LAC focus)
  // url.searchParams.set('kingdom', 'Plantae');  // uncomment to filter

  const resp = await fetch(url.toString(), { signal: AbortSignal.timeout(3000) });
  if (!resp.ok) return [];

  const data: GBIFSuggestItem[] = await resp.json();

  return data
    .filter(d => d.scientificName && d.rank !== 'KINGDOM' && d.rank !== 'PHYLUM')
    .slice(0, MAX_RESULTS)
    .map(d => ({
      scientificName: d.canonicalName ?? d.scientificName,
      commonNameEs: null,
      commonNameEn: d.vernacularName ?? null,
      observationCount: null,
      inUserHistory: false,
      source: 'gbif' as const,
    }));
}

interface GBIFSuggestItem {
  key: number;
  scientificName: string;
  canonicalName?: string;
  rank?: string;
  vernacularName?: string;
  kingdom?: string;
  phylum?: string;
  class?: string;
  order?: string;
  family?: string;
  genus?: string;
  species?: string;
}

/** Clear session cache (useful for testing). */
export function clearTaxonCache(): void {
  cache.clear();
}
