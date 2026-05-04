export type LeaderboardPeriod = '30d' | 'all';

const VALID: readonly LeaderboardPeriod[] = ['30d', 'all'] as const;

export function parseLeaderboardPeriod(input: string | null | undefined): LeaderboardPeriod {
  if (!input) return '30d';
  return (VALID as readonly string[]).includes(input) ? (input as LeaderboardPeriod) : '30d';
}

export function periodFromSearch(search: string): LeaderboardPeriod {
  return parseLeaderboardPeriod(new URLSearchParams(search).get('period'));
}

/**
 * Build the next URL search string for a given period. The default period
 * (`30d`) is rendered as no parameter so the canonical URL stays clean;
 * `all` is opt-in and shows up explicitly.
 */
export function searchForPeriod(currentSearch: string, period: LeaderboardPeriod): string {
  const params = new URLSearchParams(currentSearch);
  if (period === '30d') {
    params.delete('period');
  } else {
    params.set('period', period);
  }
  const out = params.toString();
  return out ? `?${out}` : '';
}
