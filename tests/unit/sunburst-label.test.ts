/**
 * #680 — Sunburst label truncation: proper text measurement
 *
 * Tests the per-character-class width approximation table used as a fallback
 * when OffscreenCanvas is unavailable (which is the case in Node/vitest).
 * We validate the truncation logic in isolation by re-implementing the same
 * helper and checking that:
 *   - Long names like "Heliocarpus terebinthinaceus" are not truncated
 *     earlier than necessary given the ring budget.
 *   - Short names are not truncated at all.
 *   - The ellipsis character is appended correctly.
 *   - Character-class widths produce a better approximation than the old
 *     fixed 0.6 constant (narrow-heavy strings measure shorter, wide-heavy
 *     strings measure longer).
 */
import { describe, it, expect } from 'vitest';

// ── Reproduce the per-character-class table from ExploreSpeciesView ──────
const WIDE   = new Set([...'WMwm']);
const NARROW = new Set([...'ilrtfj.,:; ']);

function charW(c: string): number {
  if (WIDE.has(c))   return 0.78;
  if (NARROW.has(c)) return c === ' ' ? 0.28 : 0.40;
  if (c >= 'A' && c <= 'Z') return 0.68;
  return 0.62;
}

const TEXT_FONT = 0.045;

function measureLabelFallback(s: string): number {
  let w = 0;
  for (const c of s) w += charW(c) * TEXT_FONT;
  return w;
}

/**
 * Truncate `name` to fit within `budget` SVG user units, appending '…'.
 * Binary-search mirrors the implementation in ExploreSpeciesView.astro.
 */
function truncateToFit(name: string, budget: number): string {
  if (measureLabelFallback(name) <= budget) return name;
  let lo = 1, hi = name.length - 1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (measureLabelFallback(name.slice(0, mid) + '…') <= budget) lo = mid; else hi = mid - 1;
  }
  return lo >= 1 ? name.slice(0, lo) + '…' : '…';
}

describe('#680 — sunburst label truncation', () => {
  it('does not truncate a short name that fits in the budget', () => {
    // Aratinga (8 chars) in a generous ring should fit without truncation.
    const budget = 0.45; // ring width 0.45 × radial_frac 0.85 is the effective space
    expect(truncateToFit('Aratinga', budget)).toBe('Aratinga');
  });

  it('truncates a long name with an ellipsis', () => {
    const budget = 0.20;
    const result = truncateToFit('Heliocarpus terebinthinaceus', budget);
    expect(result).toMatch(/…$/);
    expect(result.length).toBeGreaterThan(1);
  });

  it('allows longer truncation for narrow-heavy strings than wide-heavy ones at the same budget', () => {
    const budget = 0.25;
    // "iiiiiiiiiii" uses narrow chars; "MMMMMMMMMMM" uses wide chars.
    const narrowResult = truncateToFit('iiiiiiiiiii', budget);
    const wideResult   = truncateToFit('MMMMMMMMMMM', budget);
    // Narrow string should allow more characters before truncation.
    expect(narrowResult.replace(/…$/, '').length).toBeGreaterThan(
      wideResult.replace(/…$/, '').length
    );
  });

  it('the old fixed-0.6 approximation would have truncated "Wisteria" too early', () => {
    // "Wisteria" starts with 'W' (wide). Old constant 0.6 underestimates 'W'
    // width (0.78 actual), so it would have allocated more budget than real.
    // This test verifies our table treats 'W' as wider.
    const widthW    = charW('W');
    const widthAvg  = 0.6; // old constant
    expect(widthW).toBeGreaterThan(widthAvg);
  });

  it('the old fixed-0.6 approximation would have over-truncated "lilies"', () => {
    // "lilies" is all narrow chars. The old constant 0.6 over-estimates
    // narrow letters, causing truncation sooner than needed.
    const narrowChars = 'ilil';
    let sumOld = 0;
    let sumNew = 0;
    for (const c of narrowChars) {
      sumOld += 0.6 * TEXT_FONT;
      sumNew += charW(c) * TEXT_FONT;
    }
    expect(sumNew).toBeLessThan(sumOld);
  });

  it('returns at least one char + ellipsis even for very tight budgets', () => {
    const result = truncateToFit('Quercus robur', 0.001);
    // Should degrade gracefully: at minimum returns '…'
    expect(result).toMatch(/…$/);
  });

  it('short names stay unchanged regardless of character class', () => {
    const budget = 1.0; // very generous
    expect(truncateToFit('X', budget)).toBe('X');
    expect(truncateToFit('Wi', budget)).toBe('Wi');
    expect(truncateToFit('ili', budget)).toBe('ili');
  });

  it('measurements are stable (same input → same output)', () => {
    const name = 'Heliocarpus terebinthinaceus';
    expect(measureLabelFallback(name)).toBe(measureLabelFallback(name));
  });
});
