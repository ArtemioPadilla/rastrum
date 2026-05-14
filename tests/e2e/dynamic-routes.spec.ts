/**
 * Playwright e2e for every dynamic-resource page converted to query-string
 * routing in issue #1047.
 *
 * Each converted page is a static `index.astro` that reads `slug` / `username`
 * from `Astro.url.searchParams`. Since the index HTML is the same file for
 * every query string, EVERY `?slug=<anything>` must return 200 — even for
 * non-existent slugs (the page renders a client-side "not found" state).
 *
 * Mirrors the working precedent of `/share/obs/?id=<uuid>` (always 200).
 *
 * This spec is the production-fidelity counterpart to the file-existence
 * unit test in `tests/unit/dynamic-routes-parity.test.ts`.
 */
import { test, expect } from '@playwright/test';

const LIST_PAGES = [
  '/en/explore/trails/',
  '/es/explorar/senderos/',
  '/en/explore/pits/',
  '/es/explorar/pits/',
  '/en/explore/species/',
  '/es/explorar/especies/',
  '/en/explore/places/',
  '/es/explorar/lugares/',
];

const SLUG_PATHS = [
  '/en/explore/trails/?slug=test',
  '/es/explorar/senderos/?slug=test',
  '/en/explore/trails/field-guide/?slug=test',
  '/es/explorar/senderos/guia-de-campo/?slug=test',
  '/en/explore/pits/?slug=test',
  '/es/explorar/pits/?slug=test',
  '/en/explore/species/?slug=test',
  '/es/explorar/especies/?slug=test',
  '/en/explore/places/?slug=test',
  '/es/explorar/lugares/?slug=test',
  '/en/profile/u/lists/?username=test&slug=test',
  '/es/perfil/u/listas/?username=test&slug=test',
];

test.describe('dynamic routes — list-page parity (#1047)', () => {
  for (const path of LIST_PAGES) {
    test(`list page resolves: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response, `no response for ${path}`).not.toBeNull();
      expect(response!.status(), `expected 200 for ${path}`).toBe(200);
    });
  }
});

test.describe('dynamic routes — query-string slug deep links (#1047)', () => {
  for (const path of SLUG_PATHS) {
    test(`?slug deep link resolves: ${path}`, async ({ page }) => {
      const response = await page.goto(path);
      expect(response, `no response for ${path}`).not.toBeNull();
      expect(response!.status(), `expected 200 for ${path}`).toBe(200);
    });
  }
});
