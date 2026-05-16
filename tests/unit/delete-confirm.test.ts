/**
 * Unit tests for the in-UI two-step delete confirmation controller
 * (#1093). The obs-detail "Delete observation" button used to gate on a
 * native window.confirm() — bad UX and it blocked automation/e2e because
 * the dialog defaulted to "cancel" (returning false) so the
 * delete-observation EF call never fired under test. The controller
 * replaces that with an in-panel reveal → [Delete]/[Cancel] step.
 *
 * These tests pin the state-machine + DOM/focus contract; the network
 * boundary (delete-observation EF) is injected via onConfirm and mocked.
 */

import { describe, it, expect, vi, beforeEach } from 'vitest';
import { createDeleteConfirmController } from '../../src/lib/delete-confirm';

function buildDom() {
  document.body.innerHTML = `
    <div id="idle">
      <button id="trigger">Delete observation</button>
    </div>
    <div id="confirm" class="hidden">
      <button id="yes">Delete</button>
      <button id="no">Cancel</button>
    </div>
  `;
  return {
    trigger: document.getElementById('trigger') as HTMLButtonElement,
    idleRow: document.getElementById('idle') as HTMLElement,
    confirmRow: document.getElementById('confirm') as HTMLElement,
    confirmBtn: document.getElementById('yes') as HTMLButtonElement,
    cancelBtn: document.getElementById('no') as HTMLButtonElement,
  };
}

describe('createDeleteConfirmController (#1093)', () => {
  beforeEach(() => {
    document.body.innerHTML = '';
  });

  it('starts idle: confirm row hidden, idle row visible', () => {
    const els = buildDom();
    const ctrl = createDeleteConfirmController(els, vi.fn());
    expect(ctrl.state).toBe('idle');
    expect(els.confirmRow.classList.contains('hidden')).toBe(true);
    expect(els.idleRow.classList.contains('hidden')).toBe(false);
  });

  it('clicking the trigger reveals the confirm row and hides the idle row', () => {
    const els = buildDom();
    const onConfirm = vi.fn();
    const ctrl = createDeleteConfirmController(els, onConfirm);

    els.trigger.click();

    expect(ctrl.state).toBe('confirming');
    expect(els.confirmRow.classList.contains('hidden')).toBe(false);
    expect(els.idleRow.classList.contains('hidden')).toBe(true);
    // Reveal must NOT trigger the delete.
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('moves focus to the safe (Cancel) control on reveal', () => {
    const els = buildDom();
    createDeleteConfirmController(els, vi.fn());
    els.trigger.click();
    expect(document.activeElement).toBe(els.cancelBtn);
  });

  it('Cancel reverts to idle and restores focus to the trigger', () => {
    const els = buildDom();
    const onConfirm = vi.fn();
    const ctrl = createDeleteConfirmController(els, onConfirm);

    els.trigger.click();
    els.cancelBtn.click();

    expect(ctrl.state).toBe('idle');
    expect(els.confirmRow.classList.contains('hidden')).toBe(true);
    expect(els.idleRow.classList.contains('hidden')).toBe(false);
    expect(document.activeElement).toBe(els.trigger);
    expect(onConfirm).not.toHaveBeenCalled();
  });

  it('Esc inside the confirm row reverts to idle', () => {
    const els = buildDom();
    const ctrl = createDeleteConfirmController(els, vi.fn());
    els.trigger.click();

    els.confirmRow.dispatchEvent(
      new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }),
    );

    expect(ctrl.state).toBe('idle');
    expect(els.confirmRow.classList.contains('hidden')).toBe(true);
  });

  it('clicking [Delete] runs onConfirm exactly once', async () => {
    const els = buildDom();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    createDeleteConfirmController(els, onConfirm);

    els.trigger.click();
    els.confirmBtn.click();
    await Promise.resolve();

    expect(onConfirm).toHaveBeenCalledTimes(1);
  });

  it('stays in confirming after [Delete] so caller can show progress/error', async () => {
    const els = buildDom();
    const onConfirm = vi.fn().mockResolvedValue(undefined);
    const ctrl = createDeleteConfirmController(els, onConfirm);

    els.trigger.click();
    els.confirmBtn.click();
    await Promise.resolve();

    expect(ctrl.state).toBe('confirming');
    expect(els.confirmRow.classList.contains('hidden')).toBe(false);
  });

  it('reveal → cancel → reveal again works (idempotent transitions)', () => {
    const els = buildDom();
    const ctrl = createDeleteConfirmController(els, vi.fn());

    els.trigger.click();
    els.cancelBtn.click();
    els.trigger.click();

    expect(ctrl.state).toBe('confirming');
    expect(els.confirmRow.classList.contains('hidden')).toBe(false);
  });

  it('destroy() detaches listeners — trigger no longer reveals', () => {
    const els = buildDom();
    const ctrl = createDeleteConfirmController(els, vi.fn());
    ctrl.destroy();

    els.trigger.click();

    expect(ctrl.state).toBe('idle');
    expect(els.confirmRow.classList.contains('hidden')).toBe(true);
  });
});
