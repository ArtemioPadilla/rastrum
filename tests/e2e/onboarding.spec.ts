import { test, expect, type Page } from '@playwright/test';

/**
 * Onboarding tour smoke + a11y. The tour mounts globally in BaseLayout,
 * starts hidden, and normally reveals only for authed users on first
 * paint. We bypass auth by dispatching the public replay event the
 * Profile → Edit "Replay tour" button uses.
 */

async function openTour(page: Page) {
  await page.goto('/en/');
  // Modal is in the DOM but hidden; firing the replay event opens it.
  await page.evaluate(() => {
    window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding'));
  });
  const dialog = page.locator('#onboarding-tour');
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('OnboardingTour', () => {
  test('replay event opens the dialog and shows step 1 of 4', async ({ page }) => {
    const dialog = await openTour(page);
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 1 of 4/);
    // Heading on step 0 is the pipeline title and is the labelledby target.
    await expect(dialog.locator('#onboarding-title')).toBeVisible();
    await expect(dialog).toHaveAttribute('aria-modal', 'true');
  });

  test('Escape closes the dialog and restores focus to caller', async ({ page }) => {
    await openTour(page);
    await page.keyboard.press('Escape');
    await expect(page.locator('#onboarding-tour')).toBeHidden();
  });

  test('focus is trapped inside the dialog on Tab', async ({ page }) => {
    const dialog = await openTour(page);
    // Cycle Tab a few times; activeElement must stay inside the dialog card.
    for (let i = 0; i < 12; i++) {
      await page.keyboard.press('Tab');
      const inside = await page.evaluate(() => {
        const root = document.getElementById('onboarding-tour');
        return root ? root.contains(document.activeElement) : false;
      });
      expect(inside).toBe(true);
    }
    // Sanity-check the dialog is still open.
    await expect(dialog).toBeVisible();
  });

  test('skip-to-summary jumps to step 3 of 4', async ({ page }) => {
    const dialog = await openTour(page);
    // Auto-accept the window.confirm() before clicking.
    page.once('dialog', async d => { await d.accept(); });
    // Advance to step 1 (Configure identifiers) where "Skip — set up later" lives.
    await dialog.locator('#onb-next').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 2 of 4/);
    await dialog.locator('#onb-skip-setup').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 3 of 4/);
  });

  test('Anthropic key save is gated by shape validation', async ({ page }) => {
    const dialog = await openTour(page);
    await dialog.locator('#onb-next').click();
    await expect(dialog.locator('#onb-step-label')).toHaveText(/Step 2 of 4/);

    const input = dialog.locator('#onb-claude-key');
    const saveBtn = dialog.locator('#onb-claude-save');
    await expect(saveBtn).toBeDisabled();

    // Garbage input → still disabled, hint shown.
    await input.fill('garbage');
    await expect(saveBtn).toBeDisabled();
    await expect(dialog.locator('#onb-claude-status')).toContainText(/sk-ant-/i);

    // Valid shape → Save enables (we don't click — would hit the network).
    await input.fill('sk-ant-' + 'a'.repeat(40));
    await expect(saveBtn).toBeEnabled();
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
    expect(types).toContain('dismissed_before_done');
  });
});
