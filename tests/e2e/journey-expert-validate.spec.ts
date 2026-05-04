/**
 * J4 — Expert validation journey: expert user navigates the validation
 * queue, views pending observations, and accesses the expert dashboard.
 */
import { test, expect } from './fixtures/auth';

test.describe('J4: Expert validation journey', () => {
  test('validation queue page renders (EN)', async ({ expertPage: page }) => {
    await page.goto('/en/explore/validate/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('validation queue page renders (ES)', async ({ expertPage: page }) => {
    await page.goto('/es/explorar/validar/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('expert dashboard page renders (EN)', async ({ expertPage: page }) => {
    await page.goto('/en/profile/validate/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('expert dashboard page renders (ES)', async ({ expertPage: page }) => {
    await page.goto('/es/perfil/validar/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('full expert journey: home → queue → dashboard → profile', async ({ expertPage: page }) => {
    // Start at home
    await page.goto('/en/');
    await expect(page.locator('main').first()).toBeVisible();

    // Navigate to validation queue
    await page.goto('/en/explore/validate/');
    await expect(page.locator('main').first()).toBeVisible();

    // Navigate to expert dashboard
    await page.goto('/en/profile/validate/');
    await expect(page.locator('main').first()).toBeVisible();

    // Navigate to profile
    await page.goto('/en/profile/');
    await expect(page.locator('main').first()).toBeVisible();

    // Navigate to explore
    await page.goto('/en/explore/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('expert can access console validation tab', async ({ expertPage: page }) => {
    await page.goto('/en/console/');
    await expect(page.locator('main').first()).toBeVisible();
  });
});
