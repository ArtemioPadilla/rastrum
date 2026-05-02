/**
 * J8 — Researcher export journey: authenticated user navigates to
 * profile observations, accesses export functionality, and verifies
 * the export page renders correctly.
 */
import { test, expect } from './fixtures/auth';

test.describe('J8: Researcher export journey', () => {
  test('profile observations page renders', async ({ authedPage: page }) => {
    await page.goto('/en/profile/observations/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('profile export page renders (EN)', async ({ authedPage: page }) => {
    await page.goto('/en/profile/export/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('profile export page renders (ES)', async ({ authedPage: page }) => {
    await page.goto('/es/perfil/exportar/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('full export journey: observations → export → profile', async ({ authedPage: page }) => {
    // Start at observations list
    await page.goto('/en/profile/observations/');
    await expect(page.locator('main')).toBeVisible();

    // Navigate to export
    await page.goto('/en/profile/export/');
    await expect(page.locator('main')).toBeVisible();

    // Back to profile
    await page.goto('/en/profile/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('explore species page renders (research context)', async ({ authedPage: page }) => {
    await page.goto('/en/explore/species/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('explore species ES route works', async ({ authedPage: page }) => {
    await page.goto('/es/explorar/especies/');
    await expect(page.locator('main')).toBeVisible();
  });
});
