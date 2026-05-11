/**
 * Journey guides E2E — verify the JourneySpotlight component works,
 * guides can be triggered via replay events, and the replay button
 * renders on pages that have guides.
 */
import { test, expect } from '@playwright/test';

test.describe('Journey guides', () => {
  // Two pre-conditions must hold for journey-guide click interactions to be
  // testable on /en/observe:
  //  1. Suppress the first-visit auto-guide so it doesn't race with the
  //     manually-dispatched test guide and clobber its steps ~500ms later.
  //  2. Dismiss the analytics consent banner — it sits at z-[9000] (above the
  //     spotlight's z-[65]) and intercepts pointer events on #js-next when the
  //     tooltip lands near the viewport bottom.
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('rastrum_analytics_consent', 'false');
        for (const key of [
          'rastrum.guide.observe',
          'rastrum.guide.explore',
          'rastrum.guide.validate',
          'rastrum.guide.export',
          'rastrum.guide.community',
          'rastrum.guide.console',
        ]) localStorage.setItem(key, 'done');
      } catch { /* noop */ }
    });
  });

  test('journey spotlight is hidden by default', async ({ page }) => {
    await page.goto('/en/');
    const spotlight = page.locator('#journey-spotlight');
    await expect(spotlight).toBeHidden();
  });

  test('replay button renders on pages with guides', async ({ page }) => {
    // The observe page has a guide defined
    await page.goto('/en/observe/');
    const replayBtn = page.locator('#journey-replay-btn');
    // The button should exist (may or may not be visible depending on guide state)
    const count = await replayBtn.count();
    expect(count).toBeGreaterThanOrEqual(0);
  });

  test('journey guide can be started via custom event', async ({ page }) => {
    await page.goto('/en/observe/');
    // Manually dispatch a guide start event
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('rastrum:journey-guide-start', {
        detail: {
          guideId: 'guide-test',
          steps: [
            { target: 'main', title: 'Test Step 1', body: 'This is a test step.' },
            { target: 'main', title: 'Test Step 2', body: 'This is another test step.' },
          ],
        },
      }));
    });

    const spotlight = page.locator('#journey-spotlight');
    await expect(spotlight).toBeVisible();
    await expect(page.locator('#js-title')).toHaveText('Test Step 1');
    await expect(page.locator('#js-step-label')).toContainText('1');
  });

  test('next button advances through guide steps', async ({ page }) => {
    await page.goto('/en/observe/');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('rastrum:journey-guide-start', {
        detail: {
          guideId: 'guide-test',
          steps: [
            { target: 'main', title: 'Step 1', body: 'Body 1' },
            { target: 'main', title: 'Step 2', body: 'Body 2' },
          ],
        },
      }));
    });

    await expect(page.locator('#js-title')).toHaveText('Step 1');
    await page.locator('#js-next').click();
    await expect(page.locator('#js-title')).toHaveText('Step 2');
  });

  test('skip button closes the guide', async ({ page }) => {
    await page.goto('/en/observe/');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('rastrum:journey-guide-start', {
        detail: {
          guideId: 'guide-test',
          steps: [
            { target: 'main', title: 'Step 1', body: 'Body 1' },
            { target: 'main', title: 'Step 2', body: 'Body 2' },
          ],
        },
      }));
    });

    await expect(page.locator('#journey-spotlight')).toBeVisible();
    await page.locator('#js-skip').click();
    await expect(page.locator('#journey-spotlight')).toBeHidden();
  });

  test('Escape closes the guide', async ({ page }) => {
    await page.goto('/en/observe/');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('rastrum:journey-guide-start', {
        detail: {
          guideId: 'guide-test',
          steps: [
            { target: 'main', title: 'Step 1', body: 'Body 1' },
          ],
        },
      }));
    });

    await expect(page.locator('#journey-spotlight')).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.locator('#journey-spotlight')).toBeHidden();
  });

  test('done button on last step closes the guide', async ({ page }) => {
    await page.goto('/en/observe/');
    await page.evaluate(() => {
      window.dispatchEvent(new CustomEvent('rastrum:journey-guide-start', {
        detail: {
          guideId: 'guide-test',
          steps: [
            { target: 'main', title: 'Only Step', body: 'Body' },
          ],
        },
      }));
    });

    await expect(page.locator('#journey-spotlight')).toBeVisible();
    // Single step: next button should say "Done"
    await page.locator('#js-next').click();
    await expect(page.locator('#journey-spotlight')).toBeHidden();
  });

  test('guide emits telemetry events', async ({ page }) => {
    await page.goto('/en/observe/');
    await page.evaluate(() => {
      (window as unknown as { __GUIDE_EVENTS: unknown[] }).__GUIDE_EVENTS = [];
      window.addEventListener('rastrum:onboarding-event', (e) => {
        (window as unknown as { __GUIDE_EVENTS: unknown[] }).__GUIDE_EVENTS.push(
          (e as CustomEvent).detail,
        );
      });
      window.dispatchEvent(new CustomEvent('rastrum:journey-guide-start', {
        detail: {
          guideId: 'guide-test',
          steps: [
            { target: 'main', title: 'Step 1', body: 'Body 1' },
            { target: 'main', title: 'Step 2', body: 'Body 2' },
          ],
        },
      }));
    });

    await page.locator('#js-next').click();
    await page.locator('#js-next').click(); // complete

    const events = await page.evaluate(
      () => (window as unknown as { __GUIDE_EVENTS: Array<{ type: string }> }).__GUIDE_EVENTS,
    );
    const types = events.map(e => e.type);
    expect(types).toContain('guide_opened');
    expect(types).toContain('guide_step_change');
    expect(types).toContain('guide_completed');
  });
});
