import { test, expect } from '@playwright/test';

// Command palette e2e — covers open/close, search, navigation.
// The palette loads its search index lazily from /search-index.en.json
// (built by scripts/build-search-index.js before astro build).

test.describe('command palette', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/en/');
  });

  test('⌘K opens the palette (desktop)', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#cmd-palette-backdrop')).not.toHaveClass(/hidden/);
    await expect(page.locator('#cmd-palette-input')).toBeFocused();
  });

  test('Ctrl+K opens the palette (desktop)', async ({ page }) => {
    await page.keyboard.press('Control+k');
    await expect(page.locator('#cmd-palette-backdrop')).not.toHaveClass(/hidden/);
  });

  test('Esc closes the palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#cmd-palette-backdrop')).not.toHaveClass(/hidden/);
    await page.keyboard.press('Escape');
    await expect(page.locator('#cmd-palette-backdrop')).toHaveClass(/hidden/);
  });

  test('clicking backdrop dim closes the palette', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await expect(page.locator('#cmd-palette-backdrop')).not.toHaveClass(/hidden/);
    // Click the dim overlay (the backdrop itself, outside the panel)
    await page.locator('#cmd-palette-dim').click({ force: true });
    await expect(page.locator('#cmd-palette-backdrop')).toHaveClass(/hidden/);
  });

  test('typing "obs" shows New observation action', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.locator('#cmd-palette-input').fill('obs');
    // Wait for debounce + render
    await page.waitForTimeout(200);
    await expect(page.locator('#cmd-palette-listbox')).toContainText('New observation');
  });

  test('typing "obs" shows matching pages', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.locator('#cmd-palette-input').fill('obs');
    await page.waitForTimeout(200);
    // "Observe" page and/or "My observations" page should appear
    const listbox = page.locator('#cmd-palette-listbox');
    await expect(listbox).toContainText(/[Oo]bserv/);
  });

  test('arrow keys navigate rows', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.locator('#cmd-palette-input').fill('obs');
    await page.waitForTimeout(200);
    // ArrowDown should select the first option row
    await page.keyboard.press('ArrowDown');
    const selected = page.locator('#cmd-palette-listbox [role="option"][aria-selected="true"]');
    await expect(selected).toBeVisible();
  });

  test('clicking a page result navigates', async ({ page }) => {
    await page.keyboard.press('Meta+k');
    await page.locator('#cmd-palette-input').fill('observe');
    await page.waitForTimeout(200);
    // Find the Observe page result and click it
    const observeOption = page.locator('#cmd-palette-listbox [role="option"]', { hasText: 'Observe' }).first();
    await expect(observeOption).toBeVisible();
    await observeOption.click();
    await expect(page).toHaveURL(/\/en\/observe\/?$/);
  });

  test('⌕ header button opens palette (desktop)', async ({ page }) => {
    const searchBtn = page.locator('#hdr-search-btn');
    await expect(searchBtn).toBeVisible();
    await searchBtn.click();
    await expect(page.locator('#cmd-palette-backdrop')).not.toHaveClass(/hidden/);
  });
});

// Mobile project: ⌕ button in mobile header opens palette.
// Uses a mobile viewport so `sm:hidden` Tailwind class is not applied.
test.describe('command palette — mobile', () => {
  test('mobile ⌕ button opens palette', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 844 });
    await page.goto('/en/');
    const mobileBtn = page.locator('#hdr-search-btn-mobile');
    await expect(mobileBtn).toBeVisible();
    await mobileBtn.click();
    await expect(page.locator('#cmd-palette-backdrop')).not.toHaveClass(/hidden/);
  });
});
