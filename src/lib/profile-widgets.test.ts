import { describe, expect, it } from 'vitest';
import {
  buildCalendarGrid,
  canSeeFacet,
  capTopSpecies,
  donutFromCounts,
  groupActivityByWeek,
  isOwnerOnlyFacet,
  PRIVACY_PRESETS,
  TOP_SPECIES_CAP,
  arcPath,
  polar,
} from './profile-widgets';

describe('canSeeFacet', () => {
  it('owner sees every level', () => {
    expect(canSeeFacet({ bio: 'private' }, 'bio', 'self')).toBe(true);
    expect(canSeeFacet({ bio: 'signed_in' }, 'bio', 'self')).toBe(true);
    expect(canSeeFacet({ bio: 'public' }, 'bio', 'self')).toBe(true);
  });

  it('public is visible to anyone', () => {
    expect(canSeeFacet({ bio: 'public' }, 'bio', 'anonymous')).toBe(true);
    expect(canSeeFacet({ bio: 'public' }, 'bio', 'signed_in')).toBe(true);
  });

  it('signed_in hides anonymous, allows authenticated', () => {
    expect(canSeeFacet({ bio: 'signed_in' }, 'bio', 'anonymous')).toBe(false);
    expect(canSeeFacet({ bio: 'signed_in' }, 'bio', 'signed_in')).toBe(true);
  });

  it('private hides every viewer except owner', () => {
    expect(canSeeFacet({ bio: 'private' }, 'bio', 'anonymous')).toBe(false);
    expect(canSeeFacet({ bio: 'private' }, 'bio', 'signed_in')).toBe(false);
  });

  it('missing facet keys default to public (forward-compat)', () => {
    expect(canSeeFacet({}, 'bio', 'anonymous')).toBe(true);
  });
});

describe('isOwnerOnlyFacet', () => {
  it('flags non-public facets', () => {
    expect(isOwnerOnlyFacet({ bio: 'public' }, 'bio')).toBe(false);
    expect(isOwnerOnlyFacet({ bio: 'signed_in' }, 'bio')).toBe(true);
    expect(isOwnerOnlyFacet({ bio: 'private' }, 'bio')).toBe(true);
  });
});

describe('buildCalendarGrid', () => {
  it('returns 53 weeks × 7 days = 371 cells', () => {
    const cells = buildCalendarGrid([], new Date('2026-04-27T00:00:00Z'));
    expect(cells).toHaveLength(53 * 7);
  });

  it('marks empty cells with intensity 0 and matches max-density bucket', () => {
    const end = new Date('2026-04-27T00:00:00Z');
    const buckets = [
      { bucket_date: '2026-04-25', daily_count: 8 },
      { bucket_date: '2026-04-26', daily_count: 2 },
      { bucket_date: '2026-04-20', daily_count: 4 },
    ];
    const cells = buildCalendarGrid(buckets, end);
    const cell8 = cells.find((c) => c.date === '2026-04-25');
    const cell2 = cells.find((c) => c.date === '2026-04-26');
    const cell4 = cells.find((c) => c.date === '2026-04-20');
    expect(cell8?.intensity).toBe(4);
    expect(cell2?.intensity).toBe(1);
    expect(cell4?.intensity).toBe(2);
    expect(cell8?.count).toBe(8);
    const empty = cells.find((c) => c.date === '2026-01-01');
    expect(empty?.count).toBe(0);
    expect(empty?.intensity).toBe(0);
  });

  it('places weekIndex 52 at the end-date column', () => {
    const cells = buildCalendarGrid([], new Date('2026-04-27T00:00:00Z'));
    const last = cells[cells.length - 1];
    expect(last.weekIndex).toBe(52);
    expect(last.date).toBe('2026-04-27');
  });
});

describe('donutFromCounts', () => {
  it('returns empty when total is zero', () => {
    expect(donutFromCounts([])).toEqual([]);
    expect(donutFromCounts([{ kingdom: 'X', obs_count: 0 }])).toEqual([]);
  });

  it('shares sum to 1 and degrees walk 0..360', () => {
    const slices = donutFromCounts([
      { kingdom: 'Plantae', obs_count: 50 },
      { kingdom: 'Animalia', obs_count: 30 },
      { kingdom: 'Fungi', obs_count: 20 },
    ]);
    const total = slices.reduce((acc, s) => acc + s.share, 0);
    expect(total).toBeCloseTo(1, 6);
    expect(slices[0].startDeg).toBe(0);
    expect(slices[slices.length - 1].endDeg).toBeCloseTo(360, 6);
  });
});

describe('arc geometry', () => {
  it('polar() places 0deg at the top', () => {
    const p = polar(50, 50, 40, 0);
    expect(p.x).toBeCloseTo(50, 6);
    expect(p.y).toBeCloseTo(10, 6);
  });

  it('arcPath returns a closed donut slice', () => {
    const d = arcPath(50, 50, 40, 25, 0, 90);
    expect(d.startsWith('M')).toBe(true);
    expect(d.endsWith('Z')).toBe(true);
    expect(d).toContain('A 40 40');
    expect(d).toContain('A 25 25');
  });
});

describe('capTopSpecies', () => {
  const make = (n: number) =>
    Array.from({ length: n }, (_, i) => ({
      taxon_id: `t-${i}`,
      scientific_name: `Sp ${i}`,
      obs_count: n - i,
      thumbnail_url: null,
    }));

  it('caps at 12 by default', () => {
    expect(capTopSpecies(make(20))).toHaveLength(TOP_SPECIES_CAP);
    expect(capTopSpecies(make(20))).toHaveLength(12);
  });

  it('passes through under cap', () => {
    expect(capTopSpecies(make(5))).toHaveLength(5);
  });

  it('respects explicit cap', () => {
    expect(capTopSpecies(make(20), 6)).toHaveLength(6);
    expect(capTopSpecies(make(20), 0)).toHaveLength(0);
  });
});

describe('groupActivityByWeek', () => {
  it('groups rows into this_week / last_week / older buckets', () => {
    const now = new Date('2026-04-27T12:00:00Z'); // Monday
    const rows = [
      { event_id: 'a', event_kind: 'observation_created', created_at: '2026-04-27T10:00:00Z' }, // this_week
      { event_id: 'b', event_kind: 'observation_created', created_at: '2026-04-22T10:00:00Z' }, // last_week
      { event_id: 'c', event_kind: 'observation_created', created_at: '2026-03-15T10:00:00Z' }, // older
    ];
    const groups = groupActivityByWeek(rows, now);
    const map = new Map(groups.map((g) => [g.bucketKey, g.rows.length]));
    expect(map.get('this_week')).toBe(1);
    expect(map.get('last_week')).toBe(1);
    expect(map.get('older')).toBe(1);
  });

  it('drops empty buckets', () => {
    const groups = groupActivityByWeek([], new Date('2026-04-27T12:00:00Z'));
    expect(groups).toHaveLength(0);
  });
});

describe('PRIVACY_PRESETS', () => {
  it('researcher matches the spec: public for science facets, signed_in for identity, private for personal', () => {
    const p = PRIVACY_PRESETS.researcher;
    expect(p.profile).toBe('public');
    expect(p.observation_map).toBe('public');
    expect(p.real_name).toBe('signed_in');
    expect(p.location).toBe('signed_in');
    expect(p.streak).toBe('signed_in');
    expect(p.watchlist).toBe('private');
    expect(p.goals).toBe('private');
    expect(p.karma_total).toBe('public');
  });

  it('open_scientist makes everything public except watchlist + goals', () => {
    const p = PRIVACY_PRESETS.open_scientist;
    for (const [k, v] of Object.entries(p)) {
      if (k === 'watchlist' || k === 'goals') expect(v).toBe('private');
      else expect(v).toBe('public');
    }
  });

  it('private_observer keeps profile signed_in so module-22 voters can verify the account exists', () => {
    const p = PRIVACY_PRESETS.private_observer;
    expect(p.profile).toBe('signed_in');
    for (const [k, v] of Object.entries(p)) {
      if (k === 'profile') continue;
      expect(v).toBe('private');
    }
  });
});
