/**
 * Pure helpers for the OnboardingTour spotlight target resolution.
 *
 * Extracted from `src/components/OnboardingTour.astro` (issue #1160) so
 * the display-filtering rule can be unit-tested. `resolveFirstVisible`
 * preserves the comma-separated fallback semantics of the original code
 * but skips elements whose ancestor chain has `display:none` — those
 * elements report `getBoundingClientRect()` as 0×0 and the spotlight
 * ring would otherwise land at the viewport corner. `visibility:hidden`
 * is intentionally NOT filtered here: such elements still occupy layout,
 * so spotlighting them is geometrically valid even if unusual.
 */

export function isDisplayed(el: Element): boolean {
  // Walk the ancestor chain — `offsetParent === null` is the standard browser
  // idiom but happy-dom does not implement it; getComputedStyle is portable.
  let cur: Element | null = el;
  while (cur) {
    if (getComputedStyle(cur).display === 'none') return false;
    cur = cur.parentElement;
  }
  return true;
}

export function resolveFirstVisible(selector: string): Element | null {
  const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
  for (const sel of parts) {
    const el = document.querySelector(sel);
    if (el && isDisplayed(el)) return el;
  }
  return null;
}
