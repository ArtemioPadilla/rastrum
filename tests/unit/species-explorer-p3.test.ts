/**
 * #464 — Species Explorer Phase 3
 *
 * Tests for community hero photo voting, ID leaderboards, and phenology charts
 * on the species profile page.
 *
 * Pure-logic tests:
 * - Phenology month-aggregation from observation dates
 * - ID leaderboard grouping and sorting
 * - HTML structure of SpeciesProfileView
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'fs';
import { resolve } from 'path';

// ── Phenology aggregation helper (re-implemented from SpeciesProfileView) ──

/**
 * Given an array of observed_at ISO date strings, count observations per
 * month (0-indexed: Jan=0, Dec=11).
 */
function buildMonthCounts(observedAtDates: string[]): number[] {
  const months = new Array(12).fill(0);
  for (const d of observedAtDates) {
    const month = new Date(d).getUTCMonth();
    if (month >= 0 && month < 12) months[month]++;
  }
  return months;
}

// ── ID leaderboard helper ──

type IdRow = { identifier_id: string; count?: number };
function buildLeaderboard(rows: IdRow[]): { id: string; count: number }[] {
  const counts = new Map<string, number>();
  for (const r of rows) {
    counts.set(r.identifier_id, (counts.get(r.identifier_id) ?? 0) + 1);
  }
  return Array.from(counts.entries())
    .map(([id, count]) => ({ id, count }))
    .sort((a, b) => b.count - a.count);
}

describe('#464 — Phenology chart', () => {
  it('returns 12 monthly counts', () => {
    const months = buildMonthCounts([]);
    expect(months).toHaveLength(12);
    expect(months.every(m => m === 0)).toBe(true);
  });

  it('counts observations in the correct month', () => {
    const months = buildMonthCounts([
      '2024-01-15T10:00:00Z', // January (0)
      '2024-01-20T10:00:00Z', // January (0)
      '2024-07-01T10:00:00Z', // July (6)
    ]);
    expect(months[0]).toBe(2);  // January
    expect(months[6]).toBe(1);  // July
    expect(months[1]).toBe(0);  // February
  });

  it('handles all 12 months with observations', () => {
    const dates = Array.from({ length: 12 }, (_, i) =>
      `2024-${String(i + 1).padStart(2, '0')}-15T00:00:00Z`
    );
    const months = buildMonthCounts(dates);
    expect(months.every(m => m === 1)).toBe(true);
  });

  it('counts multiple observations in the same month', () => {
    const months = buildMonthCounts([
      '2024-03-01T00:00:00Z',
      '2024-03-15T00:00:00Z',
      '2024-03-31T00:00:00Z',
    ]);
    expect(months[2]).toBe(3); // March
  });

  it('max count is the tallest bar (for normalisation)', () => {
    const months = buildMonthCounts([
      '2024-06-01T00:00:00Z',
      '2024-06-02T00:00:00Z',
      '2024-06-03T00:00:00Z',
      '2024-12-01T00:00:00Z',
    ]);
    const maxCount = Math.max(...months, 1);
    expect(maxCount).toBe(3); // June has 3
  });
});

describe('#464 — ID leaderboard', () => {
  it('groups identifications by identifier_id', () => {
    const leaderboard = buildLeaderboard([
      { identifier_id: 'user-a' },
      { identifier_id: 'user-b' },
      { identifier_id: 'user-a' },
    ]);
    expect(leaderboard[0]).toEqual({ id: 'user-a', count: 2 });
    expect(leaderboard[1]).toEqual({ id: 'user-b', count: 1 });
  });

  it('sorts descending by count', () => {
    const leaderboard = buildLeaderboard([
      { identifier_id: 'x' },
      { identifier_id: 'y' },
      { identifier_id: 'y' },
      { identifier_id: 'y' },
      { identifier_id: 'z' },
      { identifier_id: 'z' },
    ]);
    expect(leaderboard[0].id).toBe('y');
    expect(leaderboard[1].id).toBe('z');
    expect(leaderboard[2].id).toBe('x');
  });

  it('returns empty for no rows', () => {
    expect(buildLeaderboard([])).toHaveLength(0);
  });

  it('handles single identifier with many IDs', () => {
    const rows = Array.from({ length: 10 }, () => ({ identifier_id: 'expert-1' }));
    const board = buildLeaderboard(rows);
    expect(board).toHaveLength(1);
    expect(board[0].count).toBe(10);
  });
});

// ── HTML structure checks for SpeciesProfileView ─────────────────────────
const speciesSrc = readFileSync(
  resolve(process.cwd(), 'src/components/SpeciesProfileView.astro'),
  'utf-8',
);

describe('#464 — SpeciesProfileView structure', () => {
  it('has phenology chart section', () => {
    expect(speciesSrc).toContain('id="sp-phenology-section"');
    expect(speciesSrc).toContain('id="sp-phenology-chart"');
  });

  it('renders phenology as SVG', () => {
    expect(speciesSrc).toContain('createElementNS');
    expect(speciesSrc).toContain("'svg'");
  });

  it('has ID leaderboard section', () => {
    expect(speciesSrc).toContain('id="sp-id-leaderboard-section"');
    expect(speciesSrc).toContain('id="sp-id-leaderboard"');
  });

  it('queries identifications for leaderboard', () => {
    expect(speciesSrc).toContain("'identifications'");
  });

  it('has best-shot nomination section', () => {
    expect(speciesSrc).toContain('id="sp-best-shot-section"');
  });

  it('leaderboard shows top 5', () => {
    expect(speciesSrc).toContain('.slice(0, 5)');
  });
});
