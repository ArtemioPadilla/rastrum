/**
 * Tests for percentile sub-cohort scope helpers added in #805.
 *
 * Covers:
 * 1. getCohortLabel returns country label for scope='country'
 * 2. getCohortLabel returns state label for scope='state'
 * 3. getCohortLabel handles missing cohort_state gracefully
 * 4. loadPercentilesForScope exists as a function (smoke)
 * 5. hasSufficientCohort threshold applies equally to state cohort
 * 6. buildCards still works correctly with the extended PercentilePayload
 */

import { describe, it, expect } from 'vitest';
import {
  getCohortLabel,
  hasSufficientCohort,
  buildCards,
  loadPercentilesForScope,
  MIN_COHORT_N,
  type PercentilePayload,
} from '../../src/lib/percentile';

const basePayload: PercentilePayload = {
  user_id: 'u1',
  cohort_country: 'MX',
  cohort_n: 120,
  computed_at: '2026-05-11T00:00:00Z',
  diversity_pctl: 73,
  habitats_pctl: 45,
  validations_pctl: 60,
  spread_pctl: 30,
  diversity_value: 2.1,
  habitats_value: 4,
  validations_value: 10,
  spread_value: 500,
};

describe('getCohortLabel – country scope', () => {
  it('returns "México" in ES for MX country scope', () => {
    const p: PercentilePayload = { ...basePayload, scope: 'country' };
    expect(getCohortLabel(p, 'es')).toBe('México');
  });

  it('returns "Mexico" in EN for MX country scope', () => {
    const p: PercentilePayload = { ...basePayload, scope: 'country' };
    expect(getCohortLabel(p, 'en')).toBe('Mexico');
  });

  it('falls back to country code when scope is undefined', () => {
    const p: PercentilePayload = { ...basePayload };
    expect(getCohortLabel(p, 'en')).toBe('Mexico');
  });

  it('shows the country code for non-MX countries', () => {
    const p: PercentilePayload = { ...basePayload, cohort_country: 'BR' };
    expect(getCohortLabel(p, 'en')).toBe('BR');
    expect(getCohortLabel(p, 'es')).toBe('BR');
  });
});

describe('getCohortLabel – state scope', () => {
  it('returns the region_primary value for state scope', () => {
    const p: PercentilePayload = {
      ...basePayload,
      scope: 'state',
      cohort_state: 'Oaxaca',
    };
    expect(getCohortLabel(p, 'es')).toBe('Oaxaca');
    expect(getCohortLabel(p, 'en')).toBe('Oaxaca');
  });

  it('falls back to country label when cohort_state is null', () => {
    const p: PercentilePayload = {
      ...basePayload,
      scope: 'state',
      cohort_state: null,
    };
    expect(getCohortLabel(p, 'es')).toBe('México');
  });

  it('falls back to country label when cohort_state is undefined', () => {
    const p: PercentilePayload = {
      ...basePayload,
      scope: 'state',
      // cohort_state omitted
    };
    expect(getCohortLabel(p, 'en')).toBe('Mexico');
  });
});

describe('hasSufficientCohort – state cohort threshold', () => {
  it('applies the same MIN_COHORT_N threshold for state cohorts', () => {
    // State cohorts are often smaller — threshold is the same by design (#805)
    expect(hasSufficientCohort(MIN_COHORT_N - 1)).toBe(false);
    expect(hasSufficientCohort(MIN_COHORT_N)).toBe(true);
  });

  it('returns false for very small state cohorts', () => {
    expect(hasSufficientCohort(5)).toBe(false);
  });
});

describe('buildCards – works with extended PercentilePayload', () => {
  it('builds 4 cards from a state-scoped payload', () => {
    const p: PercentilePayload = {
      ...basePayload,
      scope: 'state',
      cohort_state: 'CDMX',
      cohort_n: 80,
    };
    const cards = buildCards(p);
    expect(cards).toHaveLength(4);
    expect(cards.map(c => c.metric)).toEqual([
      'diversity', 'habitats', 'validations', 'spread',
    ]);
  });

  it('emits correct percentile labels for state cohort', () => {
    const p: PercentilePayload = {
      ...basePayload,
      scope: 'state',
      cohort_state: 'Jalisco',
      cohort_n: 60,
      diversity_pctl: 90,
      habitats_pctl: 10,
    };
    const cards = buildCards(p);
    const byMetric = Object.fromEntries(cards.map(c => [c.metric, c]));
    expect(byMetric.diversity.pctlLabel).toBe('90');
    expect(byMetric.habitats.pctlLabel).toBe('10');
  });
});

describe('loadPercentilesForScope – function exists', () => {
  it('is exported as a function', () => {
    expect(typeof loadPercentilesForScope).toBe('function');
  });
});
