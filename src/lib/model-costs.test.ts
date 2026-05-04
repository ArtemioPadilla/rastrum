import { describe, it, expect } from 'vitest';
import { getCostForModel, formatCostBadge, MODEL_COSTS } from './model-costs';

describe('getCostForModel', () => {
  it('returns correct info for a known model', () => {
    const info = getCostForModel('claude-haiku-4-5');
    expect(info).toBeDefined();
    expect(info!.provider).toBe('anthropic');
    expect(info!.costPer100Calls).toBe(0.30);
    expect(info!.label).toBe('Claude Haiku 4.5');
  });

  it('returns correct info for each model in the list', () => {
    for (const entry of MODEL_COSTS) {
      const result = getCostForModel(entry.model);
      expect(result).toBe(entry);
    }
  });

  it('returns undefined for an unknown model', () => {
    expect(getCostForModel('unknown-model-xyz')).toBeUndefined();
  });

  it('returns undefined for an empty string', () => {
    expect(getCostForModel('')).toBeUndefined();
  });
});

describe('formatCostBadge', () => {
  it('returns Budget badge for costs below $0.50 (en)', () => {
    expect(formatCostBadge(0.10, 'en')).toBe('💚 Budget');
    expect(formatCostBadge(0.30, 'en')).toBe('💚 Budget');
    expect(formatCostBadge(0.49, 'en')).toBe('💚 Budget');
  });

  it('returns Económico badge for costs below $0.50 (es)', () => {
    expect(formatCostBadge(0.10, 'es')).toBe('💚 Económico');
    expect(formatCostBadge(0.30, 'es')).toBe('💚 Económico');
  });

  it('returns Moderate badge for costs between $0.50 and $2.00 (en)', () => {
    expect(formatCostBadge(0.50, 'en')).toBe('💛 Moderate');
    expect(formatCostBadge(1.50, 'en')).toBe('💛 Moderate');
    expect(formatCostBadge(1.99, 'en')).toBe('💛 Moderate');
  });

  it('returns Moderado badge for costs between $0.50 and $2.00 (es)', () => {
    expect(formatCostBadge(0.70, 'es')).toBe('💛 Moderado');
    expect(formatCostBadge(1.80, 'es')).toBe('💛 Moderado');
  });

  it('returns Premium badge for costs >= $2.00 (en)', () => {
    expect(formatCostBadge(2.00, 'en')).toBe('🔶 Premium');
    expect(formatCostBadge(9.00, 'en')).toBe('🔶 Premium');
  });

  it('returns Premium badge for costs >= $2.00 (es)', () => {
    expect(formatCostBadge(2.00, 'es')).toBe('🔶 Premium');
    expect(formatCostBadge(9.00, 'es')).toBe('🔶 Premium');
  });

  it('handles zero cost as Budget', () => {
    expect(formatCostBadge(0, 'en')).toBe('💚 Budget');
    expect(formatCostBadge(0, 'es')).toBe('💚 Económico');
  });
});
