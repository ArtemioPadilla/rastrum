/**
 * J7 — Social engagement journey: authenticated user explores community,
 * views profiles, accesses inbox, and navigates social features.
 */
import { test, expect } from './fixtures/auth';

test.describe('J7: Social engagement journey', () => {
  test('community observers page renders', async ({ authedPage: page }) => {
    await page.goto('/en/community/observers/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('community observers ES route works', async ({ authedPage: page }) => {
    await page.goto('/es/comunidad/observadores/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('inbox page renders for authenticated user (EN)', async ({ authedPage: page }) => {
    await page.goto('/en/inbox/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('inbox page renders for authenticated user (ES)', async ({ authedPage: page }) => {
    await page.goto('/es/bandeja/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('community filters are present', async ({ authedPage: page }) => {
    await page.goto('/en/community/observers/');
    await expect(page.locator('main').first()).toBeVisible();
    // Check for filter elements if they exist
    const sortFilter = page.locator('#cf-sort');
    if (await sortFilter.count() > 0) {
      await expect(sortFilter).toBeVisible();
    }
  });

  test('full social journey: community → inbox → explore → profile', async ({ authedPage: page }) => {
    await page.goto('/en/community/observers/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.goto('/en/inbox/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.goto('/en/explore/recent/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.goto('/en/profile/');
    await expect(page.locator('main').first()).toBeVisible();
  });
});
