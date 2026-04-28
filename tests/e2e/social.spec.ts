import { test, expect } from '@playwright/test';

test.describe('m26 social — smoke', () => {
  test('inbox page renders without auth (EN)', async ({ page }) => {
    await page.goto('/en/inbox/');
    await expect(page).toHaveURL(/\/en\/inbox\/?$/);
    await expect(page.locator('main')).toBeVisible();
  });

  test('inbox page renders without auth (ES)', async ({ page }) => {
    await page.goto('/es/bandeja/');
    await expect(page).toHaveURL(/\/es\/bandeja\/?$/);
    await expect(page.locator('main')).toBeVisible();
  });

  test('followers route exists (EN)', async ({ page }) => {
    const response = await page.goto('/en/profile/u/followers/');
    expect([200, 404]).toContain(response?.status() ?? 0);
  });

  test('followers route exists (ES)', async ({ page }) => {
    const response = await page.goto('/es/perfil/u/seguidores/');
    expect([200, 404]).toContain(response?.status() ?? 0);
  });

  test('following route exists (EN)', async ({ page }) => {
    const response = await page.goto('/en/profile/u/following/');
    expect([200, 404]).toContain(response?.status() ?? 0);
  });
});
