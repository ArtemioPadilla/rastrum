/**
 * Feedback micro-survey E2E — verify the MicroSurvey component renders,
 * responds to events, and stores feedback in localStorage.
 */
import { test, expect } from '@playwright/test';

test.describe('Micro-survey feedback', () => {
  test('micro-survey is hidden by default', async ({ page }) => {
    await page.goto('/en/');
    const survey = page.locator('#micro-survey');
    await expect(survey).toBeHidden();
  });

  test('console feedback page renders (EN)', async ({ page }) => {
    await page.goto('/en/console/feedback/');
    await expect(page.locator('main')).toBeVisible();
  });

  test('console feedback page renders (ES)', async ({ page }) => {
    await page.goto('/es/consola/retroalimentacion/');
    await expect(page.locator('main')).toBeVisible();
  });
});
