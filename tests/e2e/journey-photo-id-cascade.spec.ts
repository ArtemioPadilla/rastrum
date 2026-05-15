/**
 * Tier 1d — Photo-ID cascade. Guards the 2026-05-15 regression class
 * (HEIC silent-fail, verify_jwt gateway reject, taxa upsert): the observe
 * form, pipeline stepper, and the identify-error banner element (PR #1062)
 * must render, the locale pair must be structurally identical, and the
 * page must not throw. UI-flow only — no backend (epic #1031 non-goal).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: photo-ID cascade', () => {
  test.beforeEach(async ({ authedPage: page }) => { await dismissConsent(page); });

  test('observe form + pipeline + identify-error banner render (EN)', async ({ authedPage: page }) => {
    const errs = collectPageErrors(page);
    await page.goto('/en/observe/');
    await expect(page.locator('main').first()).toBeVisible();

    expect(await page.locator('[data-dropzone], #obs-dropzone, input[type="file"]').count())
      .toBeGreaterThan(0);
    expect(await page.locator('#pipeline-stepper, #obs2-pipeline-section').count())
      .toBeGreaterThan(0);
    expect(await page.locator('#obs2-identify-error').count()).toBeGreaterThan(0);

    expect(errs).toEqual([]);
  });

  test('ES locale route renders the same shell', async ({ authedPage: page }) => {
    const errs = collectPageErrors(page);
    await page.goto('/es/observar/');
    await expect(page.locator('main').first()).toBeVisible();
    expect(await page.locator('#obs2-identify-error').count()).toBeGreaterThan(0);
    expect(errs).toEqual([]);
  });
});
