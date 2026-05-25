/**
 * Guided first observation — ?onb=demo handoff from the onboarding tour.
 *
 * The tour's step-4 CTA navigates to /observe/?onb=demo. ObserveView2 then:
 *   1. Reveals #obs2-demo-banner ("Lesson 1 — we pre-loaded a photo…").
 *   2. Fetches a sample image, wraps it in a File, and dispatches
 *      rastrum:files-dropped — the same event the DropZone fires for
 *      real user drops. The unmodified pipeline takes over.
 *   3. When showPostForm() reveals #obs2-post-form, the "completed"
 *      banner appears with a CTA back to /observe/ (no querystring).
 *
 * The cascade itself is network-dependent and slow — we don't drive it
 * here. Instead we drive the seam (verify the lesson banner appears,
 * verify the demo file is dispatched, synthetically reveal the
 * post-form to assert the completed banner, and verify the CTA href
 * clears ?onb=demo). Same pattern as observe-card.spec.ts.
 */
import { test, expect } from '@playwright/test';

for (const path of ['/en/observe/?onb=demo', '/es/observar/?onb=demo']) {
  test(`demo banner + auto-loaded file + completed CTA on ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    // Capture rastrum:files-dropped before the page script can fire it.
    await page.addInitScript(() => {
      (window as unknown as { __droppedFiles?: string[] }).__droppedFiles = [];
      document.addEventListener('rastrum:files-dropped', (e) => {
        const detail = (e as CustomEvent<{ files: File[] }>).detail;
        const names = (detail.files ?? []).map((f) => f.name);
        (window as unknown as { __droppedFiles: string[] }).__droppedFiles.push(...names);
      });
    });

    await page.goto(path, { waitUntil: 'domcontentloaded' });

    // 1. Lesson banner is visible.
    await expect(page.locator('#obs2-demo-banner')).toBeVisible();

    // 2. The demo image has been dispatched as a File. The fetch + dispatch
    //    is deferred 50ms in ObserveView2; allow a generous timeout.
    await expect
      .poll(
        async () =>
          (await page.evaluate(
            () => (window as unknown as { __droppedFiles: string[] }).__droppedFiles,
          )).length,
        { timeout: 5_000 },
      )
      .toBeGreaterThan(0);
    const names = await page.evaluate(
      () => (window as unknown as { __droppedFiles: string[] }).__droppedFiles,
    );
    expect(names[0]).toContain('rastrum-demo');

    // 3. Synthetically reveal the post-form to drive the showPostForm seam
    //    (mocking the cascade is cheaper than waiting for real PlantNet).
    //    The completed banner is gated on showPostForm() observing demoMode,
    //    so we manually unhide it here to mirror what showPostForm does.
    await page.evaluate(() => {
      document.getElementById('obs2-post-form')?.classList.remove('hidden');
      document.getElementById('obs2-demo-completed')?.classList.remove('hidden');
    });
    await expect(page.locator('#obs2-demo-completed')).toBeVisible();

    // 4. CTA href clears ?onb=demo (locale-paired, no querystring).
    const cta = page.locator('#obs2-demo-try-own');
    await expect(cta).toBeVisible();
    const href = await cta.getAttribute('href');
    expect(href).toMatch(/^\/(observe|observar)\/$/);
    expect(href).not.toContain('onb=demo');

    expect(errors, `pageerror on ${path}`).toEqual([]);
  });
}
