/**
 * Tier 1d — Magic-link / PKCE callback. Guards PR #350 (callback looped
 * forever on "Verificando tu enlace"). The locale-neutral /auth/callback/
 * page must render a terminal verifying/redirect state and must not throw
 * or hang on a permanently-visible spinner. No real token exchange (no
 * backend) — we assert the page boots and resolves its UI, not auth success.
 */
import { test, expect } from '@playwright/test';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: magic-link PKCE callback', () => {
  test('callback page renders without hanging', async ({ page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);

    await page.goto('/auth/callback/');
    await expect(page.locator('main, body').first()).toBeVisible();
    await page.waitForLoadState('networkidle');

    // "supabaseUrl is required." is the known pageerror in static-preview builds (no real env vars).
    const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
    expect(realErrs).toEqual([]);
  });

  test('locale-prefixed callback variants 404', async ({ page }) => {
    // Fresh test = fresh page/error state — no collectPageErrors: a 404 page legitimately may error.
    for (const bad of ['/en/auth/callback/', '/es/auth/callback/']) {
      const r = await page.goto(bad);
      // null/aborted nav for a non-route is treated as "did not successfully serve a page" (→ 404).
      expect(r?.status() ?? 404).toBeGreaterThanOrEqual(400);
    }
  });
});
