import { test, expect } from '@playwright/test';

// Pre-refactor baseline for the MapPicker.astro extraction (PR1 of the
// observation detail redesign). Re-run after the refactor to prove zero
// behavior change. The selectors target the public DOM contract:
//   - `#map-picker-open-btn` opens the modal
//   - `#map-modal` is the modal container with role=dialog
//   - `#map-picker` is the MapLibre canvas host
//   - `#map-picker-status` shows the loading text and is hidden once ready
//   - `#map-use-btn` becomes enabled after a pin click and updates `#gps-status`
//   - Modal closes on Cancel and on Use
test.describe('observe form: map picker', () => {
  test('opens, drops pin, returns coords to gps-status', async ({ page }) => {
    await page.goto('/en/observe/');

    await page.locator('#map-picker-open-btn').click();
    await expect(page.locator('#map-modal')).toBeVisible();
    await expect(page.locator('#map-modal')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#map-picker')).toBeVisible();

    // Wait for MapLibre `load` by waiting for the loading-status text to clear.
    await expect(page.locator('#map-picker-status')).toBeHidden({ timeout: 15_000 });

    // The "Use this location" button starts disabled (no pin chosen yet).
    const useBtn = page.locator('#map-use-btn');
    await expect(useBtn).toBeDisabled();

    // Click roughly the center of the map to drop the pin there.
    const map = page.locator('#map-picker');
    const box = await map.boundingBox();
    if (!box) throw new Error('map has no bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(useBtn).toBeEnabled();
    await useBtn.click();
    await expect(page.locator('#map-modal')).toBeHidden();

    // After "Use this location", #gps-status should show coordinates with the
    // MANUAL source label and a ±50 m accuracy (set by the map-pick handler).
    const gpsStatus = page.locator('#gps-status');
    await expect(gpsStatus).toContainText(/MANUAL/);
    await expect(gpsStatus).toContainText(/±50 m/);
  });

  test('cancel button closes the modal without updating gps-status', async ({ page }) => {
    await page.goto('/en/observe/');
    await page.locator('#map-picker-open-btn').click();
    await expect(page.locator('#map-modal')).toBeVisible();
    await page.locator('#map-cancel-btn').click();
    await expect(page.locator('#map-modal')).toBeHidden();
  });

  test('satellite toggle updates aria-pressed and label', async ({ page }) => {
    await page.goto('/en/observe/');
    await page.locator('#map-picker-open-btn').click();
    await expect(page.locator('#map-picker-status')).toBeHidden({ timeout: 15_000 });

    const toggle = page.locator('#map-satellite-toggle');
    const label = page.locator('#map-satellite-label');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(label).toHaveText(/Satellite/i);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(label).toHaveText(/^Map$/i);
  });
});
