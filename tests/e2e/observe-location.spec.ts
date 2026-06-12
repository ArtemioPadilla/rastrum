/**
 * Observe 2.0 location wiring — data-integrity seam.
 *
 * The ObserveView2 client `<script>` is e2e-gated (tsc/vitest/build never
 * execute it). This spec drives it deterministically — no Supabase writes,
 * no real GPS hardware, no identifier runners: the synthetic audio file has
 * no BirdNET model cached, so the cascade deterministically lands on the
 * "audio skipped" warning and we continue into the post-form. The context
 * goes offline before submit so the outbox row never syncs anywhere.
 *
 * Covers three bugs from the location audit:
 *  1. `rastrum:mappicker-save` (detail.id === 'obs2-map') must update the
 *     location the form will save, the visible GPS status line, and the
 *     picker's initial coords (so re-opening the modal centers on the pick).
 *  2. Submitting with no GPS fix and no picked location must save a DRAFT
 *     (`sync_status: 'draft'`, skipped by the sync engine) — never a
 *     syncable (0,0) null-island record.
 *  3. A GPS fix must reach the edit-mode picker via
 *     `rastrum:mappicker-set-initial` (the `rastrum:mappicker-set` event
 *     only hydrates view-mode pickers).
 */
import { test, expect, type Page } from '@playwright/test';

const PICK = { lat: 19.4326, lng: -99.1332 };

async function dropAudioFile(page: Page) {
  await page.evaluate(() => {
    const file = new File([new Uint8Array(2048)], 'call.webm', { type: 'audio/webm' });
    document.dispatchEvent(new CustomEvent('rastrum:files-dropped', { detail: { files: [file] } }));
  });
}

async function continueToPostForm(page: Page) {
  // No BirdNET model cached -> the lone audio identify node is skipped ->
  // AudioSkippedWarning shows its continue button.
  await page.locator('#obs2-audio-skip-continue').click({ timeout: 15_000 });
  await expect(page.locator('#obs2-post-form')).toBeVisible();
}

async function dispatchMapPickerSave(page: Page, coords: { lat: number; lng: number }) {
  await page.evaluate((c) => {
    window.dispatchEvent(new CustomEvent('rastrum:mappicker-save', {
      detail: { id: 'obs2-map', coords: c },
    }));
  }, coords);
}

function readOutboxRows(page: Page) {
  return page.evaluate(() => new Promise<Array<{
    sync_status: string;
    data: { location: { lat: number; lng: number }; syncStatus: string };
  }>>((resolve, reject) => {
    const req = indexedDB.open('rastrum-v1');
    req.onsuccess = () => {
      const db = req.result;
      const all = db.transaction('observations', 'readonly').objectStore('observations').getAll();
      all.onsuccess = () => { resolve(all.result); db.close(); };
      all.onerror = () => reject(all.error);
    };
    req.onerror = () => reject(req.error);
  }));
}

for (const path of ['/en/observe/', '/es/observar/']) {
  test(`mappicker-save for obs2-map updates the form location on ${path}`, async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.goto(path, { waitUntil: 'domcontentloaded' });
    await dispatchMapPickerSave(page, PICK);

    // Visible status line reflects the pick (this is the observable the
    // observer uses to confirm "the form has my location").
    await expect(page.locator('#obs2-gps-status')).toContainText('19.4326');
    await expect(page.locator('#obs2-gps-status')).toContainText('-99.1332');

    // The edit picker's initial coords were synced back, so re-opening the
    // modal centers on the pick instead of the default Mexico view.
    const modal = page.locator('[data-mappicker-modal="obs2-map"]');
    await expect(modal).toHaveAttribute('data-mappicker-initial-lat', '19.4326');
    await expect(modal).toHaveAttribute('data-mappicker-initial-lng', '-99.1332');

    expect(errors, `pageerror on ${path}`).toEqual([]);
  });
}

test('submit with no GPS and no picked location saves a draft, never a synced (0,0) record', async ({ page }) => {
  await page.goto('/en/observe/', { waitUntil: 'domcontentloaded' });
  await dropAudioFile(page);
  await continueToPostForm(page);

  // Hermetic: nothing may leave the machine after submit.
  await page.context().setOffline(true);
  await page.locator('#obs2-save-btn').click();
  await expect(page.locator('#obs2-success')).toBeVisible();

  const rows = await readOutboxRows(page);
  expect(rows).toHaveLength(1);
  // Null-island fallback must be a draft the sync engine skips — not a
  // syncable record that vanishes from every map (ExploreMap filters 0,0).
  expect(rows[0].sync_status).toBe('draft');
  expect(rows[0].data.syncStatus).toBe('draft');

  // The observer is told it's a draft, not a lie about a saved observation.
  await expect(page.locator('#obs2-success-link')).toContainText(/draft/i);
});

test('picked location is what lands in the outbox record (asDraft false)', async ({ page }) => {
  await page.goto('/en/observe/', { waitUntil: 'domcontentloaded' });
  await dropAudioFile(page);
  await continueToPostForm(page);

  await dispatchMapPickerSave(page, PICK);
  await expect(page.locator('#obs2-gps-status')).toContainText('19.4326');

  await page.context().setOffline(true);
  await page.locator('#obs2-save-btn').click();
  await expect(page.locator('#obs2-success')).toBeVisible();

  const rows = await readOutboxRows(page);
  expect(rows).toHaveLength(1);
  expect(rows[0].sync_status).not.toBe('draft');
  expect(rows[0].data.location.lat).toBeCloseTo(PICK.lat, 5);
  expect(rows[0].data.location.lng).toBeCloseTo(PICK.lng, 5);
});

test.describe('GPS fix centers the edit picker', () => {
  test.use({
    geolocation: { latitude: PICK.lat, longitude: PICK.lng, accuracy: 10 },
    permissions: ['geolocation'],
  });

  test('startGPS dispatches mappicker-set-initial so obs2-map opens at the fix', async ({ page }) => {
    await page.goto('/en/observe/', { waitUntil: 'domcontentloaded' });
    await dropAudioFile(page); // startGPS() runs on files-dropped

    await expect(page.locator('#obs2-gps-status')).toContainText('19.4326');

    // Edit-mode pickers only listen to `rastrum:mappicker-set-initial` —
    // the `-set` event hydrates view-mode pickers and is a silent no-op here.
    const modal = page.locator('[data-mappicker-modal="obs2-map"]');
    await expect(modal).toHaveAttribute('data-mappicker-initial-lat', '19.4326');
    await expect(modal).toHaveAttribute('data-mappicker-initial-lng', '-99.1332');
  });
});
