export type LeaderboardPeriod = '30d' | 'all';
export type LeaderboardView = LeaderboardPeriod | 'experts';

const VALID_VIEWS: readonly LeaderboardView[] = ['30d', 'all', 'experts'] as const;

export function parseLeaderboardPeriod(input: string | null | undefined): LeaderboardPeriod {
  if (input === 'all') return 'all';
  return '30d';
}

export function parseLeaderboardView(input: string | null | undefined): LeaderboardView {
  if (!input) return '30d';
  return (VALID_VIEWS as readonly string[]).includes(input) ? (input as LeaderboardView) : '30d';
}

export function periodFromSearch(search: string): LeaderboardPeriod {
  const v = viewFromSearch(search);
  return v === 'all' ? 'all' : '30d';
}

export function viewFromSearch(search: string): LeaderboardView {
  const params = new URLSearchParams(search);
  if (params.get('view') === 'experts') return 'experts';
  return parseLeaderboardPeriod(params.get('period'));
}

/**
 * Build the next URL search string for a given period. The default period
 * (`30d`) is rendered as no parameter so the canonical URL stays clean;
 * `all` is opt-in and shows up explicitly. Preserves any other params
 * (e.g. `region`, `taxon`).
 */
export function searchForPeriod(currentSearch: string, period: LeaderboardPeriod): string {
  const params = new URLSearchParams(currentSearch);
  params.delete('view');
  params.delete('taxon');
  if (period === '30d') {
    params.delete('period');
  } else {
    params.set('period', period);
  }
  return serialize(params);
}

export function searchForView(currentSearch: string, view: LeaderboardView): string {
  const params = new URLSearchParams(currentSearch);
  if (view === 'experts') {
    params.set('view', 'experts');
    params.delete('period');
  } else {
    params.delete('view');
    params.delete('taxon');
    if (view === '30d') {
      params.delete('period');
    } else {
      params.set('period', view);
    }
  }
  return serialize(params);
}

export function regionFromSearch(search: string): string {
  const v = (new URLSearchParams(search).get('region') ?? '').toUpperCase();
  return /^[A-Z]{2}$/.test(v) ? v : '';
}

export function searchForRegion(currentSearch: string, region: string): string {
  const params = new URLSearchParams(currentSearch);
  const trimmed = region.trim().toUpperCase();
  if (trimmed && /^[A-Z]{2}$/.test(trimmed)) {
    params.set('region', trimmed);
  } else {
    params.delete('region');
  }
  return serialize(params);
}

export function taxonFromSearch(search: string): string {
  const v = new URLSearchParams(search).get('taxon') ?? '';
  return /^[0-9a-f-]{36}$/i.test(v) ? v : '';
}

export function searchForTaxon(currentSearch: string, taxonId: string): string {
  const params = new URLSearchParams(currentSearch);
  if (taxonId && /^[0-9a-f-]{36}$/i.test(taxonId)) {
    params.set('taxon', taxonId);
  } else {
    params.delete('taxon');
  }
  return serialize(params);
}

function serialize(params: URLSearchParams): string {
  const out = params.toString();
  return out ? `?${out}` : '';
}
