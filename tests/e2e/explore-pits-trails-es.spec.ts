/**
 * Playwright e2e for the Trails + PITs explore list surfaces (issue #1027).
 *
 * Asserts that BOTH locales' list pages exist after PR #995 shipped only the
 * EN side. The per-slug pages (`[slug].astro`) use `getStaticPaths() { return [] }`
 * — they don't produce static files for arbitrary slugs, so deep links from
 * dynamic data (TrailsView / PITsView) return 404 in static hosting for both
 * EN and ES. That's a separate routing concern beyond #1027 scope (see PR body).
 *
 * This spec guards against future regressions of the list-page parity: if a PR
 * removes either locale's `/explore/trails/` or `/explorar/senderos/` index
 * page, this fails.
 */
import { test, expect } from '@playwright/test';

const LIST_PAGES = [
  '/en/explore/trails/',
  '/es/explorar/senderos/',
];

test.describe('explore trails — list parity (#1027)', () => {
  for (const path of LIST_PAGES) {
    test(`list page resolves: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response, `no response for ${path}`).not.toBeNull();
      expect(response!.status(), `expected 200 for ${path}`).toBe(200);
    });
  }
});
