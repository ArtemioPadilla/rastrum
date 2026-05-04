import { describe, it, expect } from 'vitest';
import { nextMilestone, distanceToNextMilestone, KARMA_MILESTONES } from './karma-milestones';

describe('nextMilestone', () => {
  it('returns the first milestone for new users', () => {
    expect(nextMilestone(0)).toBe(100);
    expect(nextMilestone(50)).toBe(100);
    expect(nextMilestone(99)).toBe(100);
  });

  it('skips milestones already cleared', () => {
    expect(nextMilestone(100)).toBe(500);
    expect(nextMilestone(250)).toBe(500);
    expect(nextMilestone(500)).toBe(1000);
    expect(nextMilestone(999)).toBe(1000);
  });

  it('returns null past the top of the ladder', () => {
    expect(nextMilestone(5000)).toBe(null);
    expect(nextMilestone(9999)).toBe(null);
  });

  it('honours a custom ladder', () => {
    expect(nextMilestone(7, [10, 20])).toBe(10);
    expect(nextMilestone(20, [10, 20])).toBe(null);
  });
});

describe('distanceToNextMilestone', () => {
  it('returns the gap to the next milestone', () => {
    expect(distanceToNextMilestone(50)).toBe(50);
    expect(distanceToNextMilestone(99)).toBe(1);
    expect(distanceToNextMilestone(250)).toBe(250);
    expect(distanceToNextMilestone(4999)).toBe(1);
  });

  it('returns null past the top', () => {
    expect(distanceToNextMilestone(5000)).toBe(null);
  });

  it('rounds fractional totals', () => {
    expect(distanceToNextMilestone(99.4)).toBe(1);
    expect(distanceToNextMilestone(99.6)).toBe(0);
  });

  it('exposes the canonical ladder', () => {
    expect([...KARMA_MILESTONES]).toEqual([100, 500, 1000, 5000]);
  });
});
