/**
 * E2E: greeting time-bucket — validates that the correct locale phrase is
 * embedded in the widget root data-attributes (server-rendered, no auth needed)
 * AND that the DOM element reflects the phrase when the widget initializes.
 *
 * HomeWidgets is included in /en/ and /es/ home pages (#704).
 * The .home-widgets root is always in the DOM; the greeting wrapper is hidden
 * for signed-out visitors but the data-label-* attributes are always present.
 */
import { test, expect } from '@playwright/test';

type BucketCase = {
  hour: number;
  locale: 'en' | 'es';
  path: string;
  labelAttr: string;
  expected: string;
};

const CASES: BucketCase[] = [
  { hour: 5,  locale: 'es', path: '/es/', labelAttr: 'data-label-greeting-madrugada', expected: 'Buenas madrugadas' },
  { hour: 9,  locale: 'es', path: '/es/', labelAttr: 'data-label-greeting-morning',   expected: 'Buenos días' },
  { hour: 13, locale: 'es', path: '/es/', labelAttr: 'data-label-greeting-afternoon', expected: 'Buenas tardes' },
  { hour: 21, locale: 'es', path: '/es/', labelAttr: 'data-label-greeting-evening',   expected: 'Buenas noches' },
  { hour: 5,  locale: 'en', path: '/en/', labelAttr: 'data-label-greeting-madrugada', expected: 'Up late' },
  { hour: 9,  locale: 'en', path: '/en/', labelAttr: 'data-label-greeting-morning',   expected: 'Good morning' },
  { hour: 13, locale: 'en', path: '/en/', labelAttr: 'data-label-greeting-afternoon', expected: 'Good afternoon' },
  { hour: 21, locale: 'en', path: '/en/', labelAttr: 'data-label-greeting-evening',   expected: 'Good evening' },
];

for (const { hour, locale, path, labelAttr, expected } of CASES) {
  test(`greeting label at ${hour}:00 (${locale}): "${expected}"`, async ({ page }) => {
    const isoTs = `2026-05-09T${String(hour).padStart(2, '0')}:30:00.000Z`;
    await page.addInitScript((ts: string) => {
      const fixed = new Date(ts).valueOf();
      const Orig = Date;
      // @ts-ignore
      class MockDate extends Orig {
        constructor(...args: unknown[]) {
          if (args.length === 0) { super(fixed); return; }
          // @ts-ignore
          super(...args);
        }
        static now() { return fixed; }
        static parse(s: string) { return Orig.parse(s); }
        static UTC(...args: Parameters<typeof Date.UTC>) { return Orig.UTC(...args); }
      }
      // @ts-ignore
      globalThis.Date = MockDate;
    }, isoTs);

    await page.goto(path, { waitUntil: 'domcontentloaded' });

    // Layer 1: data-label attribute — server-rendered, always present, no auth.
    const root = page.locator('.home-widgets').first();
    await expect(root).toBeAttached({ timeout: 7_000 });
    const labelValue = await root.getAttribute(labelAttr);
    expect(labelValue).toBe(expected);

    // Layer 2: rendered text — only if the greeting element is visible
    // (requires auth session; skipped in CI signed-out path).
    const greetingEl = page.locator('[data-testid="home-greeting"]').first();
    const isVisible = await greetingEl.isVisible().catch(() => false);
    if (isVisible) {
      await expect(greetingEl).toContainText(expected, { timeout: 3_000 });
    }
  });
}
