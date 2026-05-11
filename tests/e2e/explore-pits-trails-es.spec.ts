/**
 * Playwright e2e for the Trails + PITs explore surfaces (issue #1027).
 *
 * Asserts the new slug pairs in `src/i18n/utils.ts` resolve to 200 for both
 * locales. The list pages (`/explore/trails/`, `/explorar/senderos/`) are
 * static; the per-slug pages (`[slug].astro`) accept any slug at runtime
 * and render a client-side "not found" state when no record matches, so a
 * 200 response with a garbage slug is the expected behavior — NOT a 404.
 *
 * The page-creator agents wire up the actual routes; this spec only proves
 * the i18n route table and the page files agree on the URL shape.
 */
import { test, expect } from '@playwright/test';

const ES_PATHS = [
  '/es/explorar/senderos/',
  '/es/explorar/senderos/example-slug/',
  '/es/explorar/pits/example-slug/',
  '/es/explorar/senderos/example-slug/guia-de-campo/',
];

const EN_PATHS = [
  '/en/explore/trails/',
  '/en/explore/pits/example-slug/',
  '/en/explore/trails/example-slug/field-guide/',
];

test.describe('explore trails + pits — ES parity (#1027)', () => {
  for (const path of ES_PATHS) {
    test(`ES route resolves: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response, `no response for ${path}`).not.toBeNull();
      expect(response!.status(), `expected 200 for ${path}`).toBe(200);
    });
  }

  for (const path of EN_PATHS) {
    test(`EN sibling resolves: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response, `no response for ${path}`).not.toBeNull();
      expect(response!.status(), `expected 200 for ${path}`).toBe(200);
    });
  }
});
