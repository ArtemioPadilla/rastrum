import { test, expect } from '@playwright/test';

// Run only on the mobile-chrome project; smoke runs on both already.
test.beforeEach(({}, testInfo) => {
  test.skip(
    testInfo.project.name !== 'mobile-chrome',
    'mobile-chrome project only',
  );
});

const PAGES = ['/en/', '/en/observe/', '/en/docs/'];

for (const path of PAGES) {
  test(`no horizontal overflow at ${path}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('domcontentloaded');

    const overflows = await page.evaluate(() => {
      const docW = document.documentElement.scrollWidth;
      const winW = window.innerWidth;
      return { docW, winW, diff: docW - winW };
    });
    expect(
      overflows.diff,
      `horizontal scroll on ${path}: doc=${overflows.docW} win=${overflows.winW}`,
    ).toBeLessThanOrEqual(1);
  });
}

test('mobile menu toggle is reachable', async ({ page }) => {
  await page.goto('/en/');
  const toggle = page.locator('#mobile-menu-toggle');
  await expect(toggle).toBeVisible();

  const box = await toggle.boundingBox();
  expect(box, 'menu toggle has bounding box').not.toBeNull();
  // Sanity floor — current visual size is 36px (`p-2` on a 20px icon).
  // Apple HIG recommends 44px, Material 48px; treat <32 as a regression
  // and TODO(design) to bump to 44.
  expect(Math.min(box!.width, box!.height)).toBeGreaterThanOrEqual(32);
});

test('hamburger opens the mobile drawer', async ({ page }) => {
  await page.goto('/en/');
  await page.locator('#mobile-menu-toggle').click();
  await expect(page.locator('#mobile-drawer')).toBeVisible();
  await page.locator('#mobile-drawer-close').click();
  await expect(page.locator('#mobile-drawer')).toBeHidden();
});

test('mobile bottom bar — FAB target defaults to /observe', async ({ page }) => {
  await page.goto('/en/explore/map/');
  // FAB is rendered server-side inside #mbb-authed (which starts hidden until
  // auth resolves). The anchor still exists in the DOM and its href is the
  // computed observe path; that's the target we care about for this test.
  const fab = page.locator('#mobile-bottom-bar a[data-tour="fab"]');
  await expect(fab).toHaveAttribute('href', '/en/observe/');
});

test('FAB on /observe triggers camera shortcut (no badge)', async ({ page }) => {
  await page.goto('/en/observe/');
  const fab = page.locator('#mobile-bottom-bar a[data-tour="fab"]');
  await expect(fab).toHaveAttribute('href', '/en/observe/');
  await expect(fab).toHaveAttribute('data-on-observe', 'true');
  // The ⚡ badge should no longer exist.
  await expect(fab.locator('span:has-text("⚡")')).toHaveCount(0);
});
