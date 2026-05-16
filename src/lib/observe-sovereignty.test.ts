import { describe, it, expect } from 'vitest';
import { resolveSovereignty } from './observe-sovereignty';

describe('resolveSovereignty', () => {
  it('upgrade-primary when cloud arrives and observer did not act', () => {
    expect(resolveSovereignty({ observerAffirmed: false, cloudArrived: true })).toBe('upgrade-primary');
  });
  it('parallel-suggestion when cloud arrives but observer already affirmed', () => {
    expect(resolveSovereignty({ observerAffirmed: true, cloudArrived: true })).toBe('parallel-suggestion');
  });
  it('none when no cloud result has arrived (regardless of affirmation)', () => {
    expect(resolveSovereignty({ observerAffirmed: false, cloudArrived: false })).toBe('none');
    expect(resolveSovereignty({ observerAffirmed: true, cloudArrived: false })).toBe('none');
  });
});
