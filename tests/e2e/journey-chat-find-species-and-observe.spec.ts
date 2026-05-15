/**
 * Tier 1d — Chat → species. Chat must render past its WebLLM model-cache
 * gate (seeded) with a composer present. UI-flow only — no model inference.
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, seedWebLLMCache, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: chat find species', () => {
  test('chat renders past model gate with a composer (EN)', async ({ authedPage: page }) => {
    await dismissConsent(page);
    await seedWebLLMCache(page);
    const errs = collectPageErrors(page);

    await page.goto('/en/chat/');
    await expect(page.locator('main').first()).toBeVisible();
    expect(await page.locator('textarea, input[type="text"], [contenteditable="true"]').count())
      .toBeGreaterThan(0);
    const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
    expect(realErrs).toEqual([]);
  });

  test('ES chat route renders', async ({ authedPage: page }) => {
    await dismissConsent(page);
    await seedWebLLMCache(page);
    const errs = collectPageErrors(page);
    await page.goto('/es/chat/');
    await expect(page.locator('main').first()).toBeVisible();
    const realErrs = errs.filter(e => !e.includes('supabaseUrl is required'));
    expect(realErrs).toEqual([]);
  });
});
