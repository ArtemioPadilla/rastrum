import { describe, it, expect } from 'vitest';
import {
  parseLeaderboardPeriod,
  periodFromSearch,
  searchForPeriod,
  parseLeaderboardWindow,
  parseLeaderboardScope,
  windowFromSearch,
  scopeFromSearch,
  searchForWindow,
  searchForScope,
  DEFAULT_WINDOW,
  DEFAULT_SCOPE,
} from '../../src/lib/leaderboard-url';

describe('parseLeaderboardPeriod', () => {
  it('defaults to 30d when input is missing', () => {
    expect(parseLeaderboardPeriod(null)).toBe('30d');
    expect(parseLeaderboardPeriod(undefined)).toBe('30d');
    expect(parseLeaderboardPeriod('')).toBe('30d');
  });

  it('passes through valid periods', () => {
    expect(parseLeaderboardPeriod('30d')).toBe('30d');
    expect(parseLeaderboardPeriod('all')).toBe('all');
  });

  it('falls back to 30d on garbage input', () => {
    expect(parseLeaderboardPeriod('weekly')).toBe('30d');
    expect(parseLeaderboardPeriod('30D')).toBe('30d');
  });
});

describe('periodFromSearch', () => {
  it('reads from a search string with leading ?', () => {
    expect(periodFromSearch('?period=all')).toBe('all');
    expect(periodFromSearch('?period=30d')).toBe('30d');
  });

  it('returns 30d when no param is present', () => {
    expect(periodFromSearch('')).toBe('30d');
    expect(periodFromSearch('?other=1')).toBe('30d');
  });
});

describe('searchForPeriod', () => {
  it('drops the param entirely for the default 30d', () => {
    expect(searchForPeriod('?period=all', '30d')).toBe('');
    expect(searchForPeriod('', '30d')).toBe('');
  });

  it('sets the param for non-default periods', () => {
    expect(searchForPeriod('', 'all')).toBe('?period=all');
    expect(searchForPeriod('?period=30d', 'all')).toBe('?period=all');
  });

  it('preserves unrelated params', () => {
    expect(searchForPeriod('?foo=bar', 'all')).toBe('?foo=bar&period=all');
    expect(searchForPeriod('?period=all&foo=bar', '30d')).toBe('?foo=bar');
  });

  it('round-trips period across reload (parse → serialise → parse)', () => {
    const search = searchForPeriod('', 'all');
    expect(periodFromSearch(search)).toBe('all');

    const reset = searchForPeriod(search, '30d');
    expect(periodFromSearch(reset)).toBe('30d');
  });
});

describe('parseLeaderboardWindow', () => {
  it('defaults to month when input is missing', () => {
    expect(parseLeaderboardWindow(null)).toBe('month');
    expect(parseLeaderboardWindow(undefined)).toBe('month');
    expect(parseLeaderboardWindow('')).toBe('month');
  });

  it('passes through valid windows', () => {
    expect(parseLeaderboardWindow('today')).toBe('today');
    expect(parseLeaderboardWindow('week')).toBe('week');
    expect(parseLeaderboardWindow('month')).toBe('month');
    expect(parseLeaderboardWindow('all')).toBe('all');
  });

  it('falls back to month on garbage input', () => {
    expect(parseLeaderboardWindow('weekly')).toBe('month');
    expect(parseLeaderboardWindow('TODAY')).toBe('month');
  });
});

describe('parseLeaderboardScope', () => {
  it('defaults to global when input is missing or invalid', () => {
    expect(parseLeaderboardScope(null)).toBe('global');
    expect(parseLeaderboardScope('')).toBe('global');
    expect(parseLeaderboardScope('strangers')).toBe('global');
  });

  it('passes through valid scopes', () => {
    expect(parseLeaderboardScope('global')).toBe('global');
    expect(parseLeaderboardScope('friends')).toBe('friends');
  });
});

describe('windowFromSearch + searchForWindow', () => {
  it('reads from a search string', () => {
    expect(windowFromSearch('?window=today')).toBe('today');
    expect(windowFromSearch('?window=week')).toBe('week');
    expect(windowFromSearch('?window=all')).toBe('all');
    expect(windowFromSearch('')).toBe(DEFAULT_WINDOW);
  });

  it('drops the param entirely for the default window', () => {
    expect(searchForWindow('?window=today', 'month')).toBe('');
    expect(searchForWindow('', 'month')).toBe('');
  });

  it('sets the param for non-default windows', () => {
    expect(searchForWindow('', 'today')).toBe('?window=today');
    expect(searchForWindow('?window=week', 'today')).toBe('?window=today');
  });

  it('preserves unrelated params', () => {
    expect(searchForWindow('?foo=bar', 'today')).toBe('?foo=bar&window=today');
    expect(searchForWindow('?window=today&foo=bar', 'month')).toBe('?foo=bar');
  });

  it('round-trips across reload', () => {
    const s = searchForWindow('', 'week');
    expect(windowFromSearch(s)).toBe('week');
    const reset = searchForWindow(s, 'month');
    expect(windowFromSearch(reset)).toBe('month');
  });
});

describe('scopeFromSearch + searchForScope', () => {
  it('reads from a search string', () => {
    expect(scopeFromSearch('?scope=friends')).toBe('friends');
    expect(scopeFromSearch('?scope=global')).toBe('global');
    expect(scopeFromSearch('')).toBe(DEFAULT_SCOPE);
  });

  it('drops the param entirely for the default scope', () => {
    expect(searchForScope('?scope=friends', 'global')).toBe('');
    expect(searchForScope('', 'global')).toBe('');
  });

  it('sets the param for friends scope', () => {
    expect(searchForScope('', 'friends')).toBe('?scope=friends');
  });

  it('composes with window without collision', () => {
    let s = searchForWindow('', 'today');
    s = searchForScope(s, 'friends');
    expect(windowFromSearch(s)).toBe('today');
    expect(scopeFromSearch(s)).toBe('friends');
  });
});
