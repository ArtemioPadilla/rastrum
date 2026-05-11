/**
 * diversity-indices.ts — Ecological diversity index calculations (issue #196).
 *
 * Implements standard biodiversity metrics used in field ecology:
 *   - Species richness (S)
 *   - Shannon-Wiener entropy (H')
 *   - Simpson's dominance index (D)
 *   - Chao1 non-parametric richness estimator
 *   - Pielou's evenness (J')
 *
 * All functions accept an array of abundance counts (non-negative integers).
 * Zero-count entries are treated as absent species and excluded from calculations.
 */

/**
 * Species richness S — number of distinct species present.
 *
 * @param counts Array of per-species abundance counts
 * @returns Number of species with count > 0
 */
export function speciesRichness(counts: number[]): number {
  return counts.filter((n) => n > 0).length;
}

/**
 * Shannon-Wiener diversity index H'.
 *
 * H' = -Σ (p_i * ln(p_i))
 * where p_i = n_i / N (relative abundance of species i).
 *
 * Returns 0 when only one species is present or all counts are zero.
 *
 * @param counts Array of per-species abundance counts
 * @returns H' value in nats (natural log base)
 */
export function shannonWiener(counts: number[]): number {
  const present = counts.filter((n) => n > 0);
  if (present.length <= 1) return 0;

  const N = present.reduce((sum, n) => sum + n, 0);
  if (N === 0) return 0;

  return -present.reduce((sum, n) => {
    const p = n / N;
    return sum + p * Math.log(p);
  }, 0);
}

/**
 * Simpson's dominance index D.
 *
 * D = Σ (n_i * (n_i - 1)) / (N * (N - 1))
 *
 * D ranges from 0 (infinite diversity) to 1 (no diversity / single species).
 * Uses the classic "D" formulation (probability that two randomly selected
 * individuals belong to the same species).
 *
 * Returns 1 when only one species is present.
 * Returns 0 when N <= 1 (undefined; we return 0 by convention).
 *
 * @param counts Array of per-species abundance counts
 * @returns D value in [0, 1]
 */
export function simpsonsD(counts: number[]): number {
  const present = counts.filter((n) => n > 0);
  if (present.length === 0) return 0;

  const N = present.reduce((sum, n) => sum + n, 0);
  if (N <= 1) return 0;

  const numerator = present.reduce((sum, n) => sum + n * (n - 1), 0);
  return numerator / (N * (N - 1));
}

/**
 * Chao1 non-parametric species richness estimator.
 *
 * Chao1 = S_obs + (f1² / (2 * f2))
 * where:
 *   S_obs = observed species richness
 *   f1    = number of singletons (species with exactly 1 individual)
 *   f2    = number of doubletons (species with exactly 2 individuals)
 *
 * When f2 = 0 (no doubletons), the bias-corrected formula is used:
 *   Chao1 = S_obs + (f1 * (f1 - 1)) / (2 * (f2 + 1))
 *
 * Falls back to S_obs when f1 = 0.
 *
 * @param counts Array of per-species abundance counts
 * @returns Estimated total species richness (may be non-integer)
 */
export function chao1(counts: number[]): number {
  const present = counts.filter((n) => n > 0);
  const S = present.length;
  if (S === 0) return 0;

  const f1 = present.filter((n) => n === 1).length; // singletons
  const f2 = present.filter((n) => n === 2).length; // doubletons

  if (f1 === 0) return S;

  if (f2 === 0) {
    // Bias-corrected estimator when no doubletons
    return S + (f1 * (f1 - 1)) / (2 * (f2 + 1));
  }

  return S + f1 * f1 / (2 * f2);
}

/**
 * Pielou's evenness J'.
 *
 * J' = H' / ln(S)
 * where H' is Shannon-Wiener diversity and S is species richness.
 *
 * J' ranges from 0 (maximum unevenness) to 1 (perfect evenness).
 * Returns 0 when S <= 1 (ln(1) = 0, undefined; convention is 0).
 *
 * @param counts Array of per-species abundance counts
 * @returns J' value in [0, 1]
 */
export function pielouJ(counts: number[]): number {
  const S = speciesRichness(counts);
  if (S <= 1) return 0;

  const H = shannonWiener(counts);
  return H / Math.log(S);
}

/**
 * Compute all diversity indices at once.
 *
 * @param counts Array of per-species abundance counts
 * @returns Object with all five indices
 */
export interface DiversityIndices {
  /** Species richness S */
  S: number;
  /** Shannon-Wiener H' (nats) */
  H: number;
  /** Simpson's dominance D */
  D: number;
  /** Chao1 richness estimator */
  chao1: number;
  /** Pielou's evenness J' */
  J: number;
}

export function computeAllIndices(counts: number[]): DiversityIndices {
  return {
    S: speciesRichness(counts),
    H: shannonWiener(counts),
    D: simpsonsD(counts),
    chao1: chao1(counts),
    J: pielouJ(counts),
  };
}
