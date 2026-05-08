// GBIF species/match — taxonomic-lineage lookup.
//
// Free, no auth, no API key. Returns kingdom/phylum/class/order/family/genus
// for a given scientific name. Used by `enrich-taxon` EF to populate the
// `taxa` table fields the identify cascade can't infer (Claude returns only
// kingdom + family; PlantNet returns only family).
//
// Docs: https://www.gbif.org/developer/species#searching
//
// Stay polite: GBIF asks for ≤ 5 req/s on the public endpoint, which the
// nightly batch enrichment respects via per-call await + a tiny sleep.

const ENDPOINT = 'https://api.gbif.org/v1/species/match';

export type Lineage = {
  kingdom: string | null;
  phylum: string | null;
  class: string | null;
  order: string | null;
  family: string | null;
  genus: string | null;
  matched_name: string;
  match_type: 'EXACT' | 'FUZZY' | 'HIGHERRANK' | 'NONE' | 'UNKNOWN';
  rank: string | null;
};

// Pure parser — accepts the JSON body GBIF returns and extracts the
// lineage. Returns null on responses that aren't usable: matchType=NONE
// (GBIF didn't recognise the name) or invalid shape.
//
// Exposed for unit testing without hitting the network.
export function parseGbifMatch(json: unknown): Lineage | null {
  if (!json || typeof json !== 'object') return null;
  const j = json as Record<string, unknown>;
  const matchType = (j.matchType as string | undefined) ?? 'UNKNOWN';
  if (matchType === 'NONE') return null;
  // GBIF sometimes returns 200 with { synonym: false } and no usageKey when
  // the name is malformed. Reject silently.
  if (typeof j.usageKey !== 'number') return null;

  const safeStr = (v: unknown): string | null =>
    typeof v === 'string' && v.trim().length > 0 ? v : null;

  return {
    kingdom: safeStr(j.kingdom),
    phylum:  safeStr(j.phylum),
    class:   safeStr(j.class),
    order:   safeStr(j.order),
    family:  safeStr(j.family),
    genus:   safeStr(j.genus),
    matched_name: safeStr(j.canonicalName) ?? safeStr(j.scientificName) ?? '',
    match_type: (matchType === 'EXACT' || matchType === 'FUZZY' || matchType === 'HIGHERRANK')
      ? matchType
      : 'UNKNOWN',
    rank: safeStr(j.rank)?.toLowerCase() ?? null,
  };
}

export type LookupOpts = {
  // Injectable for tests. Defaults to globalThis.fetch.
  fetcher?: typeof fetch;
  // Per-request timeout. GBIF is fast; 8s is generous.
  timeoutMs?: number;
};

export async function lookupGbif(scientificName: string, opts: LookupOpts = {}): Promise<Lineage | null> {
  const fetcher = opts.fetcher ?? fetch;
  const timeoutMs = opts.timeoutMs ?? 8_000;

  const url = new URL(ENDPOINT);
  url.searchParams.set('name', scientificName);
  // strict=true only returns matchType=EXACT — too strict for misspelled
  // user input. We accept FUZZY too and let the caller decide whether to
  // trust low-confidence matches.
  url.searchParams.set('verbose', 'false');

  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), timeoutMs);
  try {
    const res = await fetcher(url.toString(), {
      headers: { 'accept': 'application/json' },
      signal: ctrl.signal,
    });
    if (!res.ok) return null;
    const json = await res.json();
    return parseGbifMatch(json);
  } catch {
    return null;
  } finally {
    clearTimeout(timer);
  }
}
