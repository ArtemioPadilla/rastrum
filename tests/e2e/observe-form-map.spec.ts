import { test, expect } from '@playwright/test';

// Regression test for the MapPicker.astro extraction (PR1 of the obs detail
// redesign). MapPicker IDs are suffixed with the `pickerId` prop so multiple
// instances on one page never collide; ObservationForm passes pickerId="observe".
// Selectors below target that public DOM contract:
//   #map-picker-open-btn-observe   — opens the modal
//   #map-modal-observe             — modal container, role=dialog
//   #map-picker-observe            — MapLibre canvas host
//   #map-picker-status-observe     — loading status; hidden once ready
//   #map-use-btn-observe           — enabled after pin click; updates #gps-status
//   #map-cancel-btn-observe        — closes the modal
//   #map-satellite-toggle-observe  — flips aria-pressed + the label inside it
test.describe('observe form: map picker', () => {
  test('opens, drops pin, returns coords to gps-status', async ({ page }) => {
    await page.goto('/en/observe/classic/');

    await page.locator('#map-picker-open-btn-observe').click();
    await expect(page.locator('#map-modal-observe')).toBeVisible();
    await expect(page.locator('#map-modal-observe')).toHaveAttribute('role', 'dialog');
    await expect(page.locator('#map-picker-observe')).toBeVisible();

    await expect(page.locator('#map-picker-status-observe')).toBeHidden({ timeout: 15_000 });

    const useBtn = page.locator('#map-use-btn-observe');
    await expect(useBtn).toBeDisabled();

    const map = page.locator('#map-picker-observe');
    const box = await map.boundingBox();
    if (!box) throw new Error('map has no bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(useBtn).toBeEnabled();
    await useBtn.click();
    await expect(page.locator('#map-modal-observe')).toBeHidden();

    const gpsStatus = page.locator('#gps-status');
    await expect(gpsStatus).toContainText(/MANUAL/);
    await expect(gpsStatus).toContainText(/±50 m/);
  });

  test('cancel button closes the modal without updating gps-status', async ({ page }) => {
    await page.goto('/en/observe/classic/');
    await page.locator('#map-picker-open-btn-observe').click();
    await expect(page.locator('#map-modal-observe')).toBeVisible();
    await page.locator('#map-cancel-btn-observe').click();
    await expect(page.locator('#map-modal-observe')).toBeHidden();
  });

  test('satellite toggle updates aria-pressed and label', async ({ page }) => {
    await page.goto('/en/observe/classic/');
    await page.locator('#map-picker-open-btn-observe').click();
    await expect(page.locator('#map-picker-status-observe')).toBeHidden({ timeout: 15_000 });

    const toggle = page.locator('#map-satellite-toggle-observe');
    const label = toggle.locator('[data-mappicker-satellite-label="observe"]');
    await expect(toggle).toHaveAttribute('aria-pressed', 'false');
    await expect(label).toHaveText(/Satellite/i);
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-pressed', 'true');
    await expect(label).toHaveText(/^Map$/i);
  });
});
