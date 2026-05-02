/**
 * J5 — Moderator flag triage journey: moderator navigates the console
 * flag queue, reviews flags, and accesses moderation tools.
 */
import { test, expect } from './fixtures/auth';

test.describe('J5: Moderator flag triage journey', () => {
  test('console renders for moderator', async ({ modPage: page }) => {
    await page.goto('/en/console/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('flag queue page renders (EN)', async ({ modPage: page }) => {
    await page.goto('/en/console/flag-queue/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('flag queue page renders (ES)', async ({ modPage: page }) => {
    await page.goto('/es/consola/cola-banderas/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('bans page renders', async ({ modPage: page }) => {
    await page.goto('/en/console/bans/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('comments page renders', async ({ modPage: page }) => {
    await page.goto('/en/console/comments/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('full mod journey: console → flags → bans → audit', async ({ modPage: page }) => {
    await page.goto('/en/console/');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/en/console/flag-queue/');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/en/console/bans/');
    await expect(page.locator('main')).toBeVisible();

    await page.goto('/en/console/comments/');
    await expect(page.locator('main')).toBeVisible();
  });
});
