/**
 * Nightly production smoke tests for rastrum.org
 *
 * These run against the live site (BASE_URL=https://rastrum.org) via the
 * smoke-nightly.yml workflow. They are intentionally minimal — the goal is
 * to detect outright crashes or CDN/deploy failures, not to replicate the
 * full E2E suite.
 *
 * Keep total runtime under 30 s.
 */
import { test, expect, type ConsoleMessage } from '@playwright/test';

/** Console errors that are acceptable on a live production site. */
const IGNORED_CONSOLE = [
  /Failed to load resource/i,
  /supabase/i,
  /sw\.js/i,
  /favicon/i,
  /maplibre/i,
  /webgl/i,
];

function isFatalConsoleError(msg: ConsoleMessage): boolean {
  if (msg.type() !== 'error') return false;
  const text = msg.text();
  return !IGNORED_CONSOLE.some(rx => rx.test(text));
}

test.describe('production smoke', () => {
  test('home page loads and title contains Rastrum', async ({ page }) => {
    const errors: string[] = [];
    page.on('console', msg => {
      if (isFatalConsoleError(msg)) errors.push(`[console] ${msg.text()}`);
    });
    page.on('pageerror', err => errors.push(`[pageerror] ${err.message}`));

    const response = await page.goto('/en/', { waitUntil: 'domcontentloaded' });
    expect(response, 'Navigation returned no response').not.toBeNull();
    expect(response!.status(), 'Home page returned non-2xx status').toBeLessThan(400);

    await expect(page).toHaveTitle(/Rastrum/i);

    // Best-effort: fail only on clear JS errors
    expect(errors, 'Unexpected console errors on home page').toEqual([]);
  });

  test('explore/recent page loads', async ({ page }) => {
    const response = await page.goto('/en/explore/recent/', {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Navigation returned no response').not.toBeNull();
    expect(response!.status(), '/en/explore/recent/ returned non-2xx status').toBeLessThan(400);
    await expect(page).toHaveTitle(/\S/);
  });

  test('observation share page loads', async ({ page }) => {
    const obsId = '320351cb-fa3b-45d5-b979-5cfb9ccac469';
    const response = await page.goto(`/share/obs/?id=${obsId}`, {
      waitUntil: 'domcontentloaded',
    });
    expect(response, 'Navigation returned no response').not.toBeNull();
    expect(response!.status(), `share/obs/?id=${obsId} returned non-2xx status`).toBeLessThan(400);
    await expect(page).toHaveTitle(/\S/);
  });
});
