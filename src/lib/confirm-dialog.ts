/**
 * Promise-based replacement for `window.confirm()` that drives the
 * global `<ConfirmDialog>` mounted in `BaseLayout.astro`. Mirrors the
 * `ReportDialog` open-via-dataset pattern so all global modals share
 * one mental model.
 *
 * Resolves `true` on confirm, `false` on cancel / Esc / backdrop click.
 * Safe to call before the dialog is mounted (returns `false`).
 */

export interface ConfirmDialogOptions {
  title: string;
  message: string;
  confirmLabel?: string;
  cancelLabel?: string;
  variant?: 'default' | 'danger';
}

export const CONFIRM_DIALOG_ID = 'rastrum-confirm-dialog';
export const CONFIRM_DIALOG_EVENT = 'rastrum:confirm-dialog-resolve';

export interface ConfirmDialogResolveDetail {
  result: boolean;
}

export function openConfirmDialog(opts: ConfirmDialogOptions): Promise<boolean> {
  if (typeof document === 'undefined') return Promise.resolve(false);
  const dialog = document.getElementById(CONFIRM_DIALOG_ID);
  if (!dialog) return Promise.resolve(false);

  const titleEl = dialog.querySelector<HTMLElement>('[data-cd-title]');
  const messageEl = dialog.querySelector<HTMLElement>('[data-cd-message]');
  const confirmBtn = dialog.querySelector<HTMLButtonElement>('[data-cd-confirm]');
  const cancelBtn = dialog.querySelector<HTMLButtonElement>('[data-cd-cancel]');

  if (titleEl) titleEl.textContent = opts.title;
  if (messageEl) messageEl.textContent = opts.message;

  const lang = (dialog.dataset.lang === 'es' ? 'es' : 'en') as 'en' | 'es';
  const defaultConfirm = dialog.dataset.defaultConfirm ?? (lang === 'es' ? 'Confirmar' : 'Confirm');
  const defaultCancel = dialog.dataset.defaultCancel ?? (lang === 'es' ? 'Cancelar' : 'Cancel');

  if (confirmBtn) confirmBtn.textContent = opts.confirmLabel ?? defaultConfirm;
  if (cancelBtn) cancelBtn.textContent = opts.cancelLabel ?? defaultCancel;

  const variant = opts.variant ?? 'default';
  if (confirmBtn) {
    const dangerCls = ['bg-rose-600', 'hover:bg-rose-700', 'focus:ring-rose-500'];
    const defaultCls = ['bg-emerald-700', 'hover:bg-emerald-800', 'focus:ring-emerald-500'];
    confirmBtn.classList.remove(...dangerCls, ...defaultCls);
    confirmBtn.classList.add(...(variant === 'danger' ? dangerCls : defaultCls));
  }

  return new Promise<boolean>((resolve) => {
    const onResolve = (e: Event) => {
      const detail = (e as CustomEvent<ConfirmDialogResolveDetail>).detail;
      dialog.removeEventListener(CONFIRM_DIALOG_EVENT, onResolve as EventListener);
      resolve(Boolean(detail?.result));
    };
    dialog.addEventListener(CONFIRM_DIALOG_EVENT, onResolve as EventListener);
    dialog.classList.remove('hidden');
  });
}
