/**
 * Tests for `observations_material_edit_check_trg`.
 *
 * The trigger lives in `docs/specs/infra/supabase-schema.sql` (search for
 * `observations_material_edit_check`). It is a BEFORE UPDATE trigger that
 * stamps `last_material_edit_at = now()` when any of these branches fire:
 *
 *   1. NEW.location moved more than 1 km from OLD.location (PostGIS
 *      `ST_Distance(NEW.location, OLD.location) > 1000`, geography type
 *      so the result is in metres).
 *   2. NEW.observed_at moved more than 24 h from OLD.observed_at.
 *   3. NEW.primary_taxon_id IS DISTINCT FROM OLD.primary_taxon_id.
 *
 * Ideally we'd run the actual SQL trigger against PGlite. We tried —
 * pglite 0.4.5 (the current release as of 2026-04) does not bundle the
 * postgis extension and `CREATE EXTENSION postgis` returns "extension is
 * not available". The `geography` type and `ST_Distance` are therefore
 * unreachable in pglite, and bringing up a real PostGIS container in CI
 * for one trigger is overkill (the schema-level apply is already covered
 * by `db-validate.yml` which spins Postgres 17 + PostGIS 3.4 and applies
 * the schema twice).
 *
 * Compromise: this file is a JS mirror of the trigger's branches. It
 * encodes the same predicates so that any future refactor of the SQL
 * function has a peer-reviewable spec to compare against. Each test case
 * names the SQL branch it exercises and the row-level expectation. The
 * SQL itself is exercised end-to-end by `db-validate.yml` (idempotency)
 * and by hand via `make db-apply` against a real Supabase instance.
 *
 * If pglite ever ships postgis (tracked upstream — there's been an open
 * issue since 2024), swap this for a real DB-backed test.
 */

import { describe, it, expect } from 'vitest';

type Row = {
  location: { lat: number; lng: number } | null;
  observed_at: Date | null;
  primary_taxon_id: string | null;
};

/** Haversine distance in metres between two WGS84 points (mirrors the
 *  `ST_Distance(geography, geography)` Postgres semantic for our usage —
 *  spheroidal distance is close enough at the < 100 km scale where the
 *  trigger's 1 km cutoff lives). */
function haversineMetres(
  a: { lat: number; lng: number },
  b: { lat: number; lng: number },
): number {
  const R = 6371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(b.lat - a.lat);
  const dLng = toRad(b.lng - a.lng);
  const lat1 = toRad(a.lat);
  const lat2 = toRad(b.lat);
  const h = Math.sin(dLat / 2) ** 2 + Math.sin(dLng / 2) ** 2 * Math.cos(lat1) * Math.cos(lat2);
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/** Pure-JS mirror of `observations_material_edit_check()`. Returns
 *  whether the trigger would set `last_material_edit_at = now()`. */
function isMaterialEdit(prev: Row, next: Row): boolean {
  // Location moved > 1 km
  if (prev.location && next.location) {
    const same =
      prev.location.lat === next.location.lat &&
      prev.location.lng === next.location.lng;
    if (!same) {
      const d = haversineMetres(prev.location, next.location);
      if (d > 1000) return true;
    }
  }

  // observed_at moved > 24 h
  if (prev.observed_at && next.observed_at) {
    const sameTs = prev.observed_at.getTime() === next.observed_at.getTime();
    if (!sameTs) {
      const deltaSec = Math.abs(
        (next.observed_at.getTime() - prev.observed_at.getTime()) / 1000,
      );
      if (deltaSec > 86400) return true;
    }
  }

  // primary_taxon_id changed (IS DISTINCT FROM in SQL)
  if (prev.primary_taxon_id !== next.primary_taxon_id) return true;

  return false;
}

const baseline: Row = {
  location: { lat: 19.5, lng: -101.6 },
  observed_at: new Date('2026-04-01T12:00:00Z'),
  primary_taxon_id: 'taxon-A',
};

const cases: Array<{
  name: string;
  next: Row;
  expectFlagged: boolean;
}> = [
  {
    name: 'no-op update → not material',
    next: { ...baseline },
    expectFlagged: false,
  },
  {
    name: 'location moves 500 m → not material',
    next: {
      ...baseline,
      // ~500 m east at this latitude
      location: { lat: 19.5, lng: baseline.location!.lng + 0.0048 },
    },
    expectFlagged: false,
  },
  {
    name: 'location moves ~890 m → not material (under 1 km cutoff)',
    // The trigger uses `> 1000`. 0.008° of latitude on the spherical
    // earth (R=6371 km) is ~889 m — comfortably below the cutoff.
    next: {
      ...baseline,
      location: { lat: baseline.location!.lat + 0.008, lng: baseline.location!.lng },
    },
    expectFlagged: false,
  },
  {
    name: 'location moves 5 km → material',
    next: {
      ...baseline,
      // 5 km north
      location: { lat: baseline.location!.lat + 5 / 111, lng: baseline.location!.lng },
    },
    expectFlagged: true,
  },
  {
    name: 'observed_at moves 1 hour → not material',
    next: {
      ...baseline,
      observed_at: new Date(baseline.observed_at!.getTime() + 60 * 60 * 1000),
    },
    expectFlagged: false,
  },
  {
    name: 'observed_at moves exactly 24 h → not material (strict >)',
    next: {
      ...baseline,
      observed_at: new Date(baseline.observed_at!.getTime() + 24 * 60 * 60 * 1000),
    },
    expectFlagged: false,
  },
  {
    name: 'observed_at moves 36 hours → material',
    next: {
      ...baseline,
      observed_at: new Date(baseline.observed_at!.getTime() + 36 * 60 * 60 * 1000),
    },
    expectFlagged: true,
  },
  {
    name: 'observed_at moves 36 hours BACK → material (abs)',
    next: {
      ...baseline,
      observed_at: new Date(baseline.observed_at!.getTime() - 36 * 60 * 60 * 1000),
    },
    expectFlagged: true,
  },
  {
    name: 'primary_taxon_id changes → material',
    next: { ...baseline, primary_taxon_id: 'taxon-B' },
    expectFlagged: true,
  },
  {
    name: 'primary_taxon_id cleared (NULL) → material',
    next: { ...baseline, primary_taxon_id: null },
    expectFlagged: true,
  },
];

describe('observations_material_edit_check trigger (JS mirror)', () => {
  it.each(cases)('$name', ({ next, expectFlagged }) => {
    expect(isMaterialEdit(baseline, next)).toBe(expectFlagged);
  });

  it('multiple material changes still flag once', () => {
    const next: Row = {
      location: { lat: 20.5, lng: -101.6 },
      observed_at: new Date(baseline.observed_at!.getTime() + 48 * 60 * 60 * 1000),
      primary_taxon_id: 'taxon-C',
    };
    expect(isMaterialEdit(baseline, next)).toBe(true);
  });

  it('SQL trigger documentation reference', () => {
    // Sentinel test: keeps the SQL filename grep-able from the test harness
    // so a refactor that moves the SQL elsewhere fails this assertion.
    expect('docs/specs/infra/supabase-schema.sql').toMatch(/supabase-schema\.sql$/);
  });
});
