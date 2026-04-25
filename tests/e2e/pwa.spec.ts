import { test, expect } from '@playwright/test';

test.describe('PWA', () => {
  test('manifest link present and well-formed', async ({ page, request }) => {
    await page.goto('/en/');

    const manifestHref = await page.locator('link[rel="manifest"]').getAttribute('href');
    expect(manifestHref).toBeTruthy();

    // Resolve relative-to-base href against current origin for fetch.
    const url = new URL(manifestHref!, page.url()).toString();
    const res = await request.get(url);
    expect(res.ok(), `manifest fetch failed: ${res.status()}`).toBe(true);

    const json = await res.json();
    expect(json.name).toBeTruthy();
    expect(json.short_name).toBeTruthy();
    expect(json.start_url).toBeTruthy();
    expect(Array.isArray(json.icons)).toBe(true);
    expect(json.icons.length).toBeGreaterThan(0);
    expect(json.icons[0].src).toBeTruthy();
  });

  test('theme-color meta tag set', async ({ page }) => {
    await page.goto('/en/');
    const theme = await page.locator('meta[name="theme-color"]').getAttribute('content');
    expect(theme).toMatch(/^#[0-9a-fA-F]{3,8}$/);
  });

  test.skip(
    true,
    // BaseLayout.astro registers SW only when hostname !== localhost/127.0.0.1
    // by design. Asserting `serviceWorker.controller` would require deploying
    // to a non-localhost host or stubbing the layout. Skipped — manual test
    // covers it on prod.
    'SW only registers on non-localhost hosts; cannot exercise from preview',
  );
  test('service worker registers on prod-like host', async () => {
    // intentional skip placeholder — see test.skip above
  });
});
