/**
 * Unit tests for the pure helpers consumed by the nightly fetcher
 * (`scripts/fetch-gh-issue-stats.ts`) and the doc-page renderer
 * (`src/components/TriageStatusView.astro`). The math is small but
 * load-bearing — getting the median wrong in the public dashboard
 * would mis-state the project's responsiveness SLA.
 */

import { describe, it, expect } from 'vitest';
import { median, hoursBetween, round1 } from '../../src/lib/triage-stats';

describe('median', () => {
  it('returns null for an empty array', () => {
    expect(median([])).toBeNull();
  });

  it('returns the only value for a single-element array', () => {
    expect(median([42])).toBe(42);
  });

  it('returns the middle value for an odd-length array', () => {
    expect(median([1, 7, 3])).toBe(3);
  });

  it('returns the average of the two middle values for an even-length array', () => {
    expect(median([1, 2, 3, 4])).toBe(2.5);
  });

  it('does not mutate the input', () => {
    const input = [9, 1, 5, 3];
    const copy = [...input];
    median(input);
    expect(input).toEqual(copy);
  });
});

describe('hoursBetween', () => {
  it('returns the gap in hours for a normal pair', () => {
    const a = '2026-05-01T00:00:00Z';
    const b = '2026-05-02T12:00:00Z';
    expect(hoursBetween(a, b)).toBe(36);
  });

  it('returns null when the reply is before the issue', () => {
    const a = '2026-05-02T00:00:00Z';
    const b = '2026-05-01T00:00:00Z';
    expect(hoursBetween(a, b)).toBeNull();
  });

  it('returns null on unparseable input', () => {
    expect(hoursBetween('not a date', '2026-05-01T00:00:00Z')).toBeNull();
    expect(hoursBetween('2026-05-01T00:00:00Z', 'also bad')).toBeNull();
  });
});

describe('round1', () => {
  it('rounds to one decimal place', () => {
    expect(round1(38.39999)).toBe(38.4);
    expect(round1(38.35)).toBe(38.4);
    expect(round1(38)).toBe(38);
  });
});
