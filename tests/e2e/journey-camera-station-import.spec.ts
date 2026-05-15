/**
 * Tier 1d — M31 camera stations (UI only). The project-detail page must
 * render the M31 camera-stations section for a slug without throwing. The
 * #stations-section element is unconditionally present in the static DOM
 * (rendered by ProjectDetailView.astro regardless of whether the project
 * exists); the section content is hydrated from the backend after load.
 * The CLI batch import (cli/, Node) is out of scope here (separate
 * cli/test/ native runner).
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

    // M31 guard: camera-stations section must be present in the static DOM.
    expect(await page.locator('#stations-section').count()).toBeGreaterThan(0);

    const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
    expect(realErrs).toEqual([]);
  });
});
