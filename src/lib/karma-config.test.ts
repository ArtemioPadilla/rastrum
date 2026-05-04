import { describe, it, expect } from 'vitest';
import { KARMA_REASONS } from './karma-config';

describe('KARMA_REASONS — pool incentive entries', () => {
  it('contains pool_donation with delta 20', () => {
    const reason = KARMA_REASONS.find((r) => r.id === 'pool_donation');
    expect(reason).toBeDefined();
    expect(reason!.delta).toBe(20);
    expect(reason!.label_en).toBe('Pool donation');
    expect(reason!.label_es).toBe('Donación a pool');
  });

  it('contains pool_call_sponsor_drip with delta 0.5', () => {
    const reason = KARMA_REASONS.find((r) => r.id === 'pool_call_sponsor_drip');
    expect(reason).toBeDefined();
    expect(reason!.delta).toBe(0.5);
    expect(reason!.label_en).toBe('Pool call (sponsor drip)');
    expect(reason!.label_es).toBe('Llamada de pool (goteo patrocinador)');
  });

  it('has unique ids across all reasons', () => {
    const ids = KARMA_REASONS.map((r) => r.id);
    expect(new Set(ids).size).toBe(ids.length);
  });
});
