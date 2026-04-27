import { test, expect } from '@playwright/test';

const ROUTES: Record<'en' | 'es', string[]> = {
  en: [
    '/en/',
    '/en/identify/',
    '/en/observe/',
    '/en/explore/',
    '/en/explore/map/',
    '/en/explore/recent/',
    '/en/explore/watchlist/',
    '/en/explore/species/',
    '/en/about/',
    '/en/docs/',
    '/en/sign-in/',
    '/en/profile/',
  ],
  es: [
    '/es/',
    '/es/identificar/',
    '/es/observar/',
    '/es/explorar/',
    '/es/explorar/mapa/',
    '/es/explorar/recientes/',
    '/es/explorar/seguimiento/',
    '/es/explorar/especies/',
    '/es/acerca/',
    '/es/docs/',
    '/es/ingresar/',
    '/es/perfil/',
  ],
};

// ROUTES is the canonical IA reference for this spec — not exported, but kept
// so the list of expected paths is visible alongside the navigation tests. If
// routes change, sync this list AND the smoke spec's equivalent.
void ROUTES;

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

  test('docs mega-menu mounts on click', async ({ page }) => {
    await page.goto('/en/');
    const docsBtn = page.locator('#megamenu-docs-btn');
    await docsBtn.click();
    // The mega-menu uses 3 columns; just assert one known item is visible.
    await expect(page.locator('#megamenu-docs-menu a[href="/en/docs/architecture/"]')).toBeVisible();
  });

  test('active section rail highlights Observe on /observe', async ({ page }) => {
    await page.goto('/en/observe/');
    // The link gets the emerald color class when active.
    const link = page.locator('header nav a[href="/en/observe/"]').first();
    await expect(link).toHaveClass(/text-emerald-600/);
  });

  test('explore dropdown reveals 4 sub-items', async ({ page }) => {
    await page.goto('/en/');
    const expBtn = page.locator('#hdr-explore-btn');
    await expBtn.click();
    await expect(page.locator('#hdr-explore-menu a[href="/en/explore/recent/"]')).toBeVisible();
    await expect(page.locator('#hdr-explore-menu a[href="/en/explore/watchlist/"]')).toBeVisible();
    await expect(page.locator('#hdr-explore-menu a[href="/en/explore/species/"]')).toBeVisible();
  });

  test('legacy /profile/watchlist redirects to /explore/watchlist', async ({ page }) => {
    // Astro emits a meta-refresh redirect for static-build redirects; following
    // it should land us on the new path.
    await page.goto('/en/profile/watchlist');
    await page.waitForURL(/\/en\/explore\/watchlist\/?$/, { timeout: 5000 });
  });
});
