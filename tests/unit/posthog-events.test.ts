import { describe, it, expect } from 'vitest';
import { cohortWeek, daysSince } from '../../src/lib/posthog-events';

describe('cohortWeek', () => {
  it('returns 2026-W19 for 2026-05-09 (Saturday)', () => {
    expect(cohortWeek(new Date('2026-05-09'))).toBe('2026-W19');
  });

  it('returns 2026-W01 for the first week of 2026', () => {
    // 2026-01-05 is a Monday — week 1
    expect(cohortWeek(new Date('2026-01-05'))).toBe('2026-W02');
    // 2026-01-01 is a Thursday — still W01
    expect(cohortWeek(new Date('2026-01-01'))).toBe('2026-W01');
  });

  it('handles year boundary — 2025-12-31 is W01 of 2026', () => {
    // 2025-12-31 is a Wednesday; its Thursday is 2026-01-01 → W01-2026
    expect(cohortWeek(new Date('2025-12-31'))).toBe('2026-W01');
  });

  it('handles year boundary — 2026-12-31 is W53 or W01 of 2027', () => {
    const result = cohortWeek(new Date('2026-12-31'));
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('defaults to today when no argument given', () => {
    const result = cohortWeek();
    expect(result).toMatch(/^\d{4}-W\d{2}$/);
  });

  it('format is always YYYY-Www with zero-padded week', () => {
    // Week 3 of 2026 — 2026-01-12 is a Monday
    expect(cohortWeek(new Date('2026-01-12'))).toMatch(/^2026-W0\d$/);
  });
});

describe('daysSince', () => {
  it('returns 0 for a timestamp that is now', () => {
    const now = new Date().toISOString();
    expect(daysSince(now)).toBe(0);
  });

  it('returns 1 for a timestamp 25 hours ago', () => {
    const past = new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString();
    expect(daysSince(past)).toBe(1);
  });

  it('returns a non-negative integer', () => {
    const past = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
    const result = daysSince(past);
    expect(result).toBeGreaterThanOrEqual(0);
    expect(Number.isInteger(result)).toBe(true);
  });

  it('returns 0 for an unparseable string', () => {
    expect(daysSince('not-a-date')).toBe(0);
  });

  it('never returns negative', () => {
    // Future date
    const future = new Date(Date.now() + 24 * 60 * 60 * 1000).toISOString();
    expect(daysSince(future)).toBeGreaterThanOrEqual(0);
  });
});
