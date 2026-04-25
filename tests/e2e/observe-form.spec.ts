import { test, expect } from '@playwright/test';
import path from 'node:path';

const FIXTURE = path.resolve('tests/fixtures/tiny.png');

// We never click "Submit" here. The submit handler in ObservationForm.astro
// requires a Supabase session OR persists to Dexie + tries to sync — both
// would either need a real backend or pollute IndexedDB across runs.
// Instead, we assert the form's structural pieces render.

test.describe('observe form', () => {
  test('renders all form fields (en)', async ({ page }) => {
    await page.goto('/en/observe/');

    await expect(page.locator('h1')).toContainText(/observation/i);

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

    // Submit button — present, but we don't click it.
    await expect(page.locator('#submit-btn')).toBeVisible();
  });

  test('uploads a photo and shows preview thumb', async ({ page }) => {
    await page.goto('/en/observe/');
    await page.setInputFiles('#gallery-input', FIXTURE);

    const grid = page.locator('#photo-grid');
    await expect(grid).not.toHaveClass(/hidden/);
    await expect(grid.locator('img').first()).toBeVisible();
    await expect(grid.locator('button[data-rm]').first()).toBeVisible();
  });

  test('typing notes updates textarea', async ({ page }) => {
    await page.goto('/en/observe/');
    const notes = page.locator('textarea[name="notes"]');
    await notes.fill('field test note');
    await expect(notes).toHaveValue('field test note');
  });

  test('renders in Spanish locale', async ({ page }) => {
    await page.goto('/es/observar/');
    await expect(page.locator('html')).toHaveAttribute('lang', 'es');
    await expect(page.locator('#submit-btn')).toBeVisible();
  });
});
