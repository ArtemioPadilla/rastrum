import { describe, it, expect } from 'vitest';
import { evaluateExpertEligibility } from '../../src/lib/expert';

const THRESHOLD = { species: 50, taxa: 5 };

describe('evaluateExpertEligibility', () => {
  it('returns qualifies when thresholds are met', () => {
    const result = evaluateExpertEligibility(
      { species_count: 60, is_expert: false, expert_application_status: null },
      { taxon_count: 6 },
    );
    expect(result.qualifies).toBe(true);
    expect(result.reason).toBe('qualifies');
    expect(result.threshold).toEqual(THRESHOLD);
  });

  it('returns already-expert when user is already an expert', () => {
    const result = evaluateExpertEligibility(
      { species_count: 100, is_expert: true, expert_application_status: null },
      { taxon_count: 10 },
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('already-expert');
  });

  it('returns pending when application is pending', () => {
    const result = evaluateExpertEligibility(
      { species_count: 60, is_expert: false, expert_application_status: 'pending' },
      { taxon_count: 6 },
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('pending');
  });

  it('returns pending when application is approved (not yet is_expert)', () => {
    const result = evaluateExpertEligibility(
      { species_count: 60, is_expert: false, expert_application_status: 'approved' },
      { taxon_count: 6 },
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('pending');
  });

  it('returns low-species when species_count is below threshold', () => {
    const result = evaluateExpertEligibility(
      { species_count: 20, is_expert: false, expert_application_status: null },
      { taxon_count: 6 },
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('low-species');
    expect(result.speciesCount).toBe(20);
  });

  it('returns low-taxa when taxon_count is below threshold', () => {
    const result = evaluateExpertEligibility(
      { species_count: 60, is_expert: false, expert_application_status: null },
      { taxon_count: 3 },
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('low-taxa');
    expect(result.taxonCount).toBe(3);
  });

  it('handles null/undefined inputs gracefully', () => {
    const result = evaluateExpertEligibility(
      { species_count: null, is_expert: null, expert_application_status: null },
      { taxon_count: null },
    );
    expect(result.qualifies).toBe(false);
    expect(result.reason).toBe('low-species');
    expect(result.speciesCount).toBe(0);
    expect(result.taxonCount).toBe(0);
  });
});
