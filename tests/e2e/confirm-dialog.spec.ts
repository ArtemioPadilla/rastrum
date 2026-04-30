import { test, expect } from '@playwright/test';

// E2E for the global ConfirmDialog component mounted in BaseLayout.
// The component lives at #rastrum-confirm-dialog and is hidden by
// default. The page-level helper `openConfirmDialog()` drives it via
// dataset + class toggle; the component's own script handles focus
// trap + Esc + backdrop close, which is what we exercise here.
//
// Strategy: rather than depend on a real consumer (Block flow needs
// auth, delete-photo needs an owner session), we open the dialog by
// directly applying the same DOM mutations the helper would, then
// listen for the resolve event the same way the helper does.

const ROUTE = '/en/';
const DIALOG_ID = 'rastrum-confirm-dialog';
const RESOLVE_EVENT = 'rastrum:confirm-dialog-resolve';

async function openDialog(
  page: import('@playwright/test').Page,
  opts: { title: string; message: string; confirmLabel?: string; cancelLabel?: string },
) {
  await page.evaluate(
    ({ id, evt, opts }) => {
      const dialog = document.getElementById(id);
      if (!dialog) throw new Error('confirm dialog not mounted');
      const titleEl = dialog.querySelector<HTMLElement>('[data-cd-title]');
      const msgEl = dialog.querySelector<HTMLElement>('[data-cd-message]');
      const cBtn = dialog.querySelector<HTMLButtonElement>('[data-cd-confirm]');
      const xBtn = dialog.querySelector<HTMLButtonElement>('[data-cd-cancel]');
      if (titleEl) titleEl.textContent = opts.title;
      if (msgEl) msgEl.textContent = opts.message;
      if (cBtn && opts.confirmLabel) cBtn.textContent = opts.confirmLabel;
      if (xBtn && opts.cancelLabel) xBtn.textContent = opts.cancelLabel;

      (window as unknown as { __cdResult?: boolean | null }).__cdResult = null;
      const onResolve = (e: Event) => {
        const detail = (e as CustomEvent<{ result: boolean }>).detail;
        (window as unknown as { __cdResult?: boolean | null }).__cdResult = Boolean(detail?.result);
        dialog.removeEventListener(evt, onResolve);
      };
      dialog.addEventListener(evt, onResolve);
      dialog.classList.remove('hidden');
    },
    { id: DIALOG_ID, evt: RESOLVE_EVENT, opts },
  );
}

async function readResult(page: import('@playwright/test').Page): Promise<boolean | null> {
  return page.evaluate(() => (window as unknown as { __cdResult?: boolean | null }).__cdResult ?? null);
}

test.describe('ConfirmDialog (global)', () => {
  test('renders title + message and traps focus inside the dialog', async ({ page }) => {
    await page.goto(ROUTE);
    await openDialog(page, { title: 'Block @bob?', message: 'Cannot be undone.' });

    const dialog = page.locator(`#${DIALOG_ID}`);
    await expect(dialog).toBeVisible();
    await expect(dialog.locator('[data-cd-title]')).toHaveText('Block @bob?');
    await expect(dialog.locator('[data-cd-message]')).toHaveText('Cannot be undone.');

    const cancelBtn = dialog.locator('[data-cd-cancel]');
    const confirmBtn = dialog.locator('[data-cd-confirm]');

    // Focus lands inside the dialog on open.
    await expect(cancelBtn).toBeFocused();

    // Tab from last → first wraps to the cancel button (focus trap).
    await confirmBtn.focus();
    await page.keyboard.press('Tab');
    await expect(cancelBtn).toBeFocused();

    // Shift+Tab from first → last wraps to confirm.
    await page.keyboard.press('Shift+Tab');
    await expect(confirmBtn).toBeFocused();
  });

  test('Esc key closes with false', async ({ page }) => {
    await page.goto(ROUTE);
    await openDialog(page, { title: 'Discard?', message: 'You will lose changes.' });

    const dialog = page.locator(`#${DIALOG_ID}`);
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    expect(await readResult(page)).toBe(false);
  });

  test('backdrop click closes with false', async ({ page }) => {
    await page.goto(ROUTE);
    await openDialog(page, { title: 'Discard?', message: 'You will lose changes.' });

    const dialog = page.locator(`#${DIALOG_ID}`);
    await expect(dialog).toBeVisible();
    // Click the backdrop (top-left corner is outside the inner card).
    await dialog.click({ position: { x: 4, y: 4 } });
    await expect(dialog).toBeHidden();
    expect(await readResult(page)).toBe(false);
  });

  test('confirm button click resolves true', async ({ page }) => {
    await page.goto(ROUTE);
    await openDialog(page, { title: 'Block?', message: 'Confirm block.' });

    const dialog = page.locator(`#${DIALOG_ID}`);
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-cd-confirm]').click();
    await expect(dialog).toBeHidden();
    expect(await readResult(page)).toBe(true);
  });

  test('cancel button click resolves false', async ({ page }) => {
    await page.goto(ROUTE);
    await openDialog(page, { title: 'Block?', message: 'Confirm block.' });

    const dialog = page.locator(`#${DIALOG_ID}`);
    await expect(dialog).toBeVisible();
    await dialog.locator('[data-cd-cancel]').click();
    await expect(dialog).toBeHidden();
    expect(await readResult(page)).toBe(false);
  });
});
