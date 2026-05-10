import { describe, it, expect } from 'vitest';
import { loadRecent } from '../../src/lib/home-loaders';

function chain(result: { data: unknown[]; error: null }) {
  const builder: Record<string, unknown> = {};
  const fn = () => builder;
  builder.eq = fn; builder.order = fn; builder.limit = () => Promise.resolve(result);
  return builder;
}

function makeClient(localRows: unknown[], globalRows: unknown[]) {
  let call = 0;
  return {
    from: () => ({
      select: () => {
        call += 1;
        return chain({ data: call === 1 ? localRows : globalRows, error: null });
      },
    }),
  } as never;
}

describe('loadRecent fallback', () => {
  it('uses local scope when local returns 3 rows', async () => {
    const c = makeClient(
      [{ id: '1', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
       { id: '2', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
       { id: '3', observed_at: 'x', state_province: null, identifications: null, media_files: [] }],
      [],
    );
    const r = await loadRecent(c, 'en', 'MX');
    expect(r.usedLocalScope).toBe(true);
    expect(r.rows).toHaveLength(3);
  });

  it('falls back to global when local returns < 3 rows', async () => {
    const c = makeClient(
      [{ id: '1', observed_at: 'x', state_province: null, identifications: null, media_files: [] }],
      [{ id: 'g1', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
       { id: 'g2', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
       { id: 'g3', observed_at: 'x', state_province: null, identifications: null, media_files: [] }],
    );
    const r = await loadRecent(c, 'en', 'MX');
    expect(r.usedLocalScope).toBe(false);
    expect(r.rows.map(x => x.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('skips local query when country is null', async () => {
    // Country=null means only the global query fires; the mock's first
    // call must therefore return global rows.
    const single = {
      from: () => ({
        select: () => chain({ data: [
          { id: 'g1', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
        ], error: null }),
      }),
    } as never;
    const r = await loadRecent(single, 'en', null);
    expect(r.usedLocalScope).toBe(false);
    expect(r.rows.map(x => x.id)).toEqual(['g1']);
  });
});
