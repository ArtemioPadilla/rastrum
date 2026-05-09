#!/usr/bin/env tsx
/**
 * Build-time fetcher for triage SLA stats. Writes
 * `public/data/triage-stats.json`, consumed at Astro build time by
 * `src/components/TriageStatusView.astro`.
 *
 * Auth: reads `GITHUB_TOKEN` (Actions default) or `GH_TOKEN` (gh CLI
 * convention). When neither is set — typical for local dev — the
 * script no-ops and leaves the existing JSON in place, so builds
 * without a token use the committed cache.
 *
 * Failure mode: on any API error, preserve the previous JSON. Never
 * fail the build for triage data.
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { computeTriageStats, type TriageStats } from '../src/lib/triage-stats';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'data');
const OUT_FILE = join(OUT_DIR, 'triage-stats.json');

const REPO = process.env.RASTRUM_REPO || 'ArtemioPadilla/rastrum';
const WINDOW_DAYS = 30;

function readPrevious(): TriageStats | null {
  if (!existsSync(OUT_FILE)) return null;
  try {
    const parsed = JSON.parse(readFileSync(OUT_FILE, 'utf8')) as TriageStats;
    if (typeof parsed.open_count === 'number') return parsed;
    return null;
  } catch {
    return null;
  }
}

async function main(): Promise<void> {
  const token = process.env.GITHUB_TOKEN || process.env.GH_TOKEN;
  if (!token) {
    const prev = readPrevious();
    if (prev) {
      console.log(
        `triage-stats: no GITHUB_TOKEN; keeping cached JSON dated ${prev.generated_at}`,
      );
    } else {
      console.log('triage-stats: no GITHUB_TOKEN and no cache — skipping.');
    }
    return;
  }

  try {
    const stats = await computeTriageStats({ repo: REPO, token, windowDays: WINDOW_DAYS });
    mkdirSync(OUT_DIR, { recursive: true });
    writeFileSync(OUT_FILE, JSON.stringify(stats, null, 2) + '\n', 'utf8');
    console.log(
      `triage-stats: open=${stats.open_count} resolved30d=${stats.resolved_30d} ` +
        `median_h=${stats.median_first_comment_h ?? 'n/a'} (n=${stats.sample_size})`,
    );
  } catch (err) {
    const message = err instanceof Error ? err.message : String(err);
    const prev = readPrevious();
    if (prev) {
      console.warn(
        `triage-stats: API failed (${message}); preserving cached JSON dated ${prev.generated_at}`,
      );
      return;
    }
    console.warn(`triage-stats: API failed and no cache to fall back on: ${message}`);
    // Don't fail the build — the page renders an "unavailable" state for missing/placeholder data.
  }
}

main().catch((err) => {
  console.warn(`triage-stats: unexpected error: ${err instanceof Error ? err.message : String(err)}`);
});
