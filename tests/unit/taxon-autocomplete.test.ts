/**
 * Unit tests for taxon-autocomplete — issue #617
 */
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import { suggestTaxa, clearTaxonCache } from '../../src/lib/taxon-autocomplete';

// ── Mock fetch ────────────────────────────────────────────────────────────────
const originalFetch = global.fetch;

function mockFetch(gbifItems: any[] = []) {
  global.fetch = vi.fn().mockResolvedValue({
    ok: true,
    json: async () => gbifItems,
  } as Response);
}

// ── Mock Supabase ─────────────────────────────────────────────────────────────
vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => ({
      select: () => ({
        ilike: (_col: string, _pat: string) => ({
          order: () => ({
            limit: () =>
              Promise.resolve({
                data: [
                  {
                    scientific_name: 'Alamania punicea',
                    common_name_es: 'Orquídea de agave',
                    common_name_en: null,
                    observation_count: 12,
                  },
                ],
                error: null,
              }),
          }),
        }),
      }),
    }),
  }),
}));

// ─────────────────────────────────────────────────────────────────────────────

describe('suggestTaxa', () => {
  beforeEach(() => {
    clearTaxonCache();
    vi.useFakeTimers();
  });

  afterEach(() => {
    global.fetch = originalFetch;
    vi.useRealTimers();
  });

  it('returns empty array for queries shorter than 2 chars', () => {
    const onResults = vi.fn();
    suggestTaxa('A', 'es', onResults);
    vi.runAllTimers();
    expect(onResults).toHaveBeenCalledWith([]);
  });

  it('debounces — only fires once after 300ms idle', async () => {
    mockFetch([]);
    const onResults = vi.fn();

    suggestTaxa('Al', 'es', onResults);
    suggestTaxa('Ala', 'es', onResults);
    suggestTaxa('Alam', 'es', onResults);

    await vi.runAllTimersAsync();
    // Should have been called once after last query settles
    // (the first two calls were cancelled by debounce)
    expect(onResults).toHaveBeenCalledTimes(1);
  });

  it('includes Rastrum taxa in results', async () => {
    mockFetch([]); // GBIF returns nothing
    const onResults = vi.fn();

    suggestTaxa('Alamania', 'es', onResults);
    await vi.runAllTimersAsync();

    const calls = onResults.mock.calls;
    expect(calls.length).toBeGreaterThan(0);
    const results = calls[calls.length - 1][0];
    const rastrumHit = results.find(
      (r: any) => r.scientificName === 'Alamania punicea' && r.source === 'rastrum'
    );
    expect(rastrumHit).toBeDefined();
    expect(rastrumHit.commonNameEs).toBe('Orquídea de agave');
    expect(rastrumHit.observationCount).toBe(12);
  });

  it('merges GBIF results without duplicating Rastrum hits', async () => {
    mockFetch([
      { scientificName: 'Alamania punicea', canonicalName: 'Alamania punicea', rank: 'SPECIES' },
      { scientificName: 'Alangium chinense', canonicalName: 'Alangium chinense', rank: 'SPECIES' },
    ]);

    const onResults = vi.fn();
    suggestTaxa('Alam', 'es', onResults);
    await vi.runAllTimersAsync();

    const results = onResults.mock.calls.at(-1)![0] as any[];
    const names = results.map((r: any) => r.scientificName);

    // Rastrum hit should appear once
    expect(names.filter((n: string) => n === 'Alamania punicea').length).toBe(1);
    // GBIF-only hit present
    expect(names).toContain('Alangium chinense');
  });

  it('returns cancel function that prevents stale results from appearing', async () => {
    mockFetch([]);
    const onResults = vi.fn();

    const cancel = suggestTaxa('Alamania', 'es', onResults);
    cancel();
    await vi.runAllTimersAsync();

    expect(onResults).not.toHaveBeenCalledWith(expect.any(Array));
  });

  it('caches results for the same query', async () => {
    mockFetch([]);
    const onResults = vi.fn();

    suggestTaxa('Alam', 'es', onResults);
    await vi.runAllTimersAsync();

    suggestTaxa('Alam', 'es', onResults);
    await vi.runAllTimersAsync();

    // fetch should only have been called once (second call hits cache)
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });

  it('caps results at 8', async () => {
    const manyGBIF = Array.from({ length: 20 }, (_, i) => ({
      scientificName: `Species${i} test`,
      canonicalName: `Species${i} test`,
      rank: 'SPECIES',
    }));
    mockFetch(manyGBIF);

    const onResults = vi.fn();
    suggestTaxa('Species', 'es', onResults);
    await vi.runAllTimersAsync();

    const results = onResults.mock.calls.at(-1)![0];
    expect(results.length).toBeLessThanOrEqual(8);
  });
});
