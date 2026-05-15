/**
 * Tier 1d — M29 Projects. Projects index + new-project form render authed;
 * locale pair parity. UI-flow only — upsert_project RPC out of scope.
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: projects create + join', () => {
  for (const route of ['/en/projects/', '/es/proyectos/', '/en/projects/new/']) {
    test(`renders authed: ${route}`, async ({ authedPage: page }) => {
      await dismissConsent(page);
      const errs = collectPageErrors(page);
      await page.goto(route);
      await expect(page.locator('main').first()).toBeVisible();
      const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
      expect(realErrs).toEqual([]);
    });
  }
});
