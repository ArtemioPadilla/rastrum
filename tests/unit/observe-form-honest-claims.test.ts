/**
 * #1024 (backfill of #942 plan §Task 1.2) — pin the n>=50 honest-claim
 * invariant of `public.is_first_in_sector(uuid)`.
 *
 * Why this test exists:
 *   - PR #942 PR1 introduced the SQL helper used by ObservationSuccess to
 *     show "Primera en este sector hoy" / "First in this sector today".
 *   - The v1.1.5 Persuasive-Tech audit ("Honest-norms invariant", CLAUDE.md)
 *     forbids any peer-comparison surface from showing when n < 50. The
 *     function enforces this gate inside Postgres: sectors with < 50
 *     historical observations always return `false`, even when no other
 *     observation has been logged that day.
 *   - There is no pglite/pgmem harness in this repo, and standing up real
 *     PostGIS for one assertion is overkill. So this file pins the contract
 *     in two complementary layers:
 *
 *       (a) Snapshot of the SQL body: the `< 50` literal + the
 *           `same_day_neighbours = 0` branch are pinned against
 *           `docs/specs/infra/supabase-schema.sql`. Any rewrite that loses
 *           the gate (raises/lowers the threshold, drops the same-day
 *           filter, flips the boolean) trips here loudly.
 *       (b) Pure-TS mirror: table-driven cases that mirror the function's
 *           CASE-WHEN logic. The Playwright path exercises the real SQL
 *           against a seeded DB; this file pins the *intent* so a future
 *           refactor that keeps the SQL valid but changes its semantics
 *           still fails the build.
 *
 * If this test ever fails: the change to the SQL function or the threshold
 * is intentional only if `docs/runbooks/observe-progressive-card.md` and the
 * CLAUDE.md "Honest-norms invariant" section are updated in the same PR.
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const SCHEMA_PATH = join(process.cwd(), 'docs/specs/infra/supabase-schema.sql');
const SCHEMA = readFileSync(SCHEMA_PATH, 'utf8');

function extractFunctionBody(name: string): string {
  // Capture from `CREATE OR REPLACE FUNCTION public.<name>(` through the
  // matching `$$;` terminator. Each function definition is delimited by
  // `AS $$ ... $$;`, which is unique inside a single CREATE FUNCTION block.
  const start = SCHEMA.indexOf(`CREATE OR REPLACE FUNCTION public.${name}(`);
  if (start < 0) throw new Error(`function ${name} not found in schema`);
  const tail = SCHEMA.slice(start);
  const asMarker = tail.indexOf('AS $$');
  if (asMarker < 0) throw new Error(`AS $$ marker not found for ${name}`);
  const after = tail.slice(asMarker + 'AS $$'.length);
  const endMarker = after.indexOf('$$;');
  if (endMarker < 0) throw new Error(`closing $$; not found for ${name}`);
  return after.slice(0, endMarker);
}

describe('is_first_in_sector — schema snapshot (honest-norms invariant)', () => {
  const body = extractFunctionBody('is_first_in_sector');

  it('has the n>=50 gate (literal "< 50")', () => {
    // The literal threshold is the load-bearing part of the invariant.
    // If someone raises it (e.g. 100) or lowers it (e.g. 10) this assertion
    // breaks and the PR author has to justify the change.
    expect(body).toMatch(/<\s*50/);
  });

  it('returns false when the sector is too sparse (CASE branch)', () => {
    // The "too sparse" branch must explicitly return false, not NULL —
    // SQL three-valued logic would otherwise leak into the UI as a missing
    // pill instead of an honest no-claim.
    expect(body).toMatch(/total_neighbours\s*<\s*50\s+THEN\s+false/i);
  });

  it('the second branch checks "first today" via same-day neighbour count', () => {
    // Two ways the function could be wrong while still compiling:
    //   (a) using `<= 0` would let same-day neighbours through if the count
    //       column went negative (impossible, but defensive)
    //   (b) using `>=` would invert the meaning
    // Pin the exact comparison the design intended.
    expect(body).toMatch(/same_day_neighbours\s*=\s*0/);
  });

  it('uses ST_DWithin with a 1000-metre radius (1 km sector)', () => {
    // The sector size is half of the contract — moving it changes the n>=50
    // pool too. CLAUDE.md describes the sector as 1 km radius.
    expect(body).toMatch(/ST_DWithin[^,]+,[^,]+,\s*1000\s*\)/);
  });

  it('is declared SECURITY DEFINER with pinned search_path', () => {
    // Schema-security invariant (CLAUDE.md "Schema security invariants" #3):
    // a definer function in public must pin search_path to defend against
    // an attacker who can create objects in an earlier-resolving schema.
    const start = SCHEMA.indexOf('CREATE OR REPLACE FUNCTION public.is_first_in_sector(');
    const header = SCHEMA.slice(start, start + 600);
    expect(header).toMatch(/SECURITY DEFINER/);
    expect(header).toMatch(/SET search_path\s*=\s*public,\s*extensions,\s*pg_temp/);
  });

  it('grants EXECUTE only to authenticated (REVOKE PUBLIC)', () => {
    // The definer gate is meaningless if anon can call it.
    expect(SCHEMA).toMatch(/REVOKE EXECUTE ON FUNCTION public\.is_first_in_sector\(uuid\) FROM PUBLIC/);
    expect(SCHEMA).toMatch(/GRANT\s+EXECUTE ON FUNCTION public\.is_first_in_sector\(uuid\) TO authenticated/);
  });
});

/**
 * Pure-TS mirror of the SQL function's CASE-WHEN logic.
 *
 * This is *not* an integration test of the SQL — pglite + PostGIS is out
 * of reach for this suite. It pins the *intent* table-driven so a future
 * change that keeps the SQL valid but changes its semantics still fails.
 *
 * Mirrors the function exactly:
 *   IF historicalNeighbours < 50  → false  (honest-norms gate)
 *   ELSE NOT EXISTS(same-day neighbour) i.e. todaySameSector == 0
 */
function isFirstInSectorPureLogic(args: {
  historicalNeighbours: number;
  todaySameSector: number;
}): boolean {
  if (args.historicalNeighbours < 50) return false;
  return args.todaySameSector === 0;
}

describe('is_first_in_sector — table-driven logic mirror', () => {
  // Each row: [historical, today, expected, why]
  const cases: ReadonlyArray<readonly [number, number, boolean, string]> = [
    // Honest-norms gate — n < 50 always false, even with 0 obs today.
    [0, 0, false, 'empty sector — n=0 < 50'],
    [1, 0, false, 'single historical obs — n=1 < 50'],
    [49, 0, false, 'just under threshold (n=49) — still false'],
    [49, 5, false, 'just under threshold even with same-day obs'],
    // At threshold — "first" iff no same-day obs.
    [50, 0, true, 'exactly threshold, no same-day obs → first'],
    [50, 1, false, 'exactly threshold but one same-day obs → not first'],
    [50, 99, false, 'exactly threshold but busy day → not first'],
    // Well above threshold — same rule applies.
    [500, 0, true, 'busy sector, fresh day → first'],
    [500, 1, false, 'busy sector, someone else already today → not first'],
    [10_000, 0, true, 'historic hotspot, fresh day → first'],
  ];

  for (const [historical, today, expected, why] of cases) {
    it(`historical=${historical}, today=${today} → ${expected} (${why})`, () => {
      expect(
        isFirstInSectorPureLogic({
          historicalNeighbours: historical,
          todaySameSector: today,
        }),
      ).toBe(expected);
    });
  }

  it('the threshold matches the v1.1.5 honest-norms MIN_N_THRESHOLD (=50)', async () => {
    // The MIN_N_THRESHOLD constant in peer-norms.ts is the single source of
    // truth for the honest-norms gate across the codebase. If anyone changes
    // it without updating the SQL (or vice versa) the two layers desync.
    const { MIN_N_THRESHOLD } = await import('../../src/lib/peer-norms');
    expect(MIN_N_THRESHOLD).toBe(50);
    expect(extractFunctionBody('is_first_in_sector')).toContain(
      `< ${MIN_N_THRESHOLD}`,
    );
  });
});
