import { describe, it, expect } from 'vitest';

import { nextMilestone, MILESTONES } from '../../src/lib/milestones';

describe('nextMilestone', () => {
  it('returns the smallest milestone above 0', () => {
    expect(nextMilestone(0)).toBe(10);
  });

  it('returns 10 for any count under 10', () => {
    expect(nextMilestone(1)).toBe(10);
    expect(nextMilestone(9)).toBe(10);
  });

  it('returns the next milestone when sitting exactly on one', () => {
    // count=10 → 10 < 10 is false; 10 < 25 is true → returns 25.
    // This is the desired UX: hitting a milestone immediately reveals
    // the next one to aim for.
    expect(nextMilestone(10)).toBe(25);
    expect(nextMilestone(50)).toBe(100);
  });

  it('walks up through every documented milestone', () => {
    for (let i = 0; i < MILESTONES.length - 1; i += 1) {
      const here = MILESTONES[i];
      const next = MILESTONES[i + 1];
      // Just-after-this-milestone returns the next one.
      expect(nextMilestone(here + 1)).toBe(next);
    }
  });

  it('rounds up to the next 10k beyond 10000', () => {
    expect(nextMilestone(10001)).toBe(20000);
    expect(nextMilestone(15000)).toBe(20000);
    expect(nextMilestone(99999)).toBe(100000);
  });

  it('never returns a denominator <= count', () => {
    // Property: the dex card displays "{count} / {next}" — the bar would
    // overflow if next <= count. Spot-check a wide range.
    for (const c of [0, 1, 9, 10, 49, 99, 250, 999, 5001, 10000, 12345]) {
      expect(nextMilestone(c)).toBeGreaterThan(c);
    }
  });
});
