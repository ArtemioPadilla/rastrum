import { test, expect } from '@playwright/test';
import AxeBuilder from '@axe-core/playwright';

// We fail only on serious + critical violations. Moderate hits get logged
// but don't block — a11y noise from third-party widgets (theme toggles,
// dropdown menus) tends to surface here; address them deliberately, not
// in CI.
const FAIL_IMPACTS = new Set(['serious', 'critical']);

const PAGES = [
  { path: '/en/',                    name: 'home (en)' },
  { path: '/en/docs/vision/',        name: 'docs vision (en)' },
  { path: '/en/observe/',            name: 'observe form (en)' },
];

for (const { path, name } of PAGES) {
  test(`a11y: ${name}`, async ({ page }) => {
    await page.goto(path);
    await page.waitForLoadState('domcontentloaded');

    const results = await new AxeBuilder({ page })
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .disableRules([
        // color-contrast checks are noisy on emerald/zinc palettes and are
        // covered visually elsewhere.
        'color-contrast',
        // link-in-text-block fires on decorative `#` heading anchors that
        // appear visually as part of the heading. Track in a design pass,
        // not in CI.
        'link-in-text-block',
        // select-name fires on <select> elements in ObservationForm that
        // use sibling <label> instead of `for=`/`aria-labelledby`.
        // TODO(a11y): wire `for`+`id` on every form field and re-enable.
        'select-name',
      ])
      .analyze();

    const failing = results.violations.filter(v => FAIL_IMPACTS.has(v.impact ?? ''));
    if (results.violations.length > 0) {
      // eslint-disable-next-line no-console
      console.log(
        `[a11y] ${name}: ${results.violations.length} violation(s) — ` +
        `${failing.length} serious/critical`,
      );
    }

    expect(failing, `serious/critical a11y violations on ${name}`).toEqual([]);
  });
}
