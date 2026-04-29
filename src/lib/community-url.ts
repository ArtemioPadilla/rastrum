/**
 * Pure URL state ↔ filter object helpers for /community/observers/.
 *
 * Decoupled from `lib/community.ts` (the query client) so the
 * round-trip can be unit-tested in isolation. Unknown values drop
 * silently — the page never crashes on a hand-edited URL.
 */

export type CommunitySort =
  | 'observation_count'
  | 'species_count'
  | 'obs_count_7d'
  | 'obs_count_30d'
  | 'last_observation_at'
  | 'joined_at'
  | 'distance';

const SORTS: ReadonlyArray<CommunitySort> = [
  'observation_count',
  'species_count',
  'obs_count_7d',
  'obs_count_30d',
  'last_observation_at',
  'joined_at',
  'distance',
];

export interface CommunityFilters {
  sort: CommunitySort;
  /** ISO-3166 alpha-2 (uppercase) or null = any. */
  country: string | null;
  /** Empty array = any. Multiple taxa AND-match against expert_taxa. */
  taxa: string[];
  experts: boolean;
  nearby: boolean;
  /** 1-indexed. */
  page: number;
}

export const DEFAULT_FILTERS: CommunityFilters = {
  sort: 'observation_count',
  country: null,
  taxa: [],
  experts: false,
  nearby: false,
  page: 1,
};

function isSort(x: string): x is CommunitySort {
  return (SORTS as readonly string[]).includes(x);
}

export function parseFilters(qs: string): CommunityFilters {
  const sp = new URLSearchParams(qs.startsWith('?') ? qs.slice(1) : qs);
  const rawSort = sp.get('sort');
  const nearby = sp.get('nearby') === 'true';
  const sort: CommunitySort = rawSort && isSort(rawSort)
    ? rawSort
    : (nearby ? 'distance' : 'observation_count');

  const rawCountry = sp.get('country');
  const country = rawCountry && /^[A-Z]{2}$/.test(rawCountry) ? rawCountry : null;

  const taxonStr = sp.get('taxon') ?? '';
  const taxa = taxonStr
    ? taxonStr.split(',').map(s => s.trim()).filter(Boolean)
    : [];

  const experts = sp.get('expert') === 'true';

  const pageRaw = parseInt(sp.get('page') ?? '1', 10);
  const page = Number.isFinite(pageRaw) && pageRaw >= 1 ? pageRaw : 1;

  return { sort, country, taxa, experts, nearby, page };
}

export function serializeFilters(f: CommunityFilters): string {
  const sp = new URLSearchParams();
  if (f.sort !== 'observation_count') sp.set('sort', f.sort);
  if (f.country)                       sp.set('country', f.country);
  if (f.taxa.length > 0)               sp.set('taxon', f.taxa.join(','));
  if (f.experts)                       sp.set('expert', 'true');
  if (f.nearby)                        sp.set('nearby', 'true');
  if (f.page > 1)                      sp.set('page', String(f.page));
  const out = sp.toString();
  return out ? `?${out}` : '';
}
