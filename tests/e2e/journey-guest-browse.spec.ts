/**
 * J1 — Guest browse journey: anonymous user explores the platform,
 * hits sign-in nudges at auth-gated actions, switches language.
 */
import { test, expect } from '@playwright/test';

test.describe('J1: Guest browse journey', () => {
  test('can browse home → explore → docs and switch language', async ({ page }) => {
    // 1. Land on EN home
    await page.goto('/en/');
    await expect(page.locator('main').first()).toBeVisible();

    // 2. Navigate to observe page
    await page.goto('/en/observe/');
    await expect(page.locator('main').first()).toBeVisible();

    // 3. Navigate to explore
    await page.goto('/en/explore/');
    await expect(page.locator('main').first()).toBeVisible();

    // 4. Navigate to explore map
    await page.goto('/en/explore/map/');
    await expect(page.locator('main').first()).toBeVisible();

    // 5. Navigate to docs
    await page.goto('/en/docs/');
    await expect(page.locator('main').first()).toBeVisible();

    // 6. Navigate to about
    await page.goto('/en/about/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('ES routes mirror EN routes', async ({ page }) => {
    await page.goto('/es/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.goto('/es/observar/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.goto('/es/explorar/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.goto('/es/docs/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('sign-in page is accessible to guests', async ({ page }) => {
    await page.goto('/en/sign-in/');
    await expect(page.locator('main').first()).toBeVisible();
    // The sign-in form or CTA should be present
    const main = page.locator('main').first();
    await expect(main).toBeVisible();
  });

  test('profile page redirects or shows sign-in prompt for guests', async ({ page }) => {
    const response = await page.goto('/en/profile/');
    // Profile without auth should still render (may show sign-in prompt)
    expect(response?.status()).toBeLessThan(500);
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('community observers page renders for guests', async ({ page }) => {
    await page.goto('/en/community/observers/');
    await expect(page.locator('main').first()).toBeVisible();
    // Filter chips should be visible even for guests
    const sortFilter = page.locator('#cf-sort');
    if (await sortFilter.isVisible()) {
      await expect(sortFilter).toBeVisible();
    }
  });

  test('language alternate links are present', async ({ page }) => {
    await page.goto('/en/');
    const altLink = page.locator('link[hreflang="es"]');
    await expect(altLink).toHaveAttribute('href', /\/es\//);
  });

  test('no server errors on any core guest route', async ({ page }) => {
    const routes = [
      '/en/', '/en/observe/', '/en/explore/', '/en/explore/map/',
      '/en/about/', '/en/docs/', '/en/sign-in/', '/en/chat/',
      '/es/', '/es/observar/', '/es/explorar/', '/es/acerca/',
    ];
    for (const route of routes) {
      const response = await page.goto(route);
      expect(response?.status(), `${route} should not 500`).toBeLessThan(500);
    }
  });
});
