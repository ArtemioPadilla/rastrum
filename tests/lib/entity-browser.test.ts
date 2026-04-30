import { describe, it, expect } from 'vitest';
import {
  applyFilters,
  filterPredicates,
  fmtBytes,
  fmtTs,
  confidencePill,
  renderUserPill,
  renderTaxonPill,
  type FilterSpec,
  type SupabaseQuery,
  type RenderContext,
} from '../../src/lib/entity-browser';

/**
 * Mock SupabaseQuery — captures the call sequence so we can assert the
 * filter-to-query translation produced by applyFilters() / filterPredicates.
 *
 * Each chained method records its name + args and returns the same proxy so
 * the chain stays fluent like the real PostgrestFilterBuilder.
 */
type Call = { method: string; args: unknown[] };

function mockQuery(): { q: SupabaseQuery; calls: Call[] } {
  const calls: Call[] = [];
  const handler: ProxyHandler<object> = {
    get(_t, prop) {
      // Don't intercept thenable lookups — the test runner awaits the result
      // of applyFilters() and would otherwise recurse forever via Promise
      // unwrapping (`await { then: fn }` calls fn synchronously).
      if (prop === 'then' || typeof prop === 'symbol') return undefined;
      return (...args: unknown[]) => {
        calls.push({ method: prop as string, args });
        return q;
      };
    },
  };
  const q = new Proxy({}, handler) as unknown as SupabaseQuery;
  return { q, calls };
}

describe('entity-browser: filter predicates', () => {
  it('eq predicate calls .eq with the column and value', () => {
    const { q, calls } = mockQuery();
    filterPredicates.eq('source')(q, 'plantnet');
    expect(calls).toEqual([{ method: 'eq', args: ['source', 'plantnet'] }]);
  });

  it('ilike predicate wraps the value in % markers', () => {
    const { q, calls } = mockQuery();
    filterPredicates.ilike('body')(q, 'spam');
    expect(calls).toEqual([{ method: 'ilike', args: ['body', '%spam%'] }]);
  });

  it('gteDate predicate emits .gte', () => {
    const { q, calls } = mockQuery();
    filterPredicates.gteDate('created_at')(q, '2026-04-01');
    expect(calls[0].method).toBe('gte');
    expect(calls[0].args).toEqual(['created_at', '2026-04-01']);
  });

  it('lteDate predicate emits .lte', () => {
    const { q, calls } = mockQuery();
    filterPredicates.lteDate('created_at')(q, '2026-04-30');
    expect(calls[0].method).toBe('lte');
  });

  it('isNull predicate maps to .is(col, null)', () => {
    const { q, calls } = mockQuery();
    filterPredicates.isNull('deleted_at')(q, '');
    expect(calls[0]).toEqual({ method: 'is', args: ['deleted_at', null] });
  });

  it('isNotNull predicate maps to .not(col, "is", null)', () => {
    const { q, calls } = mockQuery();
    filterPredicates.isNotNull('deleted_at')(q, '');
    expect(calls[0]).toEqual({ method: 'not', args: ['deleted_at', 'is', null] });
  });
});

describe('entity-browser: applyFilters', () => {
  const filters: FilterSpec[] = [
    {
      key: 'source',
      label: 'Source',
      kind: 'select',
      apply: (q, v) => filterPredicates.eq('source')(q, v),
    },
    {
      key: 'q',
      label: 'Search',
      kind: 'text',
      apply: (q, v) => filterPredicates.ilike('body')(q, v),
    },
  ];

  it('applies only filters with non-empty values', async () => {
    const { q, calls } = mockQuery();
    await applyFilters(q, filters, { source: 'plantnet', q: '' });
    expect(calls).toHaveLength(1);
    expect(calls[0]).toEqual({ method: 'eq', args: ['source', 'plantnet'] });
  });

  it('applies multiple filters in order', async () => {
    const { q, calls } = mockQuery();
    await applyFilters(q, filters, { source: 'human', q: 'jaguar' });
    expect(calls).toHaveLength(2);
    expect(calls[0].method).toBe('eq');
    expect(calls[1].method).toBe('ilike');
  });

  it('returns null short-circuit when an apply returns null', async () => {
    const { q } = mockQuery();
    const shortFilter: FilterSpec[] = [
      {
        key: 'identifier',
        label: 'Identifier',
        kind: 'text',
        apply: () => null,
      },
    ];
    const result = await applyFilters(q, shortFilter, { identifier: 'unknown-user' });
    expect(result).toBeNull();
  });

  it('skips filters whose value is undefined', async () => {
    const { q, calls } = mockQuery();
    await applyFilters(q, filters, {});
    expect(calls).toHaveLength(0);
  });
});

describe('entity-browser: render helpers', () => {
  it('fmtTs returns em-dash for null', () => {
    expect(fmtTs(null)).toBe('—');
  });

  it('fmtTs trims to "YYYY-MM-DD HH:MM:SS"', () => {
    expect(fmtTs('2026-04-29T14:33:21.123Z')).toBe('2026-04-29 14:33:21');
  });

  it('fmtBytes handles all magnitudes', () => {
    expect(fmtBytes(0)).toBe('0 B');
    expect(fmtBytes(512)).toBe('512 B');
    expect(fmtBytes(2048)).toBe('2.0 KB');
    expect(fmtBytes(1024 * 1024)).toBe('1.0 MB');
    expect(fmtBytes(1024 * 1024 * 1024)).toBe('1.0 GB');
    expect(fmtBytes(null)).toBe('—');
    expect(fmtBytes(undefined)).toBe('—');
  });

  it('confidencePill colours by confidence buckets', () => {
    expect(confidencePill(null)).toContain('—');
    expect(confidencePill(0.92)).toContain('emerald');
    expect(confidencePill(0.62)).toContain('amber');
    expect(confidencePill(0.30)).toContain('zinc');
  });

  it('renderUserPill prefers username over display name', () => {
    const ctx: RenderContext = {
      users: { 'u1': { username: 'alice', display_name: 'Alice Roe' } },
      taxa: {},
      lang: 'en',
    };
    const html = renderUserPill('u1', ctx);
    expect(html).toContain('@alice');
    expect(html).not.toContain('Alice Roe');
  });

  it('renderUserPill falls back to display name then short uuid', () => {
    const ctx: RenderContext = {
      users: {
        'u2': { username: null, display_name: 'Bob Smith' },
        'u3': { username: null, display_name: null },
      },
      taxa: {},
      lang: 'en',
    };
    expect(renderUserPill('u2', ctx)).toContain('Bob Smith');
    expect(renderUserPill('u3', ctx)).toContain('u3'.slice(0, 8));
  });

  it('renderUserPill renders em-dash for null id', () => {
    const ctx: RenderContext = { users: {}, taxa: {}, lang: 'en' };
    expect(renderUserPill(null, ctx)).toContain('—');
  });

  it('renderTaxonPill prefers resolved scientific_name over fallback', () => {
    const ctx: RenderContext = {
      users: {},
      taxa: { 't1': { scientific_name: 'Panthera onca' } },
      lang: 'en',
    };
    expect(renderTaxonPill('t1', 'fallback name', ctx)).toContain('Panthera onca');
  });

  it('renderTaxonPill uses fallback when taxon id is unresolved', () => {
    const ctx: RenderContext = { users: {}, taxa: {}, lang: 'en' };
    expect(renderTaxonPill(null, 'Panthera onca', ctx)).toContain('Panthera onca');
  });

  it('renderTaxonPill HTML-escapes both resolved and fallback names', () => {
    const ctx: RenderContext = {
      users: {},
      taxa: { 't1': { scientific_name: '<script>x</script>' } },
      lang: 'en',
    };
    const html = renderTaxonPill('t1', null, ctx);
    expect(html).not.toContain('<script>');
    expect(html).toContain('&lt;script&gt;');
  });
});
