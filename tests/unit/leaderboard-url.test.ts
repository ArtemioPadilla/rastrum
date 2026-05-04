import { describe, it, expect } from 'vitest';
import {
  parseLeaderboardPeriod,
  periodFromSearch,
  searchForPeriod,
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
