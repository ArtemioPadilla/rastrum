/**
 * Tier 1d — M31 camera stations (UI only). The project-detail page must
 * render for a slug without throwing. The CLI batch import (cli/, Node) is
 * out of scope here (separate cli/test/ native runner).
 *
 * Route confirmed: src/pages/en/projects/detail/index.astro →
 * /en/projects/detail/?slug=<slug>  (CLAUDE.md M31 section)
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: camera station UI', () => {
  test('project-detail renders for a slug (EN)', async ({ authedPage: page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);
    await page.goto('/en/projects/detail/?slug=e2e-nonexistent');
    await expect(page.locator('main').first()).toBeVisible();
    const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
    expect(realErrs).toEqual([]);
  });
});
