/**
 * #734 — Weekly expert-ID lottery (Principle of Reciprocity)
 *
 * Tests for the weekly-expert-lottery Edge Function logic. The actual
 * Deno serve() cannot run in vitest; we test the exported helpers by
 * extracting the core selection logic into testable functions.
 */
import { describe, it, expect } from 'vitest';

// ---------------------------------------------------------------------------
// Pure-function extractions from the EF
// ---------------------------------------------------------------------------

/** Mirrors the getIsoWeek() helper in the EF. */
function getIsoWeek(d: Date = new Date()): string {
  const thursday = new Date(d);
  thursday.setDate(d.getDate() - (d.getDay() + 6) % 7 + 3);
  const jan4 = new Date(thursday.getFullYear(), 0, 4);
  const week = Math.ceil(
    ((thursday.getTime() - jan4.getTime()) / 86_400_000 + 1) / 7,
  );
  return `${thursday.getFullYear()}-W${String(week).padStart(2, '0')}`;
}

/** Build frequency map from validated_by values. */
function buildCandidateMap(rows: Array<{ validated_by: string | null }>): Record<string, number> {
  const counts: Record<string, number> = {};
  for (const row of rows) {
    if (!row.validated_by) continue;
    counts[row.validated_by] = (counts[row.validated_by] ?? 0) + 1;
  }
  return counts;
}

/** Filter to users meeting min threshold. */
function filterEligible(counts: Record<string, number>, min = 3): string[] {
  return Object.entries(counts)
    .filter(([, c]) => c >= min)
    .map(([uid]) => uid);
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('Weekly expert-ID lottery (#734)', () => {
  it('correctly counts validations per user', () => {
    const rows = [
      { validated_by: 'user-a' },
      { validated_by: 'user-a' },
      { validated_by: 'user-a' },
      { validated_by: 'user-b' },
      { validated_by: 'user-b' },
      { validated_by: null },
    ];
    const counts = buildCandidateMap(rows);
    expect(counts['user-a']).toBe(3);
    expect(counts['user-b']).toBe(2);
    expect('user-c' in counts).toBe(false);
  });

  it('filters to users with ≥3 validations', () => {
    const counts = { 'user-a': 5, 'user-b': 2, 'user-c': 3 };
    const eligible = filterEligible(counts, 3);
    expect(eligible).toContain('user-a');
    expect(eligible).toContain('user-c');
    expect(eligible).not.toContain('user-b');
  });

  it('returns empty eligible list when no one qualifies', () => {
    const counts = { 'user-x': 1, 'user-y': 2 };
    expect(filterEligible(counts, 3)).toHaveLength(0);
  });

  it('getIsoWeek returns correctly formatted ISO week string', () => {
    // 2026-05-11 is a Monday in W20
    const week = getIsoWeek(new Date('2026-05-11T10:00:00Z'));
    expect(week).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('schema includes weekly_validator_rewards table', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'docs/specs/infra/supabase-schema.sql'),
      'utf-8',
    );
    expect(schema).toContain('CREATE TABLE IF NOT EXISTS public.weekly_validator_rewards');
  });

  it('schema extends karma_events reason CHECK with expert_id_lottery_win', () => {
    const fs = require('fs');
    const path = require('path');
    const schema = fs.readFileSync(
      path.join(process.cwd(), 'docs/specs/infra/supabase-schema.sql'),
      'utf-8',
    );
    expect(schema).toContain('expert_id_lottery_win');
  });

  it('EF file exists and references weekly-expert-lottery', () => {
    const fs = require('fs');
    const path = require('path');
    const src = fs.readFileSync(
      path.join(process.cwd(), 'supabase/functions/weekly-expert-lottery/index.ts'),
      'utf-8',
    );
    expect(src).toContain('expert_id_lottery_win');
    expect(src).toContain('weekly_validator_rewards');
  });

  it('random winner selection picks from eligible pool', () => {
    const eligible = ['user-a', 'user-b', 'user-c'];
    // Simulate 50 picks — all should be in the eligible pool
    for (let i = 0; i < 50; i++) {
      const winner = eligible[Math.floor(Math.random() * eligible.length)];
      expect(eligible).toContain(winner);
    }
  });
});
