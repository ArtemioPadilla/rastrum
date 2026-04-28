import { test, expect } from '@playwright/test';

/**
 * Settings shell e2e tests (PR-2 account hub + settings shell).
 *
 * Out of scope: anything requiring a real Supabase session (auth flows,
 * BYO key persistence). These tests verify static structure + redirects.
 */

test.describe('Settings shell — EN', () => {
  test('profile tab renders the edit form', async ({ page }) => {
    const response = await page.goto('/en/profile/settings/profile/');
    expect(response!.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Settings/i);
    // The edit form has an id=edit-form
    await expect(page.locator('#edit-form')).toBeAttached();
    // Tab nav is visible
    await expect(page.locator('nav[aria-label="Settings tabs"]')).toBeVisible();
  });

  test('preferences tab renders language and BYO keys sections', async ({ page }) => {
    const response = await page.goto('/en/profile/settings/preferences/');
    expect(response!.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Settings/i);
    // BYO keys section
    await expect(page.locator('#byo-keys-form')).toBeAttached();
    // Language toggle button exists (use ID to avoid strict-mode conflict)
    await expect(page.locator('#lang-es')).toBeVisible();
  });

  test('data tab renders import and export sections', async ({ page }) => {
    const response = await page.goto('/en/profile/settings/data/');
    expect(response!.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Settings/i);
    // Should have links to import and export
    await expect(page.locator('a[href*="import"]').first()).toBeVisible();
    await expect(page.locator('a[href*="export"]').first()).toBeVisible();
  });

  test('developer tab renders tokens and expert-apply sections', async ({ page }) => {
    const response = await page.goto('/en/profile/settings/developer/');
    expect(response!.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Settings/i);
    await expect(page.locator('a[href*="tokens"]').first()).toBeVisible();
    await expect(page.locator('a[href*="expert-apply"]').first()).toBeVisible();
  });

  test('/profile/settings/ (no tab) has redirect to profile tab', async ({ page }) => {
    const response = await page.goto('/en/profile/settings/');
    expect(response!.status()).toBeLessThan(400);
    // Static build: page redirects (meta-refresh or HTTP) to /profile/settings/profile/
    const content = await page.content();
    const url = page.url();
    const hasRedirect = url.includes('settings/profile') || content.includes('settings/profile');
    expect(hasRedirect, 'page should redirect or link to settings/profile').toBe(true);
  });
});

test.describe('Settings shell — ES', () => {
  test('profile tab renders in Spanish', async ({ page }) => {
    const response = await page.goto('/es/perfil/ajustes/profile/');
    expect(response!.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Ajustes/i);
    await expect(page.locator('#edit-form')).toBeAttached();
  });

  test('preferences tab renders in Spanish', async ({ page }) => {
    const response = await page.goto('/es/perfil/ajustes/preferences/');
    expect(response!.status()).toBeLessThan(400);
    await expect(page).toHaveTitle(/Ajustes/i);
    await expect(page.locator('#byo-keys-form')).toBeAttached();
  });
});

test.describe('Legacy redirects → settings (PR-2)', () => {
  async function expectRedirectTo(page: import('@playwright/test').Page, from: string, to: string) {
    // Use 'networkidle' so Playwright waits for the meta-refresh navigation to settle
    await page.goto(from, { waitUntil: 'networkidle' });
    const url = page.url();
    expect(url, `Expected ${from} to redirect to ${to}, got ${url}`).toContain(to);
  }

  test('/en/profile/edit redirects to settings/profile', async ({ page }) => {
    await expectRedirectTo(page, '/en/profile/edit', 'settings/profile');
  });

  test('/es/perfil/editar redirects to ajustes/profile', async ({ page }) => {
    await expectRedirectTo(page, '/es/perfil/editar', 'ajustes/profile');
  });

  test('/en/profile/tokens redirects to settings/developer', async ({ page }) => {
    await expectRedirectTo(page, '/en/profile/tokens', 'settings/developer');
  });

  test('/en/profile/export redirects to settings/data', async ({ page }) => {
    await expectRedirectTo(page, '/en/profile/export', 'settings/data');
  });

  test('/en/profile/import redirects to settings/data', async ({ page }) => {
    await expectRedirectTo(page, '/en/profile/import', 'settings/data');
  });

  test('/en/profile/expert-apply redirects to settings/developer', async ({ page }) => {
    await expectRedirectTo(page, '/en/profile/expert-apply', 'settings/developer');
  });
});
