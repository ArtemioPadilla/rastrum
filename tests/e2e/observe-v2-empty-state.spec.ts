/**
 * #1024 (backfill of #942 plan §Task 5.4 + issue's single-most-important
 * regression guard) — assert the DropZone is the topmost visual block on a
 * fresh /observe load.
 *
 * Why this test exists:
 *   - PR #949 attempted to reorder the form so the dropzone (the Fogg
 *     ability lever — the only primary action) won the first fold above
 *     capability copy, AI-mode selector, taxon-hint chips, and the active-
 *     observers banner. PR #949 merged as a NO-OP — the reorder was
 *     reverted without anyone noticing because no test pinned the layout.
 *   - PR #942 PR5 redid the reorder for real. Without a regression guard,
 *     a subsequent UI tweak could re-bury the dropzone under chrome and
 *     no CI would catch it.
 *
 * What we assert (mobile viewport, fresh anonymous load):
 *   1. #drop-zone-root is visible.
 *   2. Its top edge sits in the top half of a 812px-tall iPhone viewport.
 *   3. No DOM block (`<div>`, `<section>`, `<form>` etc.) inside the
 *      ObserveView2 shell starts above the dropzone *except* the resume
 *      banner / active-observers banner when they are hidden (display:
 *      none → bounding-box `null`). The h1 sits above the dropzone by
 *      design (it's the page title, not a competing affordance) so we
 *      only count blocks that have an id matching the known competing
 *      surfaces.
 *
 * Auth is intentionally NOT required: the empty state is client-only and
 * the banner that needs an auth user stays hidden when there is no session.
 * Using a real Supabase session would force this test through the auth
 * fixture path, which is overkill for a layout regression.
 */
import { test, expect } from '@playwright/test';

// Match the plan's iPhone-ish viewport — narrow enough that "top of viewport"
// is meaningful (on desktop the dropzone is always above the fold).
const MOBILE_VIEWPORT = { width: 375, height: 812 } as const;
const TOP_HALF_PX = MOBILE_VIEWPORT.height / 2; // 406

for (const path of ['/en/observe/', '/es/observar/']) {
  test(`observe v2 empty: dropzone is in the top half of the mobile viewport on ${path}`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const dropzone = page.locator('#drop-zone-root');
    await expect(dropzone).toBeVisible();

    const box = await dropzone.boundingBox();
    expect(box, '#drop-zone-root should have a bounding box').not.toBeNull();
    if (!box) throw new Error('unreachable — guarded by the assertion above');

    // Header chrome + h1 push the dropzone down some amount; the Fogg
    // contract is that the *primary action* sits in the top half of the
    // viewport so the observer never has to scroll to log an obs.
    expect(box.y, 'dropzone top edge should be in the top half of the viewport').toBeLessThan(
      TOP_HALF_PX,
    );
  });

  test(`observe v2 empty: dropzone wins over competing pre-action chrome on ${path}`, async ({
    page,
  }) => {
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const dropzone = page.locator('#drop-zone-root');
    await expect(dropzone).toBeVisible();
    const dz = await dropzone.boundingBox();
    if (!dz) throw new Error('no dropzone bounding box');

    // Any of these surfaces being rendered *above* the dropzone is a
    // regression of #942 PR5. Each one is the v1 culprit it replaced
    // (capability banner, AI selector, taxon chips, file-hint, the
    // hidden resume banner). Hidden blocks have no bounding box and
    // are skipped — that's the desired behaviour.
    const COMPETING_IDS = [
      'obs2-capability-caption', // capability copy
      'obs2-ai-mode-selector',   // sponsored / own-key / local
      'obs2-file-hint',          // post-drop hint (hidden on empty state)
      'obs2-pipeline-section',   // pipeline graph / stepper (hidden empty)
    ] as const;

    for (const id of COMPETING_IDS) {
      const competitor = page.locator(`#${id}`);
      // Each block exists in the DOM (the page server-renders them all)
      // but may be hidden. Only enforce the ordering when *visible* —
      // that's the actual user-visible regression.
      const visible = await competitor.isVisible().catch(() => false);
      if (!visible) continue;
      const cb = await competitor.boundingBox();
      if (!cb) continue;
      expect(
        cb.y,
        `#${id} must not render above the dropzone (regression of #942 PR5)`,
      ).toBeGreaterThanOrEqual(dz.y);
    }
  });

  test(`observe v2 empty: no-runners empty state stays collapsed on first paint on ${path}`, async ({
    page,
  }) => {
    // The no-runners block (#obs2-no-runners) is only revealed once the
    // capability detector finishes and confirms zero usable runners. On a
    // fresh load with no JS yet resolved it must NOT be visible — if it
    // were, the dropzone would be competing for attention with an amber
    // warning panel during first paint.
    await page.setViewportSize(MOBILE_VIEWPORT);
    await page.goto(path, { waitUntil: 'domcontentloaded' });

    const noRunners = page.locator('#obs2-no-runners');
    await expect(noRunners).toBeHidden();
  });
}
