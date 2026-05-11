/**
 * #725 — Rastrum Wrapped (Principle of Self-Monitoring)
 *
 * Tests for the Wrapped stats generation logic (pure helpers).
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Helpers mirrored from generate-wrapped EF
// ---------------------------------------------------------------------------

function buildSpeciesMap(
  obsData: Array<{ identifications: Array<{ scientific_name: string; is_primary: boolean; taxa: { common_name_es: string | null } | null }> }>,
): Map<string, { count: number; common_name_es: string | null }> {
  const map = new Map<string, { count: number; common_name_es: string | null }>();
  for (const obs of obsData) {
    const primary = obs.identifications.find(i => i.is_primary);
    if (primary?.scientific_name) {
      const existing = map.get(primary.scientific_name) ?? {
        common_name_es: primary.taxa?.common_name_es ?? null,
        count: 0,
      };
      existing.count++;
      map.set(primary.scientific_name, existing);
    }
  }
  return map;
}

function getTopSpecies(
  speciesMap: Map<string, { count: number; common_name_es: string | null }>,
  n = 5,
): Array<{ scientific_name: string; count: number }> {
  return [...speciesMap.entries()]
    .sort((a, b) => b[1].count - a[1].count)
    .slice(0, n)
    .map(([sci, v]) => ({ scientific_name: sci, ...v }));
}

function buildHabitatMap(
  obsData: Array<{ habitat: string | null }>,
): Map<string, number> {
  const map = new Map<string, number>();
  for (const obs of obsData) {
    if (obs.habitat) {
      map.set(obs.habitat, (map.get(obs.habitat) ?? 0) + 1);
    }
  }
  return map;
}

function getPeakHour(obsData: Array<{ observed_at: string }>): number {
  const buckets = new Array<number>(24).fill(0);
  for (const obs of obsData) {
    buckets[new Date(obs.observed_at).getUTCHours()]++;
  }
  return buckets.indexOf(Math.max(...buckets));
}

function isCacheValid(generatedAt: string, ttlMs = 24 * 60 * 60 * 1000): boolean {
  return Date.now() - new Date(generatedAt).getTime() < ttlMs;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Rastrum Wrapped (#725)', () => {
  it('buildSpeciesMap counts primary identifications correctly', () => {
    const obsData = [
      { identifications: [{ scientific_name: 'Quercus robur', is_primary: true, taxa: { common_name_es: 'Roble' } }] },
      { identifications: [{ scientific_name: 'Quercus robur', is_primary: true, taxa: { common_name_es: 'Roble' } }] },
      { identifications: [{ scientific_name: 'Pinus sylvestris', is_primary: true, taxa: { common_name_es: 'Pino' } }] },
    ];
    const map = buildSpeciesMap(obsData);
    expect(map.get('Quercus robur')?.count).toBe(2);
    expect(map.get('Pinus sylvestris')?.count).toBe(1);
  });

  it('getTopSpecies returns top N sorted by count', () => {
    const map = new Map([
      ['A', { count: 3, common_name_es: null }],
      ['B', { count: 10, common_name_es: null }],
      ['C', { count: 1, common_name_es: null }],
    ]);
    const top = getTopSpecies(map, 2);
    expect(top[0].scientific_name).toBe('B');
    expect(top[1].scientific_name).toBe('A');
    expect(top).toHaveLength(2);
  });

  it('buildHabitatMap counts habitats correctly', () => {
    const obsData = [
      { habitat: 'bosque' },
      { habitat: 'bosque' },
      { habitat: 'selva' },
      { habitat: null },
    ];
    const map = buildHabitatMap(obsData);
    expect(map.get('bosque')).toBe(2);
    expect(map.get('selva')).toBe(1);
    expect(map.has('null')).toBe(false);
  });

  it('getPeakHour returns the hour with most observations', () => {
    const obsData = [
      { observed_at: '2026-05-01T06:00:00Z' },
      { observed_at: '2026-05-01T06:30:00Z' },
      { observed_at: '2026-05-01T08:00:00Z' },
    ];
    expect(getPeakHour(obsData)).toBe(6);
  });

  it('isCacheValid returns true for fresh cache (< 24h)', () => {
    const now = new Date().toISOString();
    expect(isCacheValid(now)).toBe(true);
  });

  it('isCacheValid returns false for stale cache (> 24h)', () => {
    const stale = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(isCacheValid(stale)).toBe(false);
  });

  it('EF file exists and references wrapped_cache', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'supabase/functions/generate-wrapped/index.ts'),
      'utf-8',
    );
    expect(src).toContain('wrapped_cache');
    expect(src).toContain('top_species');
    expect(src).toContain('longest_streak_days');
  });

  it('schema contains wrapped_cache table', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'docs/specs/infra/supabase-schema.sql'),
      'utf-8',
    );
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS public.wrapped_cache');
  });

  it('EN wrapped page exists', () => {
    const fs = require('fs');
    const path = require('path');
    expect(fs.existsSync(
      path.join(process.cwd(), 'src/pages/en/profile/wrapped/index.astro'),
    )).toBe(true);
  });

  it('ES wrapped page exists', () => {
    const fs = require('fs');
    const path = require('path');
    expect(fs.existsSync(
      path.join(process.cwd(), 'src/pages/es/perfil/wrapped/index.astro'),
    )).toBe(true);
  });
});
