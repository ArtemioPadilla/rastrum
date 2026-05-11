/**
 * EN/ES file-existence parity for explore/trails and explore/pits pages.
 *
 * Issue #1027: PR #995 shipped EN-only routes (`src/pages/en/explore/trails/*`
 * and `src/pages/en/explore/pits/*`) without ES siblings. This unit test
 * catches the regression at build time — far cheaper than discovering it via
 * a 404 in production.
 *
 * Why a unit test instead of e2e: the `[slug].astro` pages return
 * `getStaticPaths() { return [] }`, so static build emits no slug files. A
 * Playwright fetch against `/<locale>/.../some-slug/` returns 404 in both
 * locales (see runbook discussion in PR #1030). File-existence is the right
 * abstraction layer for "did someone ship an EN page without its ES sibling?".
 */
import { describe, it, expect } from 'vitest';
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';

const REPO_ROOT = resolve(__dirname, '..', '..');

const PAGE_PAIRS: Array<{ en: string; es: string }> = [
  // Trails
  { en: 'src/pages/en/explore/trails/index.astro',
    es: 'src/pages/es/explorar/senderos/index.astro' },
  { en: 'src/pages/en/explore/trails/[slug].astro',
    es: 'src/pages/es/explorar/senderos/[slug].astro' },
  { en: 'src/pages/en/explore/trails/[slug]/field-guide.astro',
    es: 'src/pages/es/explorar/senderos/[slug]/guia-de-campo.astro' },
  // PITs
  { en: 'src/pages/en/explore/pits/[slug].astro',
    es: 'src/pages/es/explorar/pits/[slug].astro' },
];

describe('explore trails + pits — EN/ES file parity (#1027)', () => {
  for (const { en, es } of PAGE_PAIRS) {
    it(`EN page exists: ${en}`, () => {
      expect(existsSync(resolve(REPO_ROOT, en)), `missing EN page: ${en}`).toBe(true);
    });
    it(`ES sibling exists: ${es}`, () => {
      expect(existsSync(resolve(REPO_ROOT, es)), `missing ES sibling: ${es}`).toBe(true);
    });
  }
});
