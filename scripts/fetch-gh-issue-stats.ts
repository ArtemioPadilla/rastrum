#!/usr/bin/env tsx
/**
 * Build-time / nightly fetcher for triage SLA stats.
 *
 * Outputs `public/data/triage-stats.json`. The doc page
 * `/{en,es}/docs/status/` reads it via Node fs at build time.
 *
 * Stats produced:
 *   - open_count            : total open issues right now
 *   - resolved_30d          : issues closed in the last 30 days
 *   - median_first_comment_h: median hours from issue.created_at to the
 *                             first non-author comment, across the last
 *                             30 days of opened issues
 *   - generated_at          : ISO timestamp of this run
 *   - sample_size           : number of issues sampled for the median
 *
 * Auth: relies on the `gh` CLI being authenticated in the calling
 * environment. In GitHub Actions, `${{ secrets.GITHUB_TOKEN }}` is the
 * default and gh picks it up via `GH_TOKEN`/`GITHUB_TOKEN` env vars —
 * we never store a token in the repo or write it to disk.
 *
 * Rate-limit: the script falls back to the previous JSON on error so a
 * transient API hiccup never breaks the build / the site.
 */
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { median, hoursBetween, round1, type TriageStats } from '../src/lib/triage-stats';

const execFileP = promisify(execFile);

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'data');
const OUT_FILE = join(OUT_DIR, 'triage-stats.json');

const REPO = process.env.RASTRUM_REPO || 'ArtemioPadilla/rastrum';
const WINDOW_DAYS = 30;

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

async function ghJson<T>(args: string[]): Promise<T> {
  const { stdout } = await execFileP('gh', args, {
    maxBuffer: 32 * 1024 * 1024,
    env: process.env,
  });
  return JSON.parse(stdout) as T;
}

async function ghApiPaged<T>(path: string): Promise<T[]> {
  return ghJson<T[]>(['api', '--paginate', path]);
}

async function fetchOpenCount(): Promise<number> {
  const data = await ghJson<{ total_count: number }>([
    'api',
    `/search/issues?q=repo:${REPO}+is:issue+is:open&per_page=1`,
  ]);
  return data.total_count;
}

async function fetchClosed30dCount(sinceIso: string): Promise<number> {
  const data = await ghJson<{ total_count: number }>([
    'api',
    `/search/issues?q=${encodeURIComponent(
      `repo:${REPO} is:issue is:closed closed:>=${sinceIso}`,
    )}&per_page=1`,
  ]);
  return data.total_count;
}

async function fetchRecentIssues(sinceIso: string): Promise<IssueListItem[]> {
  // /repos/{owner}/{repo}/issues returns both PRs and issues; we filter
  // PRs out below. `since` is an inclusive timestamp filter (last
  // updated >= sinceIso) which is broader than created — that's fine
  // because we drop anything created before sinceIso below.
  const items = await ghApiPaged<IssueListItem>(
    `/repos/${REPO}/issues?state=all&since=${sinceIso}&per_page=100`,
  );
  return items.filter(
    (i) => !i.pull_request && new Date(i.created_at).toISOString() >= sinceIso,
  );
}

async function firstNonAuthorCommentDelay(
  issue: IssueListItem,
): Promise<number | null> {
  const comments = await ghApiPaged<IssueComment>(
    `/repos/${REPO}/issues/${issue.number}/comments?per_page=100`,
  );
  const authorLogin = issue.user?.login ?? '';
  const first = comments.find((c) => (c.user?.login ?? '') !== authorLogin);
  if (!first) return null;
  return hoursBetween(issue.created_at, first.created_at);
}

function readPrevious(): TriageStats | null {
  if (!existsSync(OUT_FILE)) return null;
  try {
    const raw = readFileSync(OUT_FILE, 'utf8');
    const parsed = JSON.parse(raw) as TriageStats;
    if (typeof parsed.open_count === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const since = new Date(Date.now() - WINDOW_DAYS * 24 * 60 * 60 * 1000);
  const sinceIso = since.toISOString();

  try {
    const [openCount, resolved30d, recent] = await Promise.all([
      fetchOpenCount(),
      fetchClosed30dCount(sinceIso),
      fetchRecentIssues(sinceIso),
    ]);

    const delays: number[] = [];
    // Sequential to be polite to the API; recent windows are small (~25-50
    // issues for this repo) so total time stays under ~30s even at 100 issues.
    for (const issue of recent) {
      const d = await firstNonAuthorCommentDelay(issue);
      if (d !== null) delays.push(d);
    }

    const med = median(delays);

    const stats: TriageStats = {
      generated_at: new Date().toISOString(),
      repo: REPO,
      window_days: WINDOW_DAYS,
      open_count: openCount,
      resolved_30d: resolved30d,
      median_first_comment_h: med === null ? null : round1(med),
      sample_size: delays.length,
    };

    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(stats, null, 2) + '\n', 'utf8');
    console.log(
      `triage-stats: open=${stats.open_count} resolved30d=${stats.resolved_30d} ` +
        `median_h=${stats.median_first_comment_h ?? 'n/a'} (n=${stats.sample_size})`,
    );
  } catch (err) {
    const prev = readPrevious();
    const message = err instanceof Error ? err.message : String(err);
    if (prev) {
      console.warn(
        `triage-stats: gh API failed (${message}); preserving previous JSON dated ${prev.generated_at}`,
      );
      // Nothing to write — leave the existing file in place.
      return;
    }
    console.error(`triage-stats: gh API failed and no previous JSON to fall back on: ${message}`);
    // Emit a zero-valued stub so the build still has something to render.
    const stub: TriageStats = {
      generated_at: new Date().toISOString(),
      repo: REPO,
      window_days: WINDOW_DAYS,
      open_count: 0,
      resolved_30d: 0,
      median_first_comment_h: null,
      sample_size: 0,
    };
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(stub, null, 2) + '\n', 'utf8');
    process.exitCode = 1;
  }
}

main();
