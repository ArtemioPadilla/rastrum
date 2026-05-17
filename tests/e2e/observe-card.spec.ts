/**
 * Progressive observation card — DOM wiring smoke (#1129 follow-up).
 *
 * The pure render/state logic is unit-tested
 * (observe-card-render/state/vm/*.test.ts). What unit tests can't cover
 * is the ObserveView2 client `<script>` wiring: the `rastrum:card-vm`
 * listener rendering into `#obs2-card-v2`, the action buttons, and the
 * "ver traza" disclosure toggle. This drives that wiring deterministically
 * by dispatching a synthetic CardViewModel — no Supabase, no media, no
 * pipeline (mocking is cheaper than a real cascade per docs/qa-policy.md).
 */
import { test, expect } from '@playwright/test';

const S1B_VM = {
  state: 'S1b',
  sovereignty: 'none',
  reviewRequested: false,
  headline: 'Quercus rugosa',
  sourceLabel: 'onnx_efficientnet_lite0 · 31%',
  trace: [
    {
      source: 'onnx_efficientnet_lite0',
      where: 'device',
      scientificName: 'Quercus rugosa',
      confidence: 0.31,
      outcome: 'primary',
      capped: true,
      createdAt: '2026-05-17T00:00:00.000Z',
    },
  ],
};

for (const path of ['/en/observe/', '/es/observar/']) {
  test(`progressive card renders + ver-traza toggles on ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(path, { waitUntil: 'domcontentloaded' });

    // The card lives inside the post-form (hidden until the pipeline
    // finishes). Reveal it, then drive the seam the pipeline uses.
    await page.evaluate((vm) => {
      document.getElementById('obs2-post-form')?.classList.remove('hidden');
      document.dispatchEvent(new CustomEvent('rastrum:card-vm', { detail: vm }));
    }, S1B_VM);

    const card = page.locator('#obs2-card-v2 [data-card-state="S1b"]');
    await expect(card).toBeVisible();

    // S1b exposes the three observer actions.
    await expect(page.locator('#obs2-card-v2 [data-card-action="affirm"]')).toBeVisible();
    await expect(page.locator('#obs2-card-v2 [data-card-action="other"]')).toBeVisible();
    await expect(page.locator('#obs2-card-v2 [data-card-action="review"]')).toBeVisible();

    // "ver traza" is collapsed by default, opens on click.
    const panel = page.locator('#obs2-card-v2 [data-card-trace-panel]');
    await expect(panel).toBeHidden();
    await page.locator('#obs2-card-v2 [data-card-trace]').first().click();
    await expect(panel).toBeVisible();
    // Capped on-device source is honestly flagged in the trace.
    await expect(panel).toContainText('onnx_efficientnet_lite0');

    expect(errors, `pageerror on ${path}`).toEqual([]);
  });
}
