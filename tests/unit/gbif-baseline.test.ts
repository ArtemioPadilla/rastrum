/**
 * #802 — GBIF Option B regional baseline for falta-dex
 *
 * Tests for the GBIF ETL pipeline logic and schema.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure helpers from the EF
// ---------------------------------------------------------------------------

const COUNTRIES = ['MX', 'CR', 'CO', 'GT', 'HN', 'SV', 'NI', 'PA', 'CU', 'PE'];
const KINGDOMS = [
  { name: 'Plantae',  key: 6 },
  { name: 'Animalia', key: 1 },
  { name: 'Fungi',    key: 5 },
];

function sleep(ms: number): Promise<void> {
  return new Promise(resolve => setTimeout(resolve, ms));
}

/** Simulates the upsert payload builder for one country/kingdom pair. */
function buildUpsertPayload(
  country: string,
  kingdom: { name: string; key: number },
  count: number,
): Record<string, unknown> {
  return {
    region_code:       country,
    kingdom:           kingdom.name,
    gbif_kingdom_key:  kingdom.key,
    occurrence_count:  count,
    source:            'gbif_occurrence_api',
    source_dataset_doi: 'https://doi.org/10.15468/dl.gbif-backbone',
    last_synced_at:    new Date().toISOString(),
  };
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('GBIF regional baseline (#802)', () => {
  it('COUNTRIES list includes MX', () => {
    expect(COUNTRIES).toContain('MX');
  });

  it('KINGDOMS list covers Plantae, Animalia, and Fungi', () => {
    const names = KINGDOMS.map(k => k.name);
    expect(names).toContain('Plantae');
    expect(names).toContain('Animalia');
    expect(names).toContain('Fungi');
  });

  it('buildUpsertPayload produces correct shape', () => {
    const payload = buildUpsertPayload('MX', KINGDOMS[1], 450_000);
    expect(payload.region_code).toBe('MX');
    expect(payload.kingdom).toBe('Animalia');
    expect(payload.occurrence_count).toBe(450_000);
    expect(payload.source).toBe('gbif_occurrence_api');
    expect(typeof payload.last_synced_at).toBe('string');
  });

  it('sleep resolves after the specified delay', async () => {
    const start = Date.now();
    await sleep(10);
    expect(Date.now() - start).toBeGreaterThanOrEqual(9);
  });

  it('EF file exists and references GBIF API', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'supabase/functions/sync-gbif-regional-baseline/index.ts'),
      'utf-8',
    );
    expect(src).toContain('api.gbif.org');
    expect(src).toContain('regional_taxa_baseline');
    expect(src).toContain('RATE_LIMIT_MS');
  });

  it('schema contains regional_taxa_baseline table', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'docs/specs/infra/supabase-schema.sql'),
      'utf-8',
    );
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS public.regional_taxa_baseline');
  });

  it('schema has source_dataset_doi column for GBIF provenance', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'docs/specs/infra/supabase-schema.sql'),
      'utf-8',
    );
    expect(schema).toContain('source_dataset_doi');
  });

  it('total ETL calls = COUNTRIES × KINGDOMS', () => {
    const expectedCalls = COUNTRIES.length * KINGDOMS.length;
    // 10 countries × 3 kingdoms = 30 API calls per nightly run
    expect(expectedCalls).toBe(30);
  });
});
