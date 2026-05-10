import { describe, it, expect } from 'vitest';
import {
  loadInboxCount, loadValidateCount, loadFaltaDexCount, loadWatchlistHit,
  loadStreak, loadHeroInputs,
} from '../../src/lib/home-loaders';

function makeClient(handlers: Record<string, () => unknown>) {
  return {
    from: (table: string) => {
      const h = handlers[`from:${table}`];
      if (!h) throw new Error(`unmocked from('${table}')`);
      return h();
    },
    rpc: (name: string) => {
      const h = handlers[`rpc:${name}`];
      if (!h) throw new Error(`unmocked rpc('${name}')`);
      return h();
    },
  };
}

describe('home-loaders', () => {
  it('loadInboxCount returns count or 0 on error', async () => {
    const ok = makeClient({
      'from:notifications': () => ({
        select: () => ({ eq: () => ({ is: () => Promise.resolve({ count: 3, error: null }) }) }),
      }),
    });
    expect(await loadInboxCount(ok as never, 'u1')).toBe(3);

    const errored = makeClient({
      'from:notifications': () => ({
        select: () => ({ eq: () => ({ is: () => Promise.resolve({ count: null, error: { message: 'x' } }) }) }),
      }),
    });
    expect(await loadInboxCount(errored as never, 'u1')).toBe(0);
  });

  it('loadValidateCount uses the RPC', async () => {
    const c = makeClient({
      'rpc:pending_validation_count': () => Promise.resolve({ data: 7, error: null }),
    });
    expect(await loadValidateCount(c as never)).toBe(7);
  });

  it('loadValidateCount returns 0 on RPC error or non-number', async () => {
    const errored = makeClient({
      'rpc:pending_validation_count': () => Promise.resolve({ data: null, error: { message: 'x' } }),
    });
    expect(await loadValidateCount(errored as never)).toBe(0);

    const garbled = makeClient({
      'rpc:pending_validation_count': () => Promise.resolve({ data: 'not-a-number', error: null }),
    });
    expect(await loadValidateCount(garbled as never)).toBe(0);
  });

  it('loadFaltaDexCount uses the RPC and returns shape', async () => {
    const c = makeClient({
      'rpc:falta_dex_summary': () => Promise.resolve({
        data: [{ gap_count: 12, region: 'Jalisco' }],
        error: null,
      }),
    });
    expect(await loadFaltaDexCount(c as never)).toEqual({ count: 12, region: 'Jalisco' });
  });

  it('loadStreak returns null on error', async () => {
    const c = makeClient({
      'from:user_streaks': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }),
      }),
    });
    expect(await loadStreak(c as never, 'u1')).toBeNull();
  });

  it('loadStreak parses good data', async () => {
    const c = makeClient({
      'from:user_streaks': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
          data: {
            current_days: 5, last_qualifying_day: '2026-05-08',
            streak_freezes_available: 1, streak_freezes_used: 3,
            streak_freeze_last_used_at: '2026-04-10T08:00:00Z',
          }, error: null,
        }) }) }),
      }),
    });
    expect(await loadStreak(c as never, 'u1')).toEqual({
      currentDays: 5,
      lastObsLocalDay: '2026-05-08',
      freezesAvailable: 1,
      freezesUsed: 3,
      freezeLastUsedAt: '2026-04-10T08:00:00Z',
    });
  });

  it('loadStreak returns freezesAvailable=0 when column is null (pre-migration rows)', async () => {
    const c = makeClient({
      'from:user_streaks': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
          data: {
            current_days: 7, last_qualifying_day: '2026-05-08',
            streak_freezes_available: null, streak_freezes_used: null,
            streak_freeze_last_used_at: null,
          }, error: null,
        }) }) }),
      }),
    });
    const snap = await loadStreak(c as never, 'u1');
    expect(snap?.freezesAvailable).toBe(0);
    expect(snap?.freezesUsed).toBe(0);
    expect(snap?.freezeLastUsedAt).toBeNull();
  });

  it('loadWatchlistHit returns null in v1 (deferred)', async () => {
    const c = makeClient({});
    expect(await loadWatchlistHit(c as never, 'u1')).toBeNull();
  });

  it('loadHeroInputs runs all loaders in parallel and tolerates partial failure', async () => {
    const c = makeClient({
      'from:user_streaks': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
          data: {
            current_days: 5, last_qualifying_day: '2026-05-08',
            streak_freezes_available: 0, streak_freezes_used: 0,
            streak_freeze_last_used_at: null,
          }, error: null,
        }) }) }),
      }),
      'rpc:pending_validation_count': () => Promise.resolve({ data: 0, error: null }),
      'from:users': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
          data: { timezone: 'America/Mexico_City', expert_taxa: ['Aves'] }, error: null,
        }) }) }),
      }),
    });
    const inputs = await loadHeroInputs(c as never, 'u1', new Date('2026-05-09T20:00:00Z'));
    expect(inputs.streak).toMatchObject({ currentDays: 5, lastObsLocalDay: '2026-05-08' });
    expect(inputs.pendingIdsCount).toBe(0);
    expect(inputs.userTimezone).toBe('America/Mexico_City');
    expect(inputs.expertTaxonGroup).toBe('Aves');
    expect(inputs.watchlistHit).toBeNull();
  });

  it('loadHeroInputs handles missing user profile gracefully', async () => {
    const c = makeClient({
      'from:user_streaks': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
      'rpc:pending_validation_count': () => Promise.resolve({ data: null, error: { message: 'x' } }),
      'from:users': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: null }) }) }),
      }),
    });
    const inputs = await loadHeroInputs(c as never, 'u1', new Date('2026-05-09T20:00:00Z'));
    expect(inputs.streak).toBeNull();
    expect(inputs.pendingIdsCount).toBe(0);
    expect(inputs.userTimezone).toBe('UTC');
    expect(inputs.expertTaxonGroup).toBeNull();
    expect(inputs.watchlistHit).toBeNull();
  });
});
