import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('home page does not import HomeWidgets', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`${lang} index.astro has no HomeWidgets import or usage`, () => {
      const path = join(process.cwd(), `src/pages/${lang}/index.astro`);
      const src = readFileSync(path, 'utf8');
      expect(src).not.toMatch(/HomeWidgets/);
    });
  }
});
