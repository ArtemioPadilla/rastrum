import { describe, it, expect } from 'vitest';
import { buildFilterString } from '../../src/lib/photo-crop';

describe('buildFilterString — brightness/contrast', () => {
  it('returns none when both are zero', () => {
    expect(buildFilterString(0, 0)).toBe('none');
  });

  it('returns brightness filter for positive brightness', () => {
    expect(buildFilterString(50, 0)).toContain('brightness(1.500)');
  });

  it('returns contrast filter for positive contrast', () => {
    expect(buildFilterString(0, 50)).toContain('contrast(1.500)');
  });

  it('returns both filters when both non-zero', () => {
    const result = buildFilterString(10, 20);
    expect(result).toContain('brightness(1.100)');
    expect(result).toContain('contrast(1.200)');
  });
});

describe('buildFilterString — exposure', () => {
  it('returns no-op filter when all three are zero', () => {
    expect(buildFilterString(0, 0, 0)).toBe('none');
  });
  it('exposure=100 appends brightness(1.500)', () => {
    expect(buildFilterString(0, 0, 100)).toContain('brightness(1.500)');
  });
  it('exposure=-100 appends brightness(0.500)', () => {
    expect(buildFilterString(0, 0, -100)).toContain('brightness(0.500)');
  });
  it('exposure=0 does not append extra brightness', () => {
    const result = buildFilterString(10, 0, 0);
    // Should only have ONE brightness call
    expect((result.match(/brightness/g) ?? []).length).toBe(1);
  });
});
