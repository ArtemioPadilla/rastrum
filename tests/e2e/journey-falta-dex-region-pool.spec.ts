/**
 * Tier 1d — v1.1.5 Fogg falta-dex. The dex (PokedexView) must render
 * authed. Regression guard: the Fogg honest-norms "not enough data"
 * fallback (falta-dex region pool) is asserted via the
 * data-label-missing-no-region attribute on [data-pokedex-root]. In the
 * static preview there is no backend so regionPoolSize is always null →
 * the no-region path deterministically applies. A raw-rank regression
 * (removing or replacing this attribute) would fail this test.
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

// EN: "Set your country in Profile → Edit to see what you're missing."
// ES: "Configura tu país en Perfil → Editar para ver lo que te falta."
const HONEST_NORMS_NO_REGION: Record<string, RegExp> = {
  '/en/profile/dex/': /set your country in profile/i,
  '/es/perfil/dex/':  /configura tu país en perfil/i,
};

test.describe('J: falta-dex region pool', () => {
  for (const route of ['/en/profile/dex/', '/es/perfil/dex/']) {
    test(`dex renders authed: ${route}`, async ({ authedPage: page }) => {
      await dismissConsent(page);
      const errs = collectPageErrors(page);
      await page.goto(route);
      await expect(page.locator('main').first()).toBeVisible();

      // Honest-norms invariant: the no-region fallback label must be declared
      // in the static DOM. Its value is the actual string the runtime inserts
      // when regionPoolSize is null (no backend → always this path in preview).
      const root = page.locator('[data-pokedex-root]');
      await expect(root).toBeVisible();
      const noRegionLabel = await root.getAttribute('data-label-missing-no-region');
      expect(noRegionLabel).toMatch(HONEST_NORMS_NO_REGION[route]);

      const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
      expect(realErrs).toEqual([]);
    });
  }
});
