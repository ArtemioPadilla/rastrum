import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  },
  writable: true,
  configurable: true,
});

interface SupabaseStubBuilder {
  select: (cols?: string) => SupabaseStubBuilder;
  in: (col: string, vals: string[]) => SupabaseStubBuilder;
  eq: (col: string, val: string) => SupabaseStubBuilder;
  maybeSingle: () => Promise<{ data: unknown; error: null }>;
  then: (onFulfilled: (v: { data: unknown; error: null }) => unknown) => Promise<unknown>;
}

let cascadeConfigRows: Array<{ key: string; value: number }> = [];
let pairRow: { prompt_en: string; prompt_es: string } | null = null;
const invokeMock = vi.fn();

vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    from: (table: string) => {
      const builder: SupabaseStubBuilder = {
        select: () => builder,
        in: () => Promise.resolve({ data: cascadeConfigRows, error: null }) as unknown as SupabaseStubBuilder,
        eq: () => builder,
        maybeSingle: async () => ({
          data: table === 'taxon_pair_disambiguations' ? pairRow : null,
          error: null,
        }),
        then: (onFulfilled) => Promise.resolve({ data: cascadeConfigRows, error: null }).then(onFulfilled),
      };
      return builder;
    },
    functions: {
      invoke: (...args: unknown[]) => invokeMock(...args),
    },
  }),
}));

import {
  shouldDisambiguate,
  canonicalPair,
  loadThresholds,
  fetchDisambiguationPrompt,
  _resetThresholdsCacheForTests,
  DEFAULT_GAP_THRESHOLD,
  DEFAULT_MIN_CONFIDENCE,
} from '../../src/lib/disambiguation';

describe('shouldDisambiguate — gap rule (#615)', () => {
  it('triggers when gap < 0.15 and both > 0.30', () => {
    const verdict = shouldDisambiguate(
      { scientific_name: 'Salvia mexicana', confidence: 0.55 },
      [{ scientific_name: 'Salvia elegans', confidence: 0.45 }],
    );
    expect(verdict.trigger).toBe(true);
    expect(verdict.top1?.scientific_name).toBe('Salvia mexicana');
    expect(verdict.top2?.scientific_name).toBe('Salvia elegans');
  });

  it('does not trigger when gap is wide', () => {
    const verdict = shouldDisambiguate(
      { scientific_name: 'A', confidence: 0.9 },
      [{ scientific_name: 'B', confidence: 0.4 }],
    );
    expect(verdict.trigger).toBe(false);
    expect(verdict.reason).toBe('gap_too_wide');
  });

  it('does not trigger when both are below the floor', () => {
    const verdict = shouldDisambiguate(
      { scientific_name: 'A', confidence: 0.25 },
      [{ scientific_name: 'B', confidence: 0.20 }],
    );
    expect(verdict.trigger).toBe(false);
    expect(verdict.reason).toBe('below_floor');
  });

  it('does not trigger when there are no alternates', () => {
    const verdict = shouldDisambiguate(
      { scientific_name: 'A', confidence: 0.9 },
      [],
    );
    expect(verdict.trigger).toBe(false);
    expect(verdict.reason).toBe('no_alternates');
  });

  it('skips alternates with the same scientific name as best', () => {
    const verdict = shouldDisambiguate(
      { scientific_name: 'Salvia mexicana', confidence: 0.55 },
      [
        { scientific_name: 'Salvia mexicana', confidence: 0.50 },
        { scientific_name: 'Salvia elegans', confidence: 0.45 },
      ],
    );
    expect(verdict.trigger).toBe(true);
    expect(verdict.top2?.scientific_name).toBe('Salvia elegans');
  });

  it('honours custom thresholds', () => {
    const verdict = shouldDisambiguate(
      { scientific_name: 'A', confidence: 0.6 },
      [{ scientific_name: 'B', confidence: 0.3 }],
      { gap: 0.5, floor: 0.2 },
    );
    expect(verdict.trigger).toBe(true);
  });

  it('returns null when best is null', () => {
    const verdict = shouldDisambiguate(null, [{ scientific_name: 'A', confidence: 0.9 }]);
    expect(verdict.trigger).toBe(false);
    expect(verdict.reason).toBe('no_alternates');
  });
});

describe('canonicalPair', () => {
  it('sorts alphabetically so (A,B) and (B,A) collide', () => {
    const a = canonicalPair('Quercus rubra', 'Quercus alba');
    const b = canonicalPair('Quercus alba', 'Quercus rubra');
    expect(a).toEqual(b);
    expect(a.taxon_a).toBe('Quercus alba');
  });

  it('trims whitespace', () => {
    const a = canonicalPair('  Foo  ', 'Bar');
    expect(a.taxon_a).toBe('Bar');
    expect(a.taxon_b).toBe('Foo');
  });
});

describe('loadThresholds', () => {
  beforeEach(() => {
    _resetThresholdsCacheForTests();
    cascadeConfigRows = [];
  });

  it('returns defaults when the table is empty', async () => {
    cascadeConfigRows = [];
    const t = await loadThresholds();
    expect(t.gap).toBe(DEFAULT_GAP_THRESHOLD);
    expect(t.floor).toBe(DEFAULT_MIN_CONFIDENCE);
  });

  it('reads tuned values from cascade_config', async () => {
    cascadeConfigRows = [
      { key: 'disambiguation_gap_threshold', value: 0.05 },
      { key: 'disambiguation_min_confidence', value: 0.5 },
    ];
    const t = await loadThresholds();
    expect(t.gap).toBe(0.05);
    expect(t.floor).toBe(0.5);
  });

  it('caches results across calls', async () => {
    cascadeConfigRows = [{ key: 'disambiguation_gap_threshold', value: 0.07 }];
    const a = await loadThresholds();
    cascadeConfigRows = [{ key: 'disambiguation_gap_threshold', value: 0.99 }];
    const b = await loadThresholds();
    expect(b).toBe(a);
  });
});

describe('disambiguation i18n parity', () => {
  it('every key exists in EN and ES under disambiguation.*', async () => {
    const en = (await import('../../src/i18n/en.json')).default as Record<string, unknown>;
    const es = (await import('../../src/i18n/es.json')).default as Record<string, unknown>;
    const enNs = en.disambiguation as Record<string, string> | undefined;
    const esNs = es.disambiguation as Record<string, string> | undefined;
    expect(enNs).toBeTruthy();
    expect(esNs).toBeTruthy();
    const required = ['title', 'gap_explainer', 'take_another_photo', 'skip_im_confident', 'prompt_loading', 'prompt_error_fallback'];
    for (const k of required) {
      expect(enNs?.[k]).toBeTruthy();
      expect(esNs?.[k]).toBeTruthy();
    }
  });
});

describe('fetchDisambiguationPrompt', () => {
  beforeEach(() => {
    pairRow = null;
    invokeMock.mockReset();
  });

  it('returns the cached row when one exists, without invoking the EF', async () => {
    pairRow = { prompt_en: 'cached EN', prompt_es: 'cached ES' };
    const out = await fetchDisambiguationPrompt('Quercus rubra', 'Quercus alba');
    expect(out.cached).toBe(true);
    expect(out.prompt_en).toBe('cached EN');
    expect(invokeMock).not.toHaveBeenCalled();
  });

  it('falls back when same scientific names are passed', async () => {
    const out = await fetchDisambiguationPrompt('A', 'A');
    expect(out.fallback).toBe(true);
    expect(out.reason).toBe('invalid_pair');
  });

  it('calls the identify EF on cache miss', async () => {
    pairRow = null;
    invokeMock.mockResolvedValue({
      data: { prompt_en: 'gen EN', prompt_es: 'gen ES', cached: false },
      error: null,
    });
    const out = await fetchDisambiguationPrompt('Salvia mexicana', 'Salvia elegans');
    expect(invokeMock).toHaveBeenCalledOnce();
    expect(out.prompt_en).toBe('gen EN');
    expect(out.cached).toBe(false);
  });
});
