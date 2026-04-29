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
