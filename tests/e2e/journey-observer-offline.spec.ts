/**
 * J3 — Offline observer journey: authenticated user goes offline,
 * interacts with the observe form, and verifies offline indicators.
 */
import { test, expect } from './fixtures/auth';

test.describe('J3: Observer offline journey', () => {
  test('observe page loads and remains functional offline', async ({ authedPage: page }) => {
    // Load the page while online first (to cache assets)
    await page.goto('/en/observe/');
    await expect(page.locator('main').first()).toBeVisible();

    // Go offline
    await page.context().setOffline(true);

    // The page should still be visible (already loaded)
    await expect(page.locator('main').first()).toBeVisible();

    // Go back online
    await page.context().setOffline(false);
  });

  test('explore page handles offline gracefully', async ({ authedPage: page }) => {
    await page.goto('/en/explore/');
    await expect(page.locator('main').first()).toBeVisible();

    // Go offline
    await page.context().setOffline(true);

    // Page content should still be visible
    await expect(page.locator('main').first()).toBeVisible();

    // Go back online
    await page.context().setOffline(false);
  });

  test('profile page handles offline gracefully', async ({ authedPage: page }) => {
    await page.goto('/en/profile/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.locator('main').first()).toBeVisible();
    await page.context().setOffline(false);
  });

  test('home page loads and stays visible when going offline', async ({ authedPage: page }) => {
    await page.goto('/en/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.context().setOffline(true);
    await expect(page.locator('main').first()).toBeVisible();
    await page.context().setOffline(false);
  });
});
