/**
 * J6 — Admin system health journey: admin navigates the console,
 * checks health, anomalies, cron, errors, audit, and user management.
 */
import { test, expect } from './fixtures/auth';

test.describe('J6: Admin system health journey', () => {
  test('console dashboard renders for admin', async ({ adminPage: page }) => {
    await page.goto('/en/console/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('health page renders', async ({ adminPage: page }) => {
    await page.goto('/en/console/health/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('anomalies page renders', async ({ adminPage: page }) => {
    await page.goto('/en/console/anomalies/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('cron page renders', async ({ adminPage: page }) => {
    await page.goto('/en/console/cron/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('errors page renders', async ({ adminPage: page }) => {
    await page.goto('/en/console/errors/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('audit page renders', async ({ adminPage: page }) => {
    await page.goto('/en/console/audit/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('users page renders', async ({ adminPage: page }) => {
    await page.goto('/en/console/users/');
    await expect(page.locator('main').first()).toBeVisible();
  });

  test('full admin journey through all health tabs', async ({ adminPage: page }) => {
    const tabs = [
      '/en/console/',
      '/en/console/health/',
      '/en/console/anomalies/',
      '/en/console/cron/',
      '/en/console/errors/',
      '/en/console/audit/',
      '/en/console/users/',
      '/en/console/webhooks/',
      '/en/console/flags/',
    ];
    for (const tab of tabs) {
      await page.goto(tab);
      await expect(page.locator('main').first(), `${tab} should render`).toBeVisible();
    }
  });

  test('ES console routes work', async ({ adminPage: page }) => {
    await page.goto('/es/consola/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.goto('/es/consola/salud/');
    await expect(page.locator('main').first()).toBeVisible();

    await page.goto('/es/consola/auditoria/');
    await expect(page.locator('main').first()).toBeVisible();
  });
});
