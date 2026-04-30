import { test, expect } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.resolve('tests/fixtures/tiny.png');

// /en/observe/ now loads ObserveView2 (Observe 2.0 — Drop & Discover).
// The classic ObservationForm still lives at /en/observe/classic/.
// Tests that need the classic form fields are pointed there.

test.describe('observe form', () => {
  test('Observe 2.0: drop zone and capability banner render (en)', async ({ page }) => {
    await page.goto('/en/observe/');
    await expect(page.locator('h1')).toContainText(/log observation|observation/i);
    // DropZone inputs (new IDs in ObserveView2)
    await expect(page.locator('#dz-capture-input')).toHaveCount(1);
    await expect(page.locator('#dz-gallery-input')).toHaveCount(1);
    // Capability banner
    await expect(page.locator('#obs2-capability-banner')).toHaveCount(1);
  });

  test('classic form: renders all form fields (en)', async ({ page }) => {
    await page.goto('/en/observe/classic/');

    // Photo inputs (camera + gallery)
    await expect(page.locator('#camera-input')).toHaveCount(1);
    await expect(page.locator('#gallery-input')).toHaveCount(1);

    // Audio recorder button
    await expect(page.locator('#audio-record-btn')).toBeVisible();

    // Notes textarea + selects
    await expect(page.locator('textarea[name="notes"]')).toBeVisible();
    await expect(page.locator('select[name="habitat"]')).toBeVisible();
    await expect(page.locator('select[name="weather"]')).toBeVisible();
    await expect(page.locator('select[name="evidence_type"]')).toBeVisible();

    // Submit button
    await expect(page.locator('#submit-btn')).toBeVisible();
  });

  test('classic form: uploads a photo and shows preview thumb', async ({ page }) => {
    await page.goto('/en/observe/classic/');
    await page.setInputFiles('#gallery-input', FIXTURE);

    const grid = page.locator('#photo-grid');
    await expect(grid).not.toHaveClass(/hidden/);
    await expect(grid.locator('img').first()).toBeVisible();
    await expect(grid.locator('button[data-rm]').first()).toBeVisible();
  });

  test('classic form: typing notes updates textarea', async ({ page }) => {
    await page.goto('/en/observe/classic/');
    const notes = page.locator('textarea[name="notes"]');
    await notes.fill('field test note');
    await expect(notes).toHaveValue('field test note');
  });

  test('classic form: renders in Spanish locale', async ({ page }) => {
    await page.goto('/es/observar/clasico/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('#submit-btn')).toBeVisible();
  });
});
