import { test, expect } from '@playwright/test';

// PR4 of the obs detail redesign — owner-edit smoke for the Details tab
// of ObsManagePanel.astro.
//
// Strategy: like obs-detail-view.spec.ts, instead of depending on a real
// seeded observation + signed-in owner (which would need a credentialed
// preview database), we drive the panel directly via its DOM contract:
//   - the SSR shell renders the manage panel as `.hidden`
//   - the page script (which would normally call wireManagePanelDetails
//     under viewerIsObserver) is bypassed; the test forces the panel
//     visible and asserts the tab/keyboard contract
//
// A separate E2E variant (gated on E2E_OWNER_SESSION) covers the round-
// trip Supabase persistence; that env var is unset in CI today.

const SAMPLE_ID = '00000000-0000-0000-0000-000000000000';

async function forceShowManagePanel(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    document.getElementById('loading')?.classList.add('hidden');
    document.getElementById('err')?.classList.add('hidden');
    document.getElementById('obs')?.classList.remove('hidden');
    document.getElementById('manage-panel')?.classList.remove('hidden');
  });
}

test.describe('obs detail owner edit — Details tab', () => {
  test('manage panel renders three tabs with Details active by default', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await forceShowManagePanel(page);

    await expect(page.locator('[data-manage-panel]')).toBeVisible();
    await expect(page.locator('#m-tab-details')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#m-tab-location')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#m-tab-photos')).toHaveAttribute('aria-selected', 'false');

    // Details panel visible; Location + Photos hidden.
    await expect(page.locator('#m-panel-details')).toBeVisible();
    await expect(page.locator('#m-panel-location')).toBeHidden();
    await expect(page.locator('#m-panel-photos')).toBeHidden();
  });

  test('Details tab exposes every required field', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await forceShowManagePanel(page);

    await expect(page.locator('#m-observed-at')).toHaveAttribute('type', 'datetime-local');
    await expect(page.locator('#m-habitat')).toBeVisible();
    await expect(page.locator('#m-weather')).toBeVisible();
    await expect(page.locator('#m-establishment')).toBeVisible();
    await expect(page.locator('#m-sci')).toBeVisible();
    await expect(page.locator('#m-notes')).toBeVisible();
    await expect(page.locator('#m-obscure')).toBeVisible();
    await expect(page.locator('#m-save')).toBeVisible();
    await expect(page.locator('#m-delete')).toBeVisible();
  });

  test('habitat select includes seeded options (cloud_forest etc.)', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await forceShowManagePanel(page);

    const opts = await page.locator('#m-habitat option').evaluateAll(
      (els) => els.map((e) => (e as HTMLOptionElement).value),
    );
    expect(opts).toContain('cloud_forest');
    expect(opts).toContain('wetland');
    expect(opts).toContain('agricultural');
  });

  test('clicking Location tab swaps panels and updates aria-selected', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await forceShowManagePanel(page);

    await page.locator('#m-tab-location').click();
    await expect(page.locator('#m-tab-location')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#m-tab-details')).toHaveAttribute('aria-selected', 'false');
    await expect(page.locator('#m-panel-location')).toBeVisible();
    await expect(page.locator('#m-panel-details')).toBeHidden();

    // Location placeholder shows.
    await expect(page.locator('#m-panel-location')).toContainText(/coming soon|llegará pronto/i);
  });

  test('keyboard ArrowRight cycles through tabs (WAI-ARIA tabs pattern)', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await forceShowManagePanel(page);

    await page.locator('#m-tab-details').focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#m-tab-location')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#m-tab-location')).toBeFocused();

    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#m-tab-photos')).toHaveAttribute('aria-selected', 'true');

    // Wrap-around.
    await page.keyboard.press('ArrowRight');
    await expect(page.locator('#m-tab-details')).toHaveAttribute('aria-selected', 'true');
  });

  test.describe('signed-in owner round-trip (gated)', () => {
    test.skip(!process.env.E2E_OWNER_SESSION, 'requires seeded owner session');

    test('owner edits habitat and date, sees Saved, persists across reload', async ({ page }) => {
      await page.goto(`/share/obs/?id=${process.env.E2E_OWNED_OBS_ID}`);
      await expect(page.locator('[data-manage-panel]')).toBeVisible();

      await page.locator('#m-habitat').selectOption('cloud_forest');
      await page.locator('#m-observed-at').fill('2026-04-15T08:30');
      await page.locator('#m-save').click();
      await expect(page.locator('#m-saved')).toBeVisible();

      await page.reload();
      await expect(page.locator('#m-habitat')).toHaveValue('cloud_forest');
    });
  });
});

// PR6 — Photos tab DOM contract.
//
// Like the Details tab tests, we drive the Photos tab via its DOM
// contract instead of depending on a real seeded observation. The
// gated round-trip below covers add + delete against a real Supabase
// session; that env var is unset in CI today.
test.describe('obs detail owner edit — Photos tab', () => {
  test('Photos tab exposes thumbnail grid, add-photo button, and a hidden file input', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await forceShowManagePanel(page);

    await page.locator('#m-tab-photos').click();
    await expect(page.locator('#m-tab-photos')).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#m-panel-photos')).toBeVisible();

    // Grid container, empty-state placeholder, add-photo button, file input.
    await expect(page.locator('#m-photos-grid')).toBeVisible();
    await expect(page.locator('#m-photos-add')).toBeVisible();
    // Hidden file input is type=file accept=image/* multiple.
    const fileInput = page.locator('#m-photos-file-input');
    await expect(fileInput).toHaveAttribute('type', 'file');
    await expect(fileInput).toHaveAttribute('accept', 'image/*');
    await expect(fileInput).toHaveAttribute('multiple', '');
  });

  test('add-photo button click triggers the hidden file input picker', async ({ page }) => {
    await page.goto(`/share/obs/?id=${SAMPLE_ID}`);
    await forceShowManagePanel(page);

    await page.locator('#m-tab-photos').click();

    // Wire a chooser handler; clicking the visible add button should open
    // the system picker (handled here by Playwright's filechooser).
    const [chooser] = await Promise.all([
      page.waitForEvent('filechooser'),
      page.locator('#m-photos-add').click(),
    ]);
    expect(chooser).toBeTruthy();
    expect(chooser.isMultiple()).toBe(true);
  });

  test.describe('signed-in owner round-trip (gated)', () => {
    test.skip(!process.env.E2E_OWNER_SESSION, 'requires seeded owner session');

    // Set E2E_OWNED_OBS_SINGLE_PHOTO to an obs uuid you own that has
    // exactly one photo whose is_primary=true (the cascade source).
    test('owner deletes the only photo → Edited badge surfaces after reload', async ({ page }) => {
      await page.goto(`/share/obs/?id=${process.env.E2E_OWNED_OBS_SINGLE_PHOTO}`);
      await expect(page.locator('[data-manage-panel]')).toBeVisible();

      await page.locator('#m-tab-photos').click();
      await expect(page.locator('#m-photos-grid [data-delete-photo]').first()).toBeVisible();

      page.once('dialog', (d) => d.accept());
      await page.locator('#m-photos-grid [data-delete-photo]').first().click();
      await expect(page.locator('#m-photos-empty')).toBeVisible();

      await page.reload();
      await expect(page.locator('#edited-badge')).toBeVisible();
    });

    test('owner adds a photo → grid count grows by 1', async ({ page }) => {
      await page.goto(`/share/obs/?id=${process.env.E2E_OWNED_OBS_ID}`);
      await page.locator('#m-tab-photos').click();
      const before = await page.locator('#m-photos-grid [data-delete-photo]').count();

      await page.setInputFiles('#m-photos-file-input', process.env.E2E_PHOTO_FIXTURE!);
      await expect(page.locator('#m-photos-grid [data-delete-photo]')).toHaveCount(before + 1);
    });
  });
});
