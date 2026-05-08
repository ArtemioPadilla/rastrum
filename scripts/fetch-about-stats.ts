#!/usr/bin/env tsx
/**
 * Build-time fetcher for the About page "En cifras hoy" section.
 *
 * Outputs `public/data/about-stats.json`. The shared component
 * `src/components/AboutView.astro` reads it via Node fs at build time
 * (Astro frontmatter runs in Node during static build).
 *
 * Stats produced:
 *   - total_observations : non-deleted observation rows visible to anon
 *   - total_observers    : rows in community_observers (public profiles)
 *   - total_species      : distinct primary_taxon_id over public obs
 *   - generated_at       : ISO timestamp of this run
 *
 * Auth: uses the publishable anon key (`PUBLIC_SUPABASE_ANON_KEY`) so
 * RLS-gated counts are what an anonymous visitor would see. Falls back
 * to a placeholder JSON if Supabase env is missing or unreachable, so
 * the build never breaks on a transient network hiccup or a fresh
 * checkout without env vars.
 */
import { writeFileSync, mkdirSync, readFileSync, existsSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = join(__dirname, '..');
const OUT_DIR = join(ROOT, 'public', 'data');
const OUT_FILE = join(OUT_DIR, 'about-stats.json');

interface AboutStats {
  total_observations: number | null;
  total_observers: number | null;
  total_species: number | null;
  generated_at: string;
  available: boolean;
}

const PLACEHOLDER: AboutStats = {
  total_observations: null,
  total_observers: null,
  total_species: null,
  generated_at: new Date().toISOString(),
  available: false,
};

function previousOrPlaceholder(): AboutStats {
  if (existsSync(OUT_FILE)) {
    try {
      return JSON.parse(readFileSync(OUT_FILE, 'utf-8')) as AboutStats;
    } catch {
      // fall through
    }
  }
  return PLACEHOLDER;
}

async function exactCount(
  url: string,
  key: string,
  resource: string,
): Promise<number | null> {
  try {
    const res = await fetch(`${url.replace(/\/$/, '')}/rest/v1/${resource}`, {
      method: 'HEAD',
      headers: {
        apikey: key,
        Authorization: `Bearer ${key}`,
        Prefer: 'count=exact',
        Range: '0-0',
      },
    });
    if (!res.ok && res.status !== 206) return null;
    const cr = res.headers.get('content-range');
    if (!cr) return null;
    const match = cr.match(/\/(\d+|\*)$/);
    if (!match || match[1] === '*') return null;
    return Number.parseInt(match[1], 10);
  } catch {
    return null;
  }
}

async function distinctSpeciesCount(url: string, key: string): Promise<number | null> {
  try {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/observations?select=primary_taxon_id&primary_taxon_id=not.is.null&limit=10000`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      },
    );
    if (!res.ok) return null;
    const rows = (await res.json()) as Array<{ primary_taxon_id: string | null }>;
    const set = new Set<string>();
    for (const row of rows) {
      if (row.primary_taxon_id) set.add(row.primary_taxon_id);
    }
    return set.size;
  } catch {
    return null;
  }
}

async function main() {
  mkdirSync(OUT_DIR, { recursive: true });

  const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_ANON_KEY || process.env.PUBLIC_SUPABASE_ANON_KEY;

  if (!url || !key) {
    console.warn('[about-stats] SUPABASE env not set — writing placeholder');
    const fallback = previousOrPlaceholder();
    writeFileSync(OUT_FILE, JSON.stringify(fallback, null, 2));
    return;
  }

  const [obsCount, observerCount, speciesCount] = await Promise.all([
    exactCount(url, key, 'observations?select=id&deleted_at=is.null'),
    exactCount(url, key, 'community_observers?select=user_id'),
    distinctSpeciesCount(url, key),
  ]);

  const stats: AboutStats = {
    total_observations: obsCount,
    total_observers: observerCount,
    total_species: speciesCount,
    generated_at: new Date().toISOString(),
    available:
      obsCount !== null || observerCount !== null || speciesCount !== null,
  };

  writeFileSync(OUT_FILE, JSON.stringify(stats, null, 2));
  console.log(
    `[about-stats] obs=${obsCount} observers=${observerCount} species=${speciesCount}`,
  );
}

main().catch((err) => {
  console.error('[about-stats] error', err);
  const fallback = previousOrPlaceholder();
  mkdirSync(OUT_DIR, { recursive: true });
  writeFileSync(OUT_FILE, JSON.stringify(fallback, null, 2));
});
