/**
 * tests/unit/diversity-indices.test.ts — Tests for ecological diversity indices (issue #196).
 *
 * Uses known ecological datasets with hand-calculated expected values to verify
 * correctness of each index function.
 */
import { describe, it, expect } from 'vitest';
import {
  speciesRichness,
  shannonWiener,
  simpsonsD,
  chao1,
  pielouJ,
  computeAllIndices,
} from '../../src/lib/diversity-indices';

// Helper to check floating-point equality with tolerance
const EPSILON = 1e-6;
function approxEqual(a: number, b: number, eps = EPSILON): boolean {
  return Math.abs(a - b) < eps;
}

describe('speciesRichness (S)', () => {
  it('counts only species with abundance > 0', () => {
    expect(speciesRichness([3, 0, 5, 0, 2])).toBe(3);
  });

  it('returns 0 for empty array', () => {
    expect(speciesRichness([])).toBe(0);
  });

  it('returns 0 for all-zero array', () => {
    expect(speciesRichness([0, 0, 0])).toBe(0);
  });

  it('returns correct count when all species present', () => {
    expect(speciesRichness([1, 2, 3, 4])).toBe(4);
  });
});

describe('shannonWiener (H\')', () => {
  it('returns 0 for a single species', () => {
    expect(shannonWiener([10])).toBe(0);
  });

  it('returns 0 for empty / all-zero counts', () => {
    expect(shannonWiener([])).toBe(0);
    expect(shannonWiener([0, 0])).toBe(0);
  });

  it('returns ln(2) ≈ 0.693 for two equally abundant species', () => {
    const H = shannonWiener([5, 5]);
    expect(approxEqual(H, Math.LN2, 1e-10)).toBe(true);
  });

  it('returns ln(4) ≈ 1.386 for four equally abundant species', () => {
    const H = shannonWiener([10, 10, 10, 10]);
    expect(approxEqual(H, Math.log(4), 1e-10)).toBe(true);
  });

  it('handles uneven distributions correctly', () => {
    // p = [0.5, 0.25, 0.25] → H = -(0.5*ln0.5 + 2*0.25*ln0.25) = 1.039...
    const H = shannonWiener([20, 10, 10]);
    const expected = -(0.5 * Math.log(0.5) + 0.25 * Math.log(0.25) + 0.25 * Math.log(0.25));
    expect(approxEqual(H, expected)).toBe(true);
  });
});

describe('simpsonsD (D)', () => {
  it('returns 0 for empty / single individual', () => {
    expect(simpsonsD([])).toBe(0);
    expect(simpsonsD([1])).toBe(0);
  });

  it('returns 1 for a single dominant species with many individuals', () => {
    // single species: D = n*(n-1)/(N*(N-1)) = 100*99/(100*99) = 1.0
    expect(approxEqual(simpsonsD([100]), 1.0)).toBe(true);
  });

  it('approaches 0 for many equally abundant species', () => {
    // 100 species each with 100 individuals
    const counts = Array(100).fill(100);
    const D = simpsonsD(counts);
    expect(D).toBeLessThan(0.02);
  });

  it('returns correct value for known dataset [10, 5, 5]', () => {
    // N=20, Σn(n-1) = 10*9 + 5*4 + 5*4 = 90+20+20 = 130
    // D = 130 / (20*19) = 130/380 ≈ 0.3421
    const D = simpsonsD([10, 5, 5]);
    expect(approxEqual(D, 130 / 380)).toBe(true);
  });

  it('D is in [0, 1]', () => {
    const D = simpsonsD([3, 1, 6, 2]);
    expect(D).toBeGreaterThanOrEqual(0);
    expect(D).toBeLessThanOrEqual(1);
  });
});

describe('chao1', () => {
  it('returns 0 for empty / all-zero', () => {
    expect(chao1([])).toBe(0);
    expect(chao1([0, 0])).toBe(0);
  });

  it('returns S when no singletons', () => {
    // No f1 → Chao1 = S_obs = 3
    expect(chao1([4, 6, 8])).toBe(3);
  });

  it('uses bias-corrected formula when f2=0', () => {
    // 3 singletons, 0 doubletons: Chao1 = 3 + (3*2)/(2*1) = 3 + 3 = 6
    expect(approxEqual(chao1([1, 1, 1]), 6)).toBe(true);
  });

  it('returns correct estimate for known dataset', () => {
    // S=4, f1=2 (singletons), f2=1 (doubleton)
    // Chao1 = 4 + 2²/(2*1) = 4 + 2 = 6
    const estimate = chao1([1, 1, 2, 5]);
    expect(approxEqual(estimate, 6)).toBe(true);
  });
});

describe('pielouJ (J\')', () => {
  it('returns 0 for single species', () => {
    expect(pielouJ([10])).toBe(0);
  });

  it('returns 0 for empty / all-zero', () => {
    expect(pielouJ([])).toBe(0);
    expect(pielouJ([0, 0])).toBe(0);
  });

  it('returns 1 for perfectly even distribution', () => {
    // Equal abundances → H = ln(S) → J = 1
    const J = pielouJ([10, 10, 10, 10]);
    expect(approxEqual(J, 1.0, 1e-10)).toBe(true);
  });

  it('returns value < 1 for uneven distribution', () => {
    const J = pielouJ([90, 5, 5]);
    expect(J).toBeGreaterThan(0);
    expect(J).toBeLessThan(1);
  });

  it('J is in [0, 1]', () => {
    const J = pielouJ([3, 1, 6, 2]);
    expect(J).toBeGreaterThanOrEqual(0);
    expect(J).toBeLessThanOrEqual(1);
  });
});

describe('computeAllIndices', () => {
  it('returns all five indices in one call', () => {
    const result = computeAllIndices([5, 5, 5, 5]);
    expect(typeof result.S).toBe('number');
    expect(typeof result.H).toBe('number');
    expect(typeof result.D).toBe('number');
    expect(typeof result.chao1).toBe('number');
    expect(typeof result.J).toBe('number');
  });

  it('S matches speciesRichness', () => {
    const counts = [3, 0, 7, 2];
    expect(computeAllIndices(counts).S).toBe(speciesRichness(counts));
  });

  it('H matches shannonWiener', () => {
    const counts = [3, 0, 7, 2];
    expect(computeAllIndices(counts).H).toBe(shannonWiener(counts));
  });
});
