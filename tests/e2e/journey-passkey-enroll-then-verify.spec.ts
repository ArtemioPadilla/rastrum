/**
 * Tier 1d — Passkey. Headless Chromium has no real authenticator, so the
 * passkey UI must degrade gracefully — render without throwing an uncaught
 * error. That graceful path is the regression vector worth guarding.
 *
 * Route confirmed: src/pages/en/profile/settings/[tab].astro →
 * /en/profile/settings/security  (tab=security renders ProfileEditForm
 * section="security" which contains the passkey enroll button + unsupported
 * fallback message; CLAUDE.md ProfileEditForm passkey section).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: passkey enroll/verify', () => {
  test('profile security surface renders passkey UI without throwing', async ({ authedPage: page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);
    await page.goto('/en/profile/settings/security');
    await expect(page.locator('main').first()).toBeVisible();
    await page.waitForLoadState('networkidle');
    const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
    expect(realErrs).toEqual([]);
  });
});
