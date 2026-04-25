import { test, expect } from '@playwright/test';

test.describe('navigation', () => {
  test('header nav links resolve (en)', async ({ page }) => {
    await page.goto('/en/');

    // Click "Observe" — link is in main nav (desktop) and mobile menu.
    // We don't try to be clever; pick the first visible match.
    const observeLink = page.locator('a[href="/en/observe/"]').first();
    await observeLink.click();
    await expect(page).toHaveURL(/\/en\/observe\/?$/);
    await expect(page.locator('h1')).toBeVisible();
  });

  test('language switcher swaps locale', async ({ page }) => {
    await page.goto('/en/about/');
    // The header has a single ES/EN toggle button rendered as a link.
    const altLink = page.getByRole('link', { name: /^ES$/ });
    await expect(altLink).toBeVisible();
    await altLink.click();
    await expect(page).toHaveURL(/\/es\/acerca\/?$/);
  });

  test('language switcher preserves docs section', async ({ page }) => {
    await page.goto('/en/docs/vision/');
    const altLink = page.getByRole('link', { name: /^ES$/ });
    await altLink.click();
    await expect(page).toHaveURL(/\/es\/docs\/vision\/?$/);
  });

  test('docs dropdown reveals doc pages', async ({ page }) => {
    await page.goto('/en/');
    await page.getByRole('button', { name: /^Docs/i }).click();
    // The dropdown menu links to /en/docs/. Just assert the menu opens.
    const menuLink = page.locator('#docs-dropdown-menu a[href="/en/docs/"]');
    await expect(menuLink).toBeVisible();
  });
});
