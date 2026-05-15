/**
 * Tier 1d — Watchlist. Authed watchlist page must render and the locale
 * pair must be structurally present. UI-flow only (alert delivery is a
 * backend concern — out of scope per #1031 non-goal).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: watchlist', () => {
  for (const route of ['/en/explore/watchlist/', '/es/explorar/seguimiento/']) {
    test(`watchlist renders authed: ${route}`, async ({ authedPage: page }) => {
      await dismissConsent(page);
      const errs = collectPageErrors(page);
      await page.goto(route);
      await expect(page.locator('main').first()).toBeVisible();
      expect(errs).toEqual([]);
    });
  }
});
