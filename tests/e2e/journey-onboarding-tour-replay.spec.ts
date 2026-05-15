/**
 * Tier 1d — Onboarding tour replay. Guards PR #993. The
 * rastrum:replay-onboarding event must open #onboarding-tour, all 7 steps
 * advance, and it must close. Re-firing the event must be idempotent
 * (reopens cleanly, not double-mounted).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: onboarding tour replay', () => {
  test('replay opens, walks 7 steps, closes, and is idempotent', async ({ authedPage: page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);

    await page.goto('/en/');
    const dialog = page.locator('#onboarding-tour');

    for (let round = 0; round < 2; round++) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding')));
      await expect(dialog).toBeVisible();
      for (let i = 0; i < 7; i++) {
        await expect(page.locator('#onb-step-label')).toContainText(`${i + 1} of 7`);
        await page.locator('#onb-next').click();
      }
      await expect(dialog).toBeHidden();
    }
    expect(await page.locator('#onboarding-tour').count()).toBe(1);
    expect(errs).toEqual([]);
  });
});
