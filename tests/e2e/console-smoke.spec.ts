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

  test('/en/console/users/ renders not-auth banner element for an unauth visitor', async ({ page }) => {
    await page.goto('/en/console/users/', { waitUntil: 'domcontentloaded' });
    // #users-not-auth is hidden until JS resolves the session check;
    // assert the element is present in the DOM and contains the right text.
    const notAuth = page.locator('#users-not-auth');
    await expect(notAuth).toHaveText(/don't have console access/i);
    expect(page.url()).not.toContain('500');
    expect(await page.locator('body').textContent()).not.toContain('Internal Server Error');
  });

  test('/en/console/credentials/ renders not-auth banner element for an unauth visitor', async ({ page }) => {
    await page.goto('/en/console/credentials/', { waitUntil: 'domcontentloaded' });
    // #creds-not-auth is hidden until JS resolves the session check;
    // assert the element is present in the DOM and contains the right text.
    const notAuth = page.locator('#creds-not-auth');
    await expect(notAuth).toHaveText(/don't have console access/i);
    expect(page.url()).not.toContain('500');
    expect(await page.locator('body').textContent()).not.toContain('Internal Server Error');
  });

  test('/en/console/sync/ shows the not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/sync/');
    await expect(page.locator('#sync-not-auth')).toHaveText(/console access/i);
    expect(await page.locator('body').textContent()).not.toContain('Internal Server Error');
  });

  test('/en/console/api/ shows the not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/api/');
    await expect(page.locator('#api-not-auth')).toHaveText(/console access/i);
  });

  test('/en/console/cron/ shows the not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/cron/');
    await expect(page.locator('#cron-not-auth')).toHaveText(/console access/i);
  });

  test('/en/console/observations/ shows the not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/observations/');
    await expect(page.locator('#obs-not-auth')).toHaveText(/console access/i);
  });

  test('/en/console/flag-queue/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/flag-queue/');
    await expect(page.locator('#flagq-not-auth')).toHaveText(/console access/i);
  });

  test('/en/console/comments/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/comments/');
    await expect(page.locator('#modcom-not-auth')).toHaveText(/console access/i);
  });

  test('/en/console/bans/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/bans/');
    await expect(page.locator('#bans-not-auth')).toHaveText(/console access/i);
  });

  test('/en/console/validation/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/validation/');
    await expect(page.locator('#exp-val-not-auth')).toHaveText(/console access/i);
  });

  test('/en/console/expertise/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/expertise/');
    await expect(page.locator('#exp-skill-not-auth')).toHaveText(/console access/i);
  });

  test('/en/console/badges/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/badges/');
    await expect(page.locator('#badges-not-auth')).toHaveText(/don't have console access/i);
    expect(await page.locator('body').textContent()).not.toContain('Internal Server Error');
  });

  test('/en/console/taxa/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/taxa/');
    await expect(page.locator('#taxa-not-auth')).toHaveText(/don't have console access/i);
    expect(await page.locator('body').textContent()).not.toContain('Internal Server Error');
  });

  test('/en/console/karma/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/karma/');
    await expect(page.locator('#karma-not-auth')).toHaveText(/don't have console access/i);
    expect(await page.locator('body').textContent()).not.toContain('Internal Server Error');
  });

  test('/en/console/features/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/features/');
    await expect(page.locator('#features-not-auth')).toHaveText(/don't have console access/i);
    expect(await page.locator('body').textContent()).not.toContain('Internal Server Error');
  });

  test('/en/console/bioblitz/ shows not-auth banner for unauth visitor', async ({ page }) => {
    await page.goto('/en/console/bioblitz/');
    await expect(page.locator('#bioblitz-not-auth')).toHaveText(/don't have console access/i);
    expect(await page.locator('body').textContent()).not.toContain('Internal Server Error');
  });
});
