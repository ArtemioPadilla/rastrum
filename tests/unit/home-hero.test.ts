import { describe, it, expect } from 'vitest';
import { resolveHeroState, startOfLocalDayUTC, type HeroInputs } from '../../src/lib/home-hero';

const baseInputs: HeroInputs = {
  streak: null,
  watchlistHit: null,
  pendingIdsCount: 0,
  expertTaxonGroup: null,
  now: new Date('2026-05-09T20:00:00Z'),
  userTimezone: 'UTC',
};

describe('resolveHeroState', () => {
  it('falls through to observe_default when no signals', () => {
    expect(resolveHeroState(baseInputs).kind).toBe('observe_default');
  });

  it('observe_default flags morningPeak between 5–9 local', () => {
    const r = resolveHeroState({ ...baseInputs, now: new Date('2026-05-09T07:00:00Z') });
    expect(r).toEqual({ kind: 'observe_default', morningPeak: true });
  });

  it('observe_default morningPeak=false outside 5–9', () => {
    const r = resolveHeroState({ ...baseInputs, now: new Date('2026-05-09T12:00:00Z') });
    expect(r).toEqual({ kind: 'observe_default', morningPeak: false });
  });

  it('streak_at_risk: only after 18:00 local', () => {
    const before = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 5, lastObsLocalDay: '2026-05-08' },
      now: new Date('2026-05-09T15:00:00Z'),
    });
    expect(before.kind).toBe('observe_default');

    const after = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 5, lastObsLocalDay: '2026-05-08' },
      now: new Date('2026-05-09T19:00:00Z'),
    });
    expect(after.kind).toBe('streak_at_risk');
    if (after.kind === 'streak_at_risk') {
      expect(after.currentDays).toBe(5);
      expect(after.hoursLeftLocal).toBe(5);
    }
  });

  it('streak_at_risk: skipped if user observed today', () => {
    const r = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 5, lastObsLocalDay: '2026-05-09' },
      now: new Date('2026-05-09T20:00:00Z'),
    });
    expect(r.kind).toBe('observe_default');
  });

  it('streak_at_risk: skipped if currentDays is 0', () => {
    const r = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 0, lastObsLocalDay: null },
      now: new Date('2026-05-09T20:00:00Z'),
    });
    expect(r.kind).toBe('observe_default');
  });

  it('streak_at_risk: triggers at currentDays === 1 (threshold)', () => {
    const r = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 1, lastObsLocalDay: '2026-05-08' },
      now: new Date('2026-05-09T19:00:00Z'),
    });
    expect(r.kind).toBe('streak_at_risk');
    if (r.kind === 'streak_at_risk') expect(r.currentDays).toBe(1);
  });

  it('watchlist_hit beats observe_default but loses to streak_at_risk', () => {
    const watchOnly = resolveHeroState({
      ...baseInputs,
      watchlistHit: { taxonName: 'Quetzal', distanceKm: 4, obsId: 'abc', observedAt: '2026-05-09T18:00:00Z' },
    });
    expect(watchOnly.kind).toBe('watchlist_hit');

    const both = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 12, lastObsLocalDay: '2026-05-08' },
      watchlistHit: { taxonName: 'Quetzal', distanceKm: 4, obsId: 'abc', observedAt: '2026-05-09T18:00:00Z' },
      now: new Date('2026-05-09T19:30:00Z'),
    });
    expect(both.kind).toBe('streak_at_risk');
  });

  it('pending_ids: requires count >= 3 AND expertTaxonGroup', () => {
    const noGroup = resolveHeroState({ ...baseInputs, pendingIdsCount: 7 });
    expect(noGroup.kind).toBe('observe_default');

    const withGroup = resolveHeroState({
      ...baseInputs,
      pendingIdsCount: 7,
      expertTaxonGroup: 'Aves',
    });
    expect(withGroup.kind).toBe('pending_ids');
    if (withGroup.kind === 'pending_ids') {
      expect(withGroup.count).toBe(7);
      expect(withGroup.taxonGroup).toBe('Aves');
    }

    const tooFew = resolveHeroState({
      ...baseInputs,
      pendingIdsCount: 2,
      expertTaxonGroup: 'Aves',
    });
    expect(tooFew.kind).toBe('observe_default');
  });

  it('cascade ordering: streak > watchlist > pending > default', () => {
    const r = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 12, lastObsLocalDay: '2026-05-08' },
      watchlistHit: { taxonName: 'Quetzal', distanceKm: 4, obsId: 'abc', observedAt: '2026-05-09T18:00:00Z' },
      pendingIdsCount: 7,
      expertTaxonGroup: 'Aves',
      now: new Date('2026-05-09T20:00:00Z'),
    });
    expect(r.kind).toBe('streak_at_risk');
  });
});

describe('startOfLocalDayUTC', () => {
  it('returns user-local midnight as a UTC instant, distinct from UTC midnight', () => {
    // 2026-05-09T03:00:00Z is still 2026-05-08 21:00 in Mexico City (UTC-6).
    // UTC midnight would be 2026-05-09T00:00:00Z; the user-local day start
    // must be 2026-05-08T06:00:00Z (00:00 local on the 8th).
    const now = new Date('2026-05-09T03:00:00Z');
    const utcMidnight = new Date(now);
    utcMidnight.setUTCHours(0, 0, 0, 0);

    const localStart = startOfLocalDayUTC(now, 'America/Mexico_City');

    expect(localStart.toISOString()).not.toBe(utcMidnight.toISOString());
    expect(localStart.toISOString()).toBe('2026-05-08T06:00:00.000Z');
  });

  it('matches UTC midnight for the UTC timezone', () => {
    const now = new Date('2026-05-09T15:30:00Z');
    expect(startOfLocalDayUTC(now, 'UTC').toISOString()).toBe('2026-05-09T00:00:00.000Z');
  });

  it('falls back to UTC midnight for an unparseable timezone', () => {
    const now = new Date('2026-05-09T15:30:00Z');
    expect(startOfLocalDayUTC(now, 'Not/AZone').toISOString()).toBe('2026-05-09T00:00:00.000Z');
  });
});
