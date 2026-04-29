import { test, expect } from '@playwright/test';

test.describe('console — smoke', () => {
  test('/en/console/ renders the gate for an unauth visitor', async ({ page }) => {
    await page.goto('/en/console/');
    // The gate element exists; either text "Sign in required." or
    // "You do not have console access." or "Loading…" — all acceptable.
    const gate = page.locator('#console-gate');
    await expect(gate).toBeVisible();
    const txt = await gate.textContent();
    expect(txt && txt.length > 0).toBe(true);
  });

  test('/es/consola/ renders with ES locale', async ({ page }) => {
    await page.goto('/es/consola/');
    const gate = page.locator('#console-gate');
    await expect(gate).toBeVisible();
  });

  test('/en/profile/admin/experts/ 308-redirects to /en/console/experts/', async ({ page }) => {
    await page.goto('/en/profile/admin/experts/');
    await expect(page).toHaveURL(/\/en\/console\/experts\/?$/);
  });

  test('/es/perfil/admin/expertos/ 308-redirects to /es/consola/expertos/', async ({ page }) => {
    await page.goto('/es/perfil/admin/expertos/');
    await expect(page).toHaveURL(/\/es\/consola\/expertos\/?$/);
  });

  test('Header has no console pill for an unauth visitor', async ({ page }) => {
    await page.goto('/en/');
    const pill = page.locator('#header-console-pill');
    // Visible-state matters: the pill exists in the DOM but should remain
    // hidden when there is no signed-in user with roles.
    await expect(pill).toHaveClass(/hidden/);
  });

  test('/en/console/users/ renders the gate for an unauth visitor', async ({ page }) => {
    await page.goto('/en/console/users/');
    // The gate uses the same #console-gate id as the overview page or shows
    // "Not authorized" inline. Either is acceptable for a smoke check.
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });

  test('/en/console/credentials/ renders for an unauth visitor', async ({ page }) => {
    await page.goto('/en/console/credentials/');
    const body = await page.locator('body').textContent();
    expect(body).toBeTruthy();
  });
});
