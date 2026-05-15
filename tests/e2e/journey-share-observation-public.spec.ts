/**
 * Tier 1d — Public share/obs. Guards the CLAUDE.md pitfall: /share/obs/ is
 * a LOCALE-NEUTRAL single page; /es/share/obs/ 404s. The page must render
 * for a synthetic id without throwing, and the /en|/es prefixed variants
 * must NOT resolve (that's the regression).
 */
import { test, expect } from '@playwright/test';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

const SYNTHETIC_ID = '00000000-0000-0000-0000-000000000abc';

test.describe('J: public share observation', () => {
  test('locale-neutral /share/obs/ renders; prefixed variants 404', async ({ page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);

    const ok = await page.goto(`/share/obs/?id=${SYNTHETIC_ID}`);
    expect(ok?.status() ?? 200).toBeLessThan(400);
    await expect(page.locator('main, body').first()).toBeVisible();

    for (const bad of [`/en/share/obs/?id=${SYNTHETIC_ID}`, `/es/share/obs/?id=${SYNTHETIC_ID}`]) {
      const r = await page.goto(bad);
      expect(r?.status() ?? 200).toBeGreaterThanOrEqual(400);
    }
    expect(errs).toEqual([]);
  });
});
