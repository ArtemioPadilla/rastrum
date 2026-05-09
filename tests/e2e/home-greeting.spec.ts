/**
 * E2E: greeting time-bucket flip at 06:00 / 12:00 / 19:00
 *
 * Tests the greeting text rendered in `.hw-greeting-text[data-testid="home-greeting"]`
 * for all four time buckets in both EN and ES. Date is mocked via addInitScript
 * so the test is deterministic regardless of when it runs.
 *
 * Spec: tests/unit/home-greeting.test.ts covers the pure helper (bucketForHour);
 * this suite covers the rendered DOM end-to-end.
 *
 * Note: the greeting element is populated client-side after Supabase session probe.
 * For signed-out visitors the greeting phrase still renders (no-name form) using
 * the time-bucket label from the data-attributes on the widget root.
 */
import { test, expect } from '@playwright/test';

type GreetingCase = {
  hour: number;
  locale: 'en' | 'es';
  path: string;
  expected: string;
};

const CASES: GreetingCase[] = [
  // ES — four buckets
  { hour: 5,  locale: 'es', path: '/es/', expected: 'Buenas madrugadas' },
  { hour: 9,  locale: 'es', path: '/es/', expected: 'Buenos días' },
  { hour: 13, locale: 'es', path: '/es/', expected: 'Buenas tardes' },
  { hour: 21, locale: 'es', path: '/es/', expected: 'Buenas noches' },
  // EN — four buckets
  { hour: 5,  locale: 'en', path: '/en/', expected: 'Up late' },
  { hour: 9,  locale: 'en', path: '/en/', expected: 'Good morning' },
  { hour: 13, locale: 'en', path: '/en/', expected: 'Good afternoon' },
  { hour: 21, locale: 'en', path: '/en/', expected: 'Good evening' },
];

for (const { hour, locale, path, expected } of CASES) {
  test(`greeting at ${hour}:00 (${locale}): "${expected}"`, async ({ page }) => {
    // Mock Date.now() and `new Date()` before any page scripts run.
    // Use a fixed UTC timestamp at the given hour (UTC). Since
    // HomeWidgets reads `.getHours()` which is local-time, CI machines
    // in UTC will get the right bucket directly. Tests that care about
    // TZ differences belong to unit coverage.
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

    // The greeting element is hydrated synchronously once the script runs.
    // Wait up to 5 s for the text to appear.
    const greetingEl = page.locator('[data-testid="home-greeting"]').first();
    await expect(greetingEl).toContainText(expected, { timeout: 5_000 });
  });
}
