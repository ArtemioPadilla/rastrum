/**
 * Tests for the GitHub-API-fetching half of the triage SLA library.
 * The pure helpers are covered in triage-stats.test.ts; this file
 * exercises `computeTriageStats` end-to-end with a mocked fetch and
 * `isPlaceholderStats` against shapes the page actually sees.
 */
import { describe, it, expect } from 'vitest';
import {
  computeTriageStats,
  isPlaceholderStats,
  type FetchFn,
  type TriageStats,
} from '../../src/lib/triage-stats';

const NOW = new Date('2026-05-09T00:00:00.000Z');
const SINCE_ISO = new Date(NOW.getTime() - 30 * 24 * 60 * 60 * 1000).toISOString();

interface FakeRoute {
  /** Substring matched against the request URL. */
  match: string;
  body: unknown;
  /** Optional Link header for paginated responses. */
  link?: string;
  status?: number;
  statusText?: string;
}

function fakeFetch(routes: FakeRoute[]): { fetchFn: FetchFn; calls: string[] } {
  const calls: string[] = [];
  const fetchFn: FetchFn = async (input) => {
    const url = typeof input === 'string' ? input : input instanceof URL ? input.href : input.url;
    calls.push(url);
    const route = routes.find((r) => url.includes(r.match));
    if (!route) {
      return new Response('no fake route for ' + url, { status: 599, statusText: 'Unrouted' }) as Response;
    }
    const headers = new Headers({ 'content-type': 'application/json' });
    if (route.link) headers.set('link', route.link);
    return new Response(JSON.stringify(route.body), {
      status: route.status ?? 200,
      statusText: route.statusText ?? 'OK',
      headers,
    }) as Response;
  };
  return { fetchFn, calls };
}

describe('computeTriageStats', () => {
  it('returns counts + median from a single-issue happy path', async () => {
    const { fetchFn } = fakeFetch([
      { match: '/search/issues?q=' + encodeURIComponent('repo:owner/r is:issue is:open'), body: { total_count: 7 } },
      { match: 'is%3Aclosed', body: { total_count: 12 } },
      {
        match: `/repos/owner/r/issues?state=all&since=${SINCE_ISO}`,
        body: [
          {
            number: 1,
            user: { login: 'reporter' },
            created_at: '2026-05-01T00:00:00Z',
            closed_at: null,
            state: 'open',
          },
        ],
      },
      {
        match: '/repos/owner/r/issues/1/comments',
        body: [
          { user: { login: 'reporter' }, created_at: '2026-05-01T01:00:00Z' }, // author — ignored
          { user: { login: 'maintainer' }, created_at: '2026-05-01T02:00:00Z' }, // first human, +2h
        ],
      },
    ]);

    const stats = await computeTriageStats({
      repo: 'owner/r',
      token: 'fake',
      windowDays: 30,
      fetchFn,
      now: NOW,
    });

    expect(stats.open_count).toBe(7);
    expect(stats.resolved_30d).toBe(12);
    expect(stats.sample_size).toBe(1);
    expect(stats.median_first_comment_h).toBe(2);
    expect(stats.repo).toBe('owner/r');
    expect(stats.window_days).toBe(30);
    expect(stats.generated_at).toBe(NOW.toISOString());
  });

  it('excludes [bot] accounts from "first reply"', async () => {
    const { fetchFn } = fakeFetch([
      { match: '/search/issues?q=' + encodeURIComponent('repo:owner/r is:issue is:open'), body: { total_count: 0 } },
      { match: 'is%3Aclosed', body: { total_count: 0 } },
      {
        match: `/repos/owner/r/issues?state=all&since=${SINCE_ISO}`,
        body: [
          {
            number: 42,
            user: { login: 'reporter' },
            created_at: '2026-05-01T00:00:00Z',
            closed_at: null,
            state: 'open',
          },
        ],
      },
      {
        match: '/repos/owner/r/issues/42/comments',
        body: [
          { user: { login: 'github-actions[bot]' }, created_at: '2026-05-01T00:00:30Z' }, // bot — ignored
          { user: { login: 'triage-bot[bot]' }, created_at: '2026-05-01T00:01:00Z' }, // bot — ignored
          { user: { login: 'maintainer' }, created_at: '2026-05-01T05:00:00Z' }, // first human, +5h
        ],
      },
    ]);

    const stats = await computeTriageStats({
      repo: 'owner/r',
      token: 'fake',
      windowDays: 30,
      fetchFn,
      now: NOW,
    });

    expect(stats.median_first_comment_h).toBe(5);
    expect(stats.sample_size).toBe(1);
  });

  it('skips PRs and issues created before the window', async () => {
    const { fetchFn } = fakeFetch([
      { match: '/search/issues?q=' + encodeURIComponent('repo:owner/r is:issue is:open'), body: { total_count: 0 } },
      { match: 'is%3Aclosed', body: { total_count: 0 } },
      {
        match: `/repos/owner/r/issues?state=all&since=${SINCE_ISO}`,
        body: [
          {
            number: 1,
            user: { login: 'a' },
            created_at: '2026-05-01T00:00:00Z',
            closed_at: null,
            state: 'open',
            pull_request: { url: 'pr-shape' }, // PR — must be excluded
          },
          {
            number: 2,
            user: { login: 'a' },
            created_at: '2025-01-01T00:00:00Z', // before since — excluded
            closed_at: null,
            state: 'open',
          },
        ],
      },
    ]);

    const stats = await computeTriageStats({
      repo: 'owner/r',
      token: 'fake',
      windowDays: 30,
      fetchFn,
      now: NOW,
    });

    expect(stats.sample_size).toBe(0);
    expect(stats.median_first_comment_h).toBeNull();
  });

  it('raises on a non-2xx response', async () => {
    const { fetchFn } = fakeFetch([
      {
        match: '/search/issues',
        body: { message: 'Bad credentials' },
        status: 401,
        statusText: 'Unauthorized',
      },
    ]);

    await expect(
      computeTriageStats({ repo: 'owner/r', token: 'bad', windowDays: 30, fetchFn, now: NOW }),
    ).rejects.toThrow(/401/);
  });

  it('follows the Link: rel="next" header for paginated comments', async () => {
    const nextUrl = 'https://api.github.com/repos/owner/r/issues/1/comments?per_page=100&page=2';
    // `routes.find()` returns the first match, so list specific matchers first.
    const { fetchFn, calls } = fakeFetch([
      {
        match: 'page=2',
        body: [{ user: { login: 'maintainer' }, created_at: '2026-05-01T03:00:00Z' }],
      },
      {
        match: '/repos/owner/r/issues/1/comments?per_page=100',
        body: [{ user: { login: 'reporter' }, created_at: '2026-05-01T00:30:00Z' }],
        link: `<${nextUrl}>; rel="next"`,
      },
      { match: '/search/issues?q=' + encodeURIComponent('repo:owner/r is:issue is:open'), body: { total_count: 0 } },
      { match: 'is%3Aclosed', body: { total_count: 0 } },
      {
        match: `/repos/owner/r/issues?state=all&since=${SINCE_ISO}`,
        body: [
          {
            number: 1,
            user: { login: 'reporter' },
            created_at: '2026-05-01T00:00:00Z',
            closed_at: null,
            state: 'open',
          },
        ],
      },
    ]);

    const stats = await computeTriageStats({
      repo: 'owner/r',
      token: 'fake',
      windowDays: 30,
      fetchFn,
      now: NOW,
    });

    expect(stats.median_first_comment_h).toBe(3);
    expect(calls.some((u) => u.includes('page=2'))).toBe(true);
  });
});

describe('isPlaceholderStats', () => {
  const real: TriageStats = {
    generated_at: '2026-05-09T04:00:00.000Z',
    repo: 'owner/r',
    window_days: 30,
    open_count: 113,
    resolved_30d: 217,
    median_first_comment_h: 0.3,
    sample_size: 14,
  };

  it('detects 1970 sentinel as placeholder', () => {
    expect(isPlaceholderStats({ ...real, generated_at: '1970-01-01T00:00:00.000Z' })).toBe(true);
  });

  it('detects all-zeros stub as placeholder', () => {
    expect(
      isPlaceholderStats({
        ...real,
        open_count: 0,
        resolved_30d: 0,
        sample_size: 0,
      }),
    ).toBe(true);
  });

  it('does not flag real data with zero open issues if other fields are populated', () => {
    expect(isPlaceholderStats({ ...real, open_count: 0 })).toBe(false);
  });

  it('does not flag genuine data', () => {
    expect(isPlaceholderStats(real)).toBe(false);
  });
});
