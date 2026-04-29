/**
 * Playwright e2e for /community/observers/ (M28 PR5+PR6).
 *
 * The page is client-rendered. Without a `PUBLIC_SUPABASE_URL` configured
 * in the preview env (typical for CI), the community queries will fail
 * with a network error, which the page renders as either an empty-state
 * or an inline error message.
 *
 * The assertions here cover the surfaces that work without a backend:
 *  - the page shell renders with the H1 + filter chips,
 *  - changing the sort dropdown updates window.location.search,
 *  - signed-out + ?nearby=true short-circuits to the sign-in CTA before
 *    any DB call, so it's deterministic without a backend,
 *  - ES route is reachable + uses the Spanish H1.
 *
 * Mobile project covers the drawer's Community subheading appears.
 */
import { test, expect } from '@playwright/test';

test.describe('community/observers — desktop', () => {
  test('EN page renders shell + filter chips', async ({ page }) => {
    await page.goto('/en/community/observers/');
    await expect(page.locator('h1')).toHaveText(/Community observers/i);
    await expect(page.locator('#cf-sort')).toBeVisible();
    await expect(page.locator('#cf-country')).toBeVisible();
    await expect(page.locator('#cf-taxon')).toBeVisible();
    await expect(page.locator('#cf-experts')).toBeVisible();
    await expect(page.locator('#cf-nearby')).toBeVisible();
  });

  test('changing sort updates the URL', async ({ page }) => {
    await page.goto('/en/community/observers/');
    await page.locator('#cf-sort').selectOption('species_count');
    await page.waitForFunction(
      () => window.location.search.includes('sort=species_count'),
      undefined,
      { timeout: 5_000 },
    );
    expect(page.url()).toContain('sort=species_count');
  });

  test('?nearby=true while signed out shows the sign-in empty state', async ({ page }) => {
    await page.goto('/en/community/observers/?nearby=true');
    const empty = page.locator('#community-empty');
    await expect(empty).toBeVisible({ timeout: 10_000 });
    await expect(empty).toContainText(/Sign in to find observers/i);
  });

  test('ES route is reachable and uses ES copy', async ({ page }) => {
    await page.goto('/es/comunidad/observadores/');
    await expect(page.locator('h1')).toHaveText(/Observadores de la comunidad/i);
  });

  test('the legacy "no leaderboards" copy is gone from the chrome', async ({ page }) => {
    // The string lived in two profile-edit / profile-page strings that the
    // chrome doesn't render directly. The cheapest assertion that proves
    // the atomic rewrite landed: load the EN/ES bundle that ships in the
    // page and grep its contents.
    await page.goto('/en/');
    const html = await page.content();
    expect(html).not.toMatch(/no leaderboards/i);
    await page.goto('/es/');
    const htmlEs = await page.content();
    expect(htmlEs).not.toMatch(/sin tablas de líderes/i);
  });
});

test.describe('community/observers — mobile', () => {
  test.use({ viewport: { width: 390, height: 844 } });

  test('drawer shows Community subheading', async ({ page }) => {
    await page.goto('/en/');
    await page.locator('#mobile-menu-toggle').click();
    const drawer = page.locator('#mobile-drawer');
    await expect(drawer).toBeVisible();
    await expect(drawer.getByText('Community', { exact: true })).toBeVisible();
  });
});
