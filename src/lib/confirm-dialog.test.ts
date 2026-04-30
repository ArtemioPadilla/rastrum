import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  openConfirmDialog,
  CONFIRM_DIALOG_ID,
  CONFIRM_DIALOG_EVENT,
} from './confirm-dialog';

function mountDialogShell(lang: 'en' | 'es' = 'en') {
  document.body.innerHTML = `
    <div id="${CONFIRM_DIALOG_ID}" class="hidden" data-lang="${lang}"
         data-default-confirm="${lang === 'es' ? 'Confirmar' : 'Confirm'}"
         data-default-cancel="${lang === 'es' ? 'Cancelar' : 'Cancel'}">
      <h2 data-cd-title></h2>
      <p data-cd-message></p>
      <button type="button" data-cd-cancel></button>
      <button type="button" data-cd-confirm></button>
    </div>
  `;
  return document.getElementById(CONFIRM_DIALOG_ID)!;
}

describe('confirm-dialog helper', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  afterEach(() => {
    document.body.innerHTML = '';
  });

  it('returns false when the dialog is not mounted', async () => {
    const result = await openConfirmDialog({ title: 't', message: 'm' });
    expect(result).toBe(false);
  });

  it('renders title + message + default labels and reveals the dialog', async () => {
    const dialog = mountDialogShell('en');
    void openConfirmDialog({ title: 'Block @bob?', message: 'Are you sure?' });
    expect(dialog.classList.contains('hidden')).toBe(false);
    expect(dialog.querySelector<HTMLElement>('[data-cd-title]')!.textContent).toBe('Block @bob?');
    expect(dialog.querySelector<HTMLElement>('[data-cd-message]')!.textContent).toBe('Are you sure?');
    expect(dialog.querySelector<HTMLButtonElement>('[data-cd-confirm]')!.textContent).toBe('Confirm');
    expect(dialog.querySelector<HTMLButtonElement>('[data-cd-cancel]')!.textContent).toBe('Cancel');
  });

  it('overrides labels when caller passes them', async () => {
    const dialog = mountDialogShell('en');
    void openConfirmDialog({
      title: 't',
      message: 'm',
      confirmLabel: 'Block',
      cancelLabel: 'Keep',
    });
    expect(dialog.querySelector<HTMLButtonElement>('[data-cd-confirm]')!.textContent).toBe('Block');
    expect(dialog.querySelector<HTMLButtonElement>('[data-cd-cancel]')!.textContent).toBe('Keep');
  });

  it('uses ES defaults when data-lang="es"', async () => {
    const dialog = mountDialogShell('es');
    void openConfirmDialog({ title: 't', message: 'm' });
    expect(dialog.querySelector<HTMLButtonElement>('[data-cd-confirm]')!.textContent).toBe('Confirmar');
    expect(dialog.querySelector<HTMLButtonElement>('[data-cd-cancel]')!.textContent).toBe('Cancelar');
  });

  it('paints the confirm button red for the danger variant', async () => {
    const dialog = mountDialogShell('en');
    void openConfirmDialog({ title: 't', message: 'm', variant: 'danger' });
    const btn = dialog.querySelector<HTMLButtonElement>('[data-cd-confirm]')!;
    expect(btn.classList.contains('bg-rose-600')).toBe(true);
    expect(btn.classList.contains('bg-emerald-700')).toBe(false);
  });

  it('paints the confirm button emerald for the default variant', async () => {
    const dialog = mountDialogShell('en');
    void openConfirmDialog({ title: 't', message: 'm' });
    const btn = dialog.querySelector<HTMLButtonElement>('[data-cd-confirm]')!;
    expect(btn.classList.contains('bg-emerald-700')).toBe(true);
    expect(btn.classList.contains('bg-rose-600')).toBe(false);
  });

  it('resolves true when a CONFIRM_DIALOG_EVENT with result:true is dispatched', async () => {
    const dialog = mountDialogShell('en');
    const promise = openConfirmDialog({ title: 't', message: 'm' });
    dialog.dispatchEvent(new CustomEvent(CONFIRM_DIALOG_EVENT, { detail: { result: true } }));
    await expect(promise).resolves.toBe(true);
  });

  it('resolves false when a CONFIRM_DIALOG_EVENT with result:false is dispatched', async () => {
    const dialog = mountDialogShell('en');
    const promise = openConfirmDialog({ title: 't', message: 'm' });
    dialog.dispatchEvent(new CustomEvent(CONFIRM_DIALOG_EVENT, { detail: { result: false } }));
    await expect(promise).resolves.toBe(false);
  });

  it('only resolves once per open() call (listener is cleaned up)', async () => {
    const dialog = mountDialogShell('en');
    const first = openConfirmDialog({ title: 't', message: 'm' });
    dialog.dispatchEvent(new CustomEvent(CONFIRM_DIALOG_EVENT, { detail: { result: true } }));
    await expect(first).resolves.toBe(true);

    const second = openConfirmDialog({ title: 't2', message: 'm2' });
    dialog.dispatchEvent(new CustomEvent(CONFIRM_DIALOG_EVENT, { detail: { result: false } }));
    await expect(second).resolves.toBe(false);
  });
});
