/**
 * J9 — Sponsor journey: authenticated user navigates sponsorship pages,
 * verifies the sponsoring and sponsored-by routes render.
 */
import { test, expect } from './fixtures/auth';

test.describe('J9: Sponsor setup journey', () => {
  test('sponsoring page renders (EN)', async ({ authedPage: page }) => {
    await page.goto('/en/profile/sponsoring/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('sponsoring page renders (ES)', async ({ authedPage: page }) => {
    await page.goto('/es/perfil/patrocinios/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('sponsored-by page renders (EN)', async ({ authedPage: page }) => {
    await page.goto('/en/profile/sponsored-by/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('sponsored-by page renders (ES)', async ({ authedPage: page }) => {
    await page.goto('/es/perfil/patrocinado-por/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('full sponsor journey: profile → sponsoring → sponsored-by → settings', async ({ authedPage: page }) => {
    await page.goto('/en/profile/');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/en/profile/sponsoring/');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/en/profile/sponsored-by/');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/en/profile/settings/');
    await expect(page.locator('main')).toBeVisible();
  });
});
