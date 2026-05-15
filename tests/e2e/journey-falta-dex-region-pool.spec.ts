/**
 * Tier 1d — v1.1.5 Fogg falta-dex. The dex (PokedexView) must render
 * authed. Exact honest-norms copy is Tier 4 (human); here we assert the
 * page renders and does not throw.
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: falta-dex region pool', () => {
  for (const route of ['/en/profile/dex/', '/es/perfil/dex/']) {
    test(`dex renders authed: ${route}`, async ({ authedPage: page }) => {
      await dismissConsent(page);
      const errs = collectPageErrors(page);
      await page.goto(route);
      await expect(page.locator('main').first()).toBeVisible();
      const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
      expect(realErrs).toEqual([]);
    });
  }
});
