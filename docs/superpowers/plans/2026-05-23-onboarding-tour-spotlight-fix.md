# Onboarding Tour Spotlight Fix Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Fix the 4 of 7 onboarding tour spotlight steps that fail on the default homepage (issue [#1160](https://github.com/ArtemioPadilla[/](https://github.com/ArtemioPadilla)rastrum/issues/1160)) by (a) filtering hidden elements out of `resolveTarget`, (b) adding the 4 missing `data-tour` attributes to existing UI elements, and (c) adding a Playwright regression spec that catches both classes of failure.

**Architecture:** Extract `OnboardingTour.astro`'s inline `resolveTarget` into a pure `src/lib/onboarding-target.ts` helper that filters elements by `offsetParent !== null` (the standard visibility check that catches all `display:none` ancestors). Unit-test the helper directly in vitest+happy-dom; add the missing `data-tour="explore-nav"`, `data-tour="explore-tab"`, `data-tour="profile-tab"`, and `data-tour="avatar-btn"` attributes to `Header.astro`, `MobileBottomBar.astro`, and `MegaMenu.astro` (via a new optional prop). Write the e2e regression spec **first** (RED) so each subsequent task moves it incrementally toward GREEN.

**Tech Stack:** Astro 5 + TypeScript, vitest + happy-dom for unit tests, Playwright (chromium project) for e2e.

---

## File Structure

**Create:**
- `src/lib/onboarding-target.ts` — pure helpers `isElementVisible(el)` + `resolveFirstVisible(selector, doc?)`. ~25 LOC.
- `tests/unit/onboarding-target.test.ts` — 5 unit tests covering empty selector, visible match, hidden first / visible second fallback, all-hidden, and direct visibility check.
- `tests/e2e/onboarding-spotlights.spec.ts` — Playwright spec asserting spotlight ring lands on a real visible element for steps 1, 2, and 4 (steps 0/3/5 are intentionally center-positioned; step 6 requires signed-in state and is covered by manual verification + the unit test of the helper).

**Modify:**
- `src/components/OnboardingTour.astro` (lines 213–298, the `<script>` block): import + use the new helper instead of the inline `resolveTarget`.
- `src/components/MegaMenu.astro` (lines 19–74): add optional `dataTour?: string` prop, forward to the trigger button as `data-tour={dataTour}`.
- `src/components/Header.astro`: add `dataTour="explore-nav"` to the Explore `<MegaMenu>` (line 164–172) and `data-tour="avatar-btn"` to the avatar `<button>` at line 229.
- `src/components/MobileBottomBar.astro`: add `data-tour="explore-tab"` to the Discover tab at line 85 (keep the existing `data-tour="discover-tab"` for backward compat) and `data-tour="profile-tab"` to the Profile tab starting at line 89.

---

## Task 1: Add Playwright regression spec (RED)

**Files:**
- Create: `tests/e2e/onboarding-spotlights.spec.ts`

This task lands the test in a red state — it will fail against the current code on `main`. Tasks 2 and 3 turn it green incrementally.

- [ ] **Step 1: Write the failing e2e spec**

Create `tests/e2e/onboarding-spotlights.spec.ts`:

```ts
import { test, expect, type Page } from '@playwright/test';

/**
 * Regression for issue #1160 — the spotlight tour was matching hidden
 * `data-tour="fab"` ancestors on desktop and falling through to selectors
 * that did not exist for Explore / Settings. This spec drives the
 * `rastrum:replay-onboarding` event (which bypasses the signed-in gate
 * via lines 682-689 of OnboardingTour.astro) and asserts that every
 * non-center step lands the ring on a real, on-viewport element.
 *
 * Coverage: steps 1, 2, 4 on the chromium (desktop) project against the
 * anon homepage. Step 6 (avatar) requires a signed-in session and is
 * covered by manual verification + the helper's unit tests. Mobile
 * coverage is manual — the mobile bottom bar's FAB lives inside
 * `#mbb-authed` which only renders for signed-in users.
 */
test.describe('Onboarding tour spotlights', () => {
  async function readRing(page: Page) {
    return await page.evaluate(() => {
      const r = document.getElementById('onb-spotlight-ring');
      if (!r) return { found: false } as const;
      const rect = r.getBoundingClientRect();
      return {
        found: true as const,
        hidden: r.classList.contains('hidden'),
        x: rect.x,
        y: rect.y,
        w: rect.width,
        h: rect.height,
      };
    });
  }

  test.beforeEach(async ({ page }) => {
    await page.goto('/en/');
    await page.waitForLoadState('domcontentloaded');
    await page.waitForSelector('#onboarding-tour', { state: 'attached' });
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding'));
    });
    await page.waitForSelector('#onboarding-tour:not(.hidden)');
    // Welcome step has no spotlight by design — click Start to advance to step 1.
    await page.locator('#onb-next').click();
  });

  test('step 1 lands on a visible element, not the viewport corner', async ({ page }) => {
    const ring = await readRing(page);
    expect(ring.found).toBe(true);
    if (!ring.found) return;
    expect(ring.hidden).toBe(false);
    // Failure mode was rect (-8, -8, 16, 16). A real target is > 24px wide
    // (smallest button is ~44px) and positioned at positive coords.
    expect(ring.w).toBeGreaterThan(24);
    expect(ring.x).toBeGreaterThan(0);
    expect(ring.y).toBeGreaterThan(0);
  });

  test('step 2 lands on a visible element', async ({ page }) => {
    await page.locator('#onb-next').click(); // → step 2
    const ring = await readRing(page);
    expect(ring.found).toBe(true);
    if (!ring.found) return;
    expect(ring.hidden).toBe(false);
    expect(ring.w).toBeGreaterThan(24);
    expect(ring.x).toBeGreaterThan(0);
    expect(ring.y).toBeGreaterThan(0);
  });

  test('step 4 (Explore) lands on a visible element', async ({ page }) => {
    await page.locator('#onb-next').click(); // → step 2
    await page.locator('#onb-next').click(); // → step 3 (demo, center)
    await page.locator('#onb-next').click(); // → step 4 (Explore)
    const ring = await readRing(page);
    expect(ring.found).toBe(true);
    if (!ring.found) return;
    expect(ring.hidden).toBe(false);
    expect(ring.w).toBeGreaterThan(24);
    expect(ring.x).toBeGreaterThan(0);
    expect(ring.y).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run the spec to verify it fails on main**

Run:

```bash
npx playwright test tests/e2e/onboarding-spotlights.spec.ts --project=chromium
```

Expected: 3 failures. Each test fails on either `expect(ring.w).toBeGreaterThan(24)` (steps 1, 2 — ring is `16` because FAB is hidden) or `expect(ring.hidden).toBe(false)` (step 4 — selectors don't exist, ring is hidden).

- [ ] **Step 3: Commit the failing test**

```bash
git add tests/e2e/onboarding-spotlights.spec.ts
git commit -m "test(onboarding): regression spec for spotlight tour failures (#1160)"
```

---

## Task 2: Pure visibility helper + wire into OnboardingTour (GREEN for steps 1, 2)

**Files:**
- Create: `src/lib/onboarding-target.ts`
- Create: `tests/unit/onboarding-target.test.ts`
- Modify: `src/components/OnboardingTour.astro` (lines 213–214 imports, lines 290–298 function body)

- [ ] **Step 1: Write the failing unit tests**

Create `tests/unit/onboarding-target.test.ts`:

```ts
import { describe, it, expect, beforeEach } from 'vitest';
import { isElementVisible, resolveFirstVisible } from '../../src/lib/onboarding-target';

describe('isElementVisible', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('returns true for an element rendered in the DOM', () => {
    const el = document.createElement('div');
    el.id = 'visible';
    document.body.appendChild(el);
    expect(isElementVisible(el)).toBe(true);
  });

  it('returns false when an ancestor is display:none', () => {
    const parent = document.createElement('nav');
    parent.style.display = 'none';
    const child = document.createElement('a');
    parent.appendChild(child);
    document.body.appendChild(parent);
    expect(isElementVisible(child)).toBe(false);
  });
});

describe('resolveFirstVisible', () => {
  beforeEach(() => { document.body.innerHTML = ''; });

  it('returns null when no parts match anything in the DOM', () => {
    expect(resolveFirstVisible('[data-tour="ghost"]')).toBeNull();
  });

  it('returns the element when a single selector matches and is visible', () => {
    const el = document.createElement('a');
    el.setAttribute('data-tour', 'observe-nav');
    document.body.appendChild(el);
    expect(resolveFirstVisible('[data-tour="observe-nav"]')).toBe(el);
  });

  it('falls through to second selector when first matches a hidden element', () => {
    // Mirrors the production bug: FAB inside a `sm:hidden` parent on desktop.
    const hiddenParent = document.createElement('nav');
    hiddenParent.style.display = 'none';
    const fab = document.createElement('a');
    fab.setAttribute('data-tour', 'fab');
    hiddenParent.appendChild(fab);
    document.body.appendChild(hiddenParent);

    const visibleNav = document.createElement('a');
    visibleNav.setAttribute('data-tour', 'observe-nav');
    document.body.appendChild(visibleNav);

    const out = resolveFirstVisible('[data-tour="fab"],[data-tour="observe-nav"]');
    expect(out).toBe(visibleNav);
  });

  it('returns null when first matches a hidden element and second does not match', () => {
    const hiddenParent = document.createElement('nav');
    hiddenParent.style.display = 'none';
    const fab = document.createElement('a');
    fab.setAttribute('data-tour', 'fab');
    hiddenParent.appendChild(fab);
    document.body.appendChild(hiddenParent);

    expect(resolveFirstVisible('[data-tour="fab"],[data-tour="observe-nav"]')).toBeNull();
  });
});
```

- [ ] **Step 2: Run unit tests to verify they fail**

```bash
npx vitest run tests/unit/onboarding-target.test.ts
```

Expected: all 6 tests fail with "Cannot find module '../../src/lib/onboarding-target'".

- [ ] **Step 3: Implement the helper**

Create `src/lib/onboarding-target.ts`:

```ts
/**
 * Pure helpers for the OnboardingTour spotlight target resolution.
 *
 * Extracted from `src/components/OnboardingTour.astro` (issue #1160) so
 * the visibility-filtering rule can be unit-tested. `resolveFirstVisible`
 * preserves the comma-separated fallback semantics of the original code
 * but skips elements whose ancestor chain renders them un-measurable —
 * `getBoundingClientRect()` would otherwise return 0×0 and the spotlight
 * ring would land at the viewport corner.
 */

export function isElementVisible(el: Element): boolean {
  return (el as HTMLElement).offsetParent !== null;
}

export function resolveFirstVisible(
  selector: string,
  doc: Pick<Document, 'querySelector'> = document,
): Element | null {
  const parts = selector.split(',').map((s) => s.trim()).filter(Boolean);
  for (const sel of parts) {
    const el = doc.querySelector(sel);
    if (el && isElementVisible(el)) return el;
  }
  return null;
}
```

- [ ] **Step 4: Run unit tests to verify they pass**

```bash
npx vitest run tests/unit/onboarding-target.test.ts
```

Expected: all 6 tests pass.

- [ ] **Step 5: Wire the helper into OnboardingTour.astro**

In `src/components/OnboardingTour.astro`, find the existing import on line 214 and add the new one:

```ts
  import { getCachedUser, getSupabase } from '../lib/supabase';
  import { resolveFirstVisible } from '../lib/onboarding-target';
```

Then replace the `resolveTarget` body (currently lines 290–298):

```ts
  function resolveTarget(selector: string | null): Element | null {
    if (!selector) return null;
    const parts = selector.split(',').map(s => s.trim());
    for (const sel of parts) {
      const el = document.querySelector(sel);
      if (el) return el;
    }
    return null;
  }
```

…with the thin wrapper:

```ts
  function resolveTarget(selector: string | null): Element | null {
    if (!selector) return null;
    return resolveFirstVisible(selector);
  }
```

- [ ] **Step 6: Run typecheck + unit tests + the partial e2e**

```bash
npx tsc --noEmit
npx vitest run tests/unit/onboarding-target.test.ts
npx playwright test tests/e2e/onboarding-spotlights.spec.ts --project=chromium
```

Expected:
- `tsc`: zero errors.
- vitest: 6/6 pass.
- Playwright: **step 1 passes** (now falls through to visible `observe-nav`), **step 2 passes** (no fallback; falls through to nothing → `resolveTarget` returns null → tooltip centers but ring stays hidden, satisfying `ring.hidden===true` would *fail*… see Note below). **Step 4 still fails** because the selectors don't exist yet.

> **Note on step 2:** the only selector is `[data-tour="fab"]` (no fallback). When the helper filters it out as hidden, `resolveTarget` returns null and the tour positions the tooltip centered with `ring.hidden=true`. The current e2e expects `ring.hidden===false`. This is intentional — Task 3 will not fix step 2 by adding a selector (the camera FAB legitimately doesn't exist on desktop). The cleanest resolution is to update the tour's step 2 selector to also include `[data-tour="observe-nav"]` as a desktop fallback. See Step 7.

- [ ] **Step 7: Add desktop fallback to step 2 selector**

In `src/components/OnboardingTour.astro` around lines 184–187 (the second entry in the `STEPS` JSON literal), change:

```ts
    {
      title: stepsData.quick_id.title,
      body: stepsData.quick_id.body,
      target: '[data-tour="fab"]',
    },
```

to:

```ts
    {
      title: stepsData.quick_id.title,
      body: stepsData.quick_id.body,
      target: '[data-tour="fab"],[data-tour="observe-nav"]',
    },
```

Re-run the partial e2e:

```bash
npx playwright test tests/e2e/onboarding-spotlights.spec.ts --project=chromium
```

Expected: **steps 1 and 2 pass**. Step 4 still fails (selectors not yet present).

- [ ] **Step 8: Commit**

```bash
git add src/lib/onboarding-target.ts tests/unit/onboarding-target.test.ts src/components/OnboardingTour.astro
git commit -m "fix(onboarding): filter hidden targets in resolveTarget (#1160)"
```

---

## Task 3: Add the 4 missing `data-tour` attrs (GREEN for step 4)

**Files:**
- Modify: `src/components/MegaMenu.astro` (Props interface around line 19, frontmatter destructure around line 37, button at line 56)
- Modify: `src/components/Header.astro` (the Explore MegaMenu at line 164, the avatar button at line 229)
- Modify: `src/components/MobileBottomBar.astro` (the Discover tab at line 85, the Profile tab at line 89)

- [ ] **Step 1: Teach MegaMenu to forward a `data-tour` prop**

In `src/components/MegaMenu.astro`, add `dataTour?: string;` to the `Props` interface:

```ts
interface Props {
  lang: 'en' | 'es';
  trigger: string;
  columns: Column[];
  align?: 'left' | 'right';
  active?: boolean;
  accent?: 'stone' | 'teal' | 'emerald' | 'sky';
  cols?: 2 | 3;
  /**
   * Optional onboarding-tour marker. When set, forwarded as
   * `data-tour={dataTour}` on the trigger button so the spotlight
   * helper can resolve to it.
   */
  dataTour?: string;
}
```

Add it to the destructure:

```ts
const {
  lang,
  trigger,
  columns,
  align = 'right',
  active = false,
  accent = 'stone',
  cols = 3,
  dataTour,
} = Astro.props;
```

Forward it on the button (line 56):

```astro
  <button
    id={`${id}-btn`}
    type="button"
    data-tour={dataTour}
    class:list={[
```

- [ ] **Step 2: Set the data-tour on the Explore MegaMenu in Header**

In `src/components/Header.astro` around lines 164–172, add the prop:

```astro
      <MegaMenu
        lang={locale}
        trigger={tr.nav.explore}
        columns={exploreColumns}
        align="left"
        active={expActive}
        accent="teal"
        cols={2}
        dataTour="explore-nav"
      />
```

- [ ] **Step 3: Set data-tour on the avatar button in Header**

In `src/components/Header.astro` at line 229, add `data-tour="avatar-btn"`:

```astro
        <button id="avatar-btn" data-tour="avatar-btn" aria-label="Account menu" class="block rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500">
```

- [ ] **Step 4: Add explore-tab + profile-tab in MobileBottomBar**

In `src/components/MobileBottomBar.astro` around line 82–88, update the Discover tab to carry both selectors (preserve `discover-tab` for backward compat):

```astro
    <a href={discoverPath} class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      discoverActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]} data-tour="explore-tab discover-tab">
```

Wait — `data-tour` is a single token attribute in the selectors (`[data-tour="explore-tab"]` is an exact match). Use TWO attributes via separate elements OR pick one. The pragmatic call here is to rename the attribute value to `explore-tab` and drop `discover-tab` (the tour is the only consumer; no other code references `discover-tab`). Verify before changing:

```bash
grep -rn 'data-tour="discover-tab"\|"discover-tab"' src tests --include='*.astro' --include='*.ts' --include='*.tsx'
```

Expected: only the one line in `MobileBottomBar.astro` (the declaration). If true, replace it cleanly:

```astro
    ]} data-tour="explore-tab">
```

If grep returns other references, keep both via separate markers (e.g. wrap the SVG in a `<span data-tour="discover-tab">`). For Rastrum today, only the one declaration exists.

Then add `data-tour="profile-tab"` to the Profile tab at line 89:

```astro
    <a href={profilePath} data-tour="profile-tab" class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      profActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]}>
```

- [ ] **Step 5: Run typecheck + e2e**

```bash
npx tsc --noEmit
npx playwright test tests/e2e/onboarding-spotlights.spec.ts --project=chromium
```

Expected:
- `tsc`: zero errors.
- Playwright: **all 3 tests pass** (steps 1, 2, and 4 all land on visible elements).

- [ ] **Step 6: Manual verification of step 6 + mobile breakpoint**

The e2e (Task 1) runs on the `chromium` project (desktop, anon homepage) and covers steps 1, 2, and 4. Two things need manual verification because they need a signed-in session and/or a different viewport:

**(a) Step 6 (Settings / avatar) on desktop.** The avatar button is only rendered when `#avatar-wrap` is unhidden by client auth resolution. Run the dev server and sign in:

```bash
npm run dev
# Open http://localhost:4321/en/ at >= 1280px wide, sign in.
# In the browser console:
#   window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding'))
# Click Next 6 times to reach step 7 of 7 ("Settings" / "BYO key").
```

Expected: spotlight ring is positioned over the avatar button (top-right of header). Tooltip placed below or above it. NOT at the top-left corner.

**(b) Mobile breakpoint (signed-in).** On mobile the FAB IS visible, so steps 1+2 should land on the FAB (not fall through to `observe-nav`). Open Chrome DevTools → Toggle device toolbar → pick an iPhone or 375px width, then replay the tour signed-in:

Expected:
- step 1: ring on the green FAB (center-bottom)
- step 2: ring on the FAB
- step 4: ring on the Explore tab (right of FAB)
- step 6: ring on the Profile tab (far right)
- no ring in the top-left corner at any step

- [ ] **Step 7: Run the full test suite as a smoke check**

```bash
npm run test
npm run build
```

Expected: vitest run is green (734+ tests pass, including the new 6), build emits 209+ pages with zero errors.

- [ ] **Step 8: Commit**

```bash
git add src/components/MegaMenu.astro src/components/Header.astro src/components/MobileBottomBar.astro
git commit -m "fix(onboarding): wire missing data-tour attrs for explore + profile + avatar (#1160)"
```

---

## Task 4: Open the pull request

**Files:** none (git + gh only).

- [ ] **Step 1: Push the branch and open the PR**

```bash
git push -u origin HEAD
gh pr create --base main --title "fix(onboarding): unbreak spotlight tour (#1160)" --body "$(cat <<'EOF'
## Summary

Closes #1160. Fixes 4 of 7 onboarding tour spotlight steps that have been silently broken on the default homepage.

- `resolveTarget` now filters out hidden elements (`offsetParent === null`) so the comma-separated selector fallback actually walks past invisible matches. Extracted to `src/lib/onboarding-target.ts` for unit testing.
- Added the missing `data-tour` attributes: `explore-nav` (via a new `MegaMenu` prop), `explore-tab`, `profile-tab`, `avatar-btn`.
- Tour step 2 now falls through to `observe-nav` on desktop instead of resolving to the hidden mobile-only FAB.
- New Playwright spec asserts the spotlight ring lands on a real element (rect > 24px wide, positive coords) for steps 1, 2, and 4. Steps 6 verified manually.

## Test plan

- [x] \`npx vitest run tests/unit/onboarding-target.test.ts\` — 6/6 pass.
- [x] \`npx playwright test tests/e2e/onboarding-spotlights.spec.ts --project=chromium\` — 3/3 pass.
- [x] \`npm run test\` — full suite green.
- [x] \`npm run build\` — 209+ pages emit cleanly.
- [x] Manual replay on \`/en/\` and \`/es/\` (desktop + mobile-chrome): rings land on the right elements at every non-center step.

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 2: Verify CI starts**

```bash
gh pr checks --watch
```

Expected: every required check (typecheck, vitest, db-validate, e2e, build) runs and goes green. The new e2e spec must run on the `chromium` project and pass.

---

## Out of scope (deliberately deferred)

The audit doc lists 5 more onboarding patterns (checklist, pre-permission priming, multi-intent picker, founder note, anon homepage `/identify` CTA). All are net-new features and have separate sequencing notes in [`docs/runbooks/onboarding-patterns-audit.md`](../../runbooks/onboarding-patterns-audit.md). This PR fixes the foundation; the next layer lands as separate PRs.

The 3 missing funnel events (`first_id_accepted`, `7d_return`, `30d_return`) also defer — they need a new Edge Function + cron schedule. Tracked separately in the audit doc; out of scope for this PR.
