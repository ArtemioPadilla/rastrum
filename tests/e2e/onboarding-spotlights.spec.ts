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
