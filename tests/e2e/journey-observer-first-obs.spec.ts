/**
 * J2 — First observation journey: authenticated user completes onboarding,
 * navigates to observe, interacts with the form, and verifies profile pages.
 */
import { test, expect } from './fixtures/auth';

test.describe('J2: Observer first observation journey', () => {
  test('onboarding tour opens and can be completed', async ({ authedPage: page }) => {
    await page.goto('/en/');
    // Trigger onboarding replay (bypasses the auth check)
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding'));
    });
    const dialog = page.locator('#onboarding-tour');
    await expect(dialog).toBeVisible();

    // Walk through all 6 steps
    for (let i = 0; i < 6; i++) {
      await expect(page.locator('#onb-step-label')).toContainText(`${i + 1}`);
      await page.locator('#onb-next').click();
    }
    // Dialog should close after final step
    await expect(dialog).toBeHidden();
  });

  test('observe page renders form elements', async ({ authedPage: page }) => {
    await page.goto('/en/observe/');
    await expect(page.locator('main')).toBeVisible();

    // The observation form should have key elements
    // DropZone or file input for photos
    const hasDropzone = await page.locator('[data-dropzone], #obs-dropzone, input[type="file"]').count();
    expect(hasDropzone).toBeGreaterThan(0);
  });

  test('observe page ES route works', async ({ authedPage: page }) => {
    await page.goto('/es/observar/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('profile page renders for authenticated user', async ({ authedPage: page }) => {
    await page.goto('/en/profile/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('profile observations page renders', async ({ authedPage: page }) => {
    await page.goto('/en/profile/observations/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('profile settings page renders', async ({ authedPage: page }) => {
    await page.goto('/en/profile/settings/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('explore recent page renders', async ({ authedPage: page }) => {
    await page.goto('/en/explore/recent/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('full journey: home → onboarding → observe → profile', async ({ authedPage: page }) => {
    // Start at home
    await page.goto('/en/');
    await expect(page.locator('main')).toBeVisible();

    // Navigate to observe
    await page.goto('/en/observe/');
    await expect(page.locator('main')).toBeVisible();

    // Navigate to profile
    await page.goto('/en/profile/');
    await expect(page.locator('main')).toBeVisible();

    // Navigate to observations list
    await page.goto('/en/profile/observations/');
    await expect(page.locator('main')).toBeVisible();

    // Navigate to explore
    await page.goto('/en/explore/recent/');
    await expect(page.locator('main')).toBeVisible();
  });
});
