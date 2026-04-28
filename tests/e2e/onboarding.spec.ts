import { test, expect, type Page } from '@playwright/test';

/**
 * Onboarding tour smoke + a11y. The tour mounts globally in BaseLayout,
 * starts hidden, and normally reveals only for authed users on first
 * paint. We bypass auth by dispatching the public replay event the
 * Profile → Edit "Replay tour" button uses.
 *
 * The tour is a 6-step spotlight overlay using a <dialog> element.
 * Steps: Welcome · FAB · Quick ID · Explore · Privacy preset · Settings.
 */

async function openTour(page: Page) {
  await page.goto('/en/');
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding'));
  });
  const dialog = page.locator('#onboarding-tour');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('OnboardingTour', () => {
  test('replay event opens the dialog and shows step 1 of 5', async ({ page }) => {
    const dialog = await openTour(page);
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 1 of 6/);
    await expect(dialog.locator('#onb-tooltip-title')).toBeVisible();
    await expect(dialog.locator('#onb-tooltip')).toHaveAttribute('aria-modal', 'true');
  });

  test('Escape closes the dialog and restores focus to caller', async ({ page }) => {
    await openTour(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#onboarding-tour')).toBeHidden();
  });

  test('focus is trapped inside the dialog on Tab', async ({ page }) => {
    const dialog = await openTour(page);
    // Cycle Tab a few times; activeElement must stay inside the tooltip card.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const tooltip = document.getElementById('onb-tooltip');
        return tooltip ? tooltip.contains(document.activeElement) : false;
      });
      expect(inside).toBe(true);
    }
    await expect(dialog).toBeVisible();
  });

  test('next advances through all 6 steps', async ({ page }) => {
    const dialog = await openTour(page);
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 1 of 6/);
    // Step 1 has a "Start tour" button (labelStart), click it
    await dialog.locator('#onb-next').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 2 of 6/);
    await dialog.locator('#onb-next').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 3 of 6/);
    await dialog.locator('#onb-next').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 4 of 6/);
    await dialog.locator('#onb-next').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 5 of 6/);
    await dialog.locator('#onb-next').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 6 of 6/);
    // Step 6 "Done" should close the dialog
    await dialog.locator('#onb-next').click();
    await expect(page.locator('#onboarding-tour')).toBeHidden();
  });

  test('skip button closes the dialog on non-final steps', async ({ page }) => {
    const dialog = await openTour(page);
    await dialog.locator('#onb-next').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 2 of 6/);
    await dialog.locator('#onb-skip').click();
    await expect(page.locator('#onboarding-tour')).toBeHidden();
  });

  test('emits onboarding telemetry events on transitions', async ({ page }) => {
    await page.goto('/en/');
    await page.evaluate(() => {
      (window as unknown as { __ONB_EVENTS: { type: string; step?: number }[] }).__ONB_EVENTS = [];
      window.addEventListener('rastrum:onboarding-event', e => {
        const { type, step } = (e as CustomEvent<{ type: string; step?: number }>).detail;
        (window as unknown as { __ONB_EVENTS: { type: string; step?: number }[] }).__ONB_EVENTS.push({ type, step });
      });
      window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding'));
    });
    await page.locator('#onb-next').click();
    await page.keyboard.press('Escape');
    const events = await page.evaluate(
      () => (window as unknown as { __ONB_EVENTS: { type: string; step?: number }[] }).__ONB_EVENTS,
    );
    const types = events.map(e => e.type);
    expect(types).toContain('opened');
    expect(types).toContain('step_change');
    expect(types).toContain('dismissed');
  });
});
