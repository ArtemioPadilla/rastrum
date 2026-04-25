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

test('opening mobile menu shows nav items', async ({ page }) => {
  await page.goto('/en/');
  await page.locator('#mobile-menu-toggle').click();
  const menu = page.locator('#mobile-menu');
  // Note: the menu retains the `sm:hidden` utility class even when open
  // (it should hide on >=sm). We assert visibility instead of class state.
  await expect(menu).toBeVisible();
  await expect(menu.getByRole('link', { name: /Observe/i }).first()).toBeVisible();
});
