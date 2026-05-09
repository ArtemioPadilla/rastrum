/**
 * Pure helpers + GitHub API fetcher for the triage SLA dashboard.
 * The math half is unit-tested in isolation; the fetcher half is
 * driven from a build-time script and from tests via a mocked fetch.
 */

export interface TriageStats {
  generated_at: string;
  repo: string;
  window_days: number;
  open_count: number;
  resolved_30d: number;
  median_first_comment_h: number | null;
  sample_size: number;
}

export function median(values: number[]): number | null {
  if (!values.length) return null;
  const sorted = [...values].sort((a, b) => a - b);
  const mid = Math.floor(sorted.length / 2);
  if (sorted.length % 2 === 0) {
    return (sorted[mid - 1] + sorted[mid]) / 2;
  }
  return sorted[mid];
}

export function hoursBetween(createdIso: string, repliedIso: string): number | null {
  const created = new Date(createdIso).getTime();
  const replied = new Date(repliedIso).getTime();
  if (Number.isNaN(created) || Number.isNaN(replied) || replied < created) {
    return null;
  }
  return (replied - created) / (1000 * 60 * 60);
}

export function round1(n: number): number {
  return Math.round(n * 10) / 10;
}

interface IssueListItem {
  number: number;
  user: { login: string } | null;
  created_at: string;
  closed_at: string | null;
  state: 'open' | 'closed';
  pull_request?: unknown;
}

interface IssueComment {
  user: { login: string } | null;
  created_at: string;
}

export type FetchFn = typeof fetch;

interface FetchOptions {
  repo: string;
  token: string;
  windowDays: number;
  /** Inject a custom fetch for tests; defaults to globalThis.fetch. */
  fetchFn?: FetchFn;
  /** Override `now` for deterministic tests. */
  now?: Date;
}

/**
 * Hits the public GitHub REST API to compute triage SLA stats. Pure
 * function (modulo network) — does no I/O of its own. Caller owns the
 * resulting JSON and decides where to write it.
 *
 * Throws on any non-2xx response; let the caller decide whether to
 * fall back to a cached file or surface the error.
 */
export async function computeTriageStats(opts: FetchOptions): Promise<TriageStats> {
  const { repo, token, windowDays } = opts;
  const fetchFn = opts.fetchFn ?? globalThis.fetch;
  const now = opts.now ?? new Date();
  const sinceIso = new Date(now.getTime() - windowDays * 24 * 60 * 60 * 1000).toISOString();

  const headers: Record<string, string> = {
    Accept: 'application/vnd.github+json',
    Authorization: `Bearer ${token}`,
    'User-Agent': 'rastrum-triage-stats',
    'X-GitHub-Api-Version': '2022-11-28',
  };

  async function ghJson<T>(url: string): Promise<T> {
    const r = await fetchFn(url, { headers });
    if (!r.ok) {
      const body = await r.text().catch(() => '');
      throw new Error(`GET ${url} → ${r.status} ${r.statusText}${body ? ': ' + body.slice(0, 200) : ''}`);
    }
    return (await r.json()) as T;
  }

  /** Walks RFC-5988 Link header rels to follow `next` until exhausted. */
  async function ghPaged<T>(initialUrl: string): Promise<T[]> {
    const out: T[] = [];
    let url: string | null = initialUrl;
    while (url) {
      const r = await fetchFn(url, { headers });
      if (!r.ok) {
        const body = await r.text().catch(() => '');
        throw new Error(`GET ${url} → ${r.status} ${r.statusText}${body ? ': ' + body.slice(0, 200) : ''}`);
      }
      const page = (await r.json()) as T[];
      out.push(...page);
      url = parseNextLink(r.headers.get('link'));
    }
    return out;
  }

  const [openSearch, closedSearch, recentRaw] = await Promise.all([
    ghJson<{ total_count: number }>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${repo} is:issue is:open`)}&per_page=1`,
    ),
    ghJson<{ total_count: number }>(
      `https://api.github.com/search/issues?q=${encodeURIComponent(`repo:${repo} is:issue is:closed closed:>=${sinceIso}`)}&per_page=1`,
    ),
    ghPaged<IssueListItem>(
      `https://api.github.com/repos/${repo}/issues?state=all&since=${sinceIso}&per_page=100`,
    ),
  ]);

  const recent = recentRaw.filter(
    (i) => !i.pull_request && new Date(i.created_at).toISOString() >= sinceIso,
  );

  const delays: number[] = [];
  for (const issue of recent) {
    const comments = await ghPaged<IssueComment>(
      `https://api.github.com/repos/${repo}/issues/${issue.number}/comments?per_page=100`,
    );
    const authorLogin = issue.user?.login ?? '';
    // Exclude the issue author AND `*[bot]` accounts (triage automation
    // comments instantly and would skew the SLA toward zero). What we want
    // is "time to first human reply".
    const first = comments.find((c) => {
      const login = c.user?.login ?? '';
      return login !== authorLogin && !login.endsWith('[bot]');
    });
    if (!first) continue;
    const d = hoursBetween(issue.created_at, first.created_at);
    if (d !== null) delays.push(d);
  }

  const med = median(delays);

  return {
    generated_at: now.toISOString(),
    repo,
    window_days: windowDays,
    open_count: openSearch.total_count,
    resolved_30d: closedSearch.total_count,
    median_first_comment_h: med === null ? null : round1(med),
    sample_size: delays.length,
  };
}

/**
 * Detect the all-zeros placeholder shape the doc page renders as
 * "data unavailable". Used by both the page and the build script
 * so the predicate stays in one place.
 */
export function isPlaceholderStats(s: TriageStats): boolean {
  if (s.generated_at.startsWith('1970-')) return true;
  return s.sample_size === 0 && s.open_count === 0 && s.resolved_30d === 0;
}

function parseNextLink(header: string | null): string | null {
  if (!header) return null;
  for (const part of header.split(',')) {
    const m = part.match(/<([^>]+)>;\s*rel="next"/);
    if (m) return m[1];
  }
  return null;
}
