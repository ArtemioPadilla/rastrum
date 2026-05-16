// Pure two-step inline-confirm controller for destructive affordances
// (#1093). Replaces native `window.confirm()` for the obs-detail "Delete
// observation" button: clicking the trigger reveals an in-panel confirm
// row ("Delete this observation? This can't be undone." + [Delete]
// [Cancel]); Cancel / Esc reverts to the idle state.
//
// The controller is intentionally DOM-thin and side-effect-free beyond
// toggling `.hidden` + moving focus, so the reveal → cancel → confirm
// state transitions are unit-testable in happy-dom without mocking the
// network. The actual delete call is injected via `onConfirm`.

export interface DeleteConfirmElements {
  /** The initial "Delete observation" trigger button. */
  trigger: HTMLElement;
  /** Container shown in the idle state (the normal Save/Delete row). */
  idleRow: HTMLElement;
  /** Container shown once the trigger is clicked (the confirm prompt). */
  confirmRow: HTMLElement;
  /** "Delete" button inside the confirm row — runs onConfirm. */
  confirmBtn: HTMLElement;
  /** "Cancel" button inside the confirm row — reverts to idle. */
  cancelBtn: HTMLElement;
}

export interface DeleteConfirmController {
  /** Current state — exposed for tests / callers. */
  readonly state: 'idle' | 'confirming';
  /** Programmatically reveal the confirm row (same as clicking trigger). */
  reveal(): void;
  /** Programmatically revert to idle (same as Cancel / Esc). */
  cancel(): void;
  /** Detach all listeners. */
  destroy(): void;
}

/**
 * Wire an inline two-step confirmation onto a destructive trigger.
 *
 * Idle → click trigger → confirming (focus moves to Cancel so the
 * default keyboard target is the safe one). Confirming → Cancel/Esc →
 * idle (focus restored to the trigger). Confirming → Delete → onConfirm()
 * is awaited; the controller stays in the confirming state so the caller
 * can disable the button + show progress / error without the row
 * snapping back under the user.
 */
export function createDeleteConfirmController(
  els: DeleteConfirmElements,
  onConfirm: () => void | Promise<void>,
): DeleteConfirmController {
  let state: 'idle' | 'confirming' = 'idle';

  function render(): void {
    const confirming = state === 'confirming';
    els.idleRow.classList.toggle('hidden', confirming);
    els.confirmRow.classList.toggle('hidden', !confirming);
  }

  function reveal(): void {
    if (state === 'confirming') return;
    state = 'confirming';
    render();
    // Move focus to the safe (Cancel) control so an inadvertent Enter
    // does not delete; keyboard users land inside the new row.
    if (typeof els.cancelBtn.focus === 'function') els.cancelBtn.focus();
  }

  function cancel(): void {
    if (state === 'idle') return;
    state = 'idle';
    render();
    if (typeof els.trigger.focus === 'function') els.trigger.focus();
  }

  function onTriggerClick(): void {
    reveal();
  }

  function onCancelClick(): void {
    cancel();
  }

  async function onConfirmClick(): Promise<void> {
    // Stay in `confirming` — the caller disables the button and surfaces
    // progress / errors. Reverting here would yank the row away mid-call.
    await onConfirm();
  }

  function onKeydown(ev: KeyboardEvent): void {
    if (ev.key === 'Escape' && state === 'confirming') {
      ev.preventDefault();
      cancel();
    }
  }

  els.trigger.addEventListener('click', onTriggerClick);
  els.cancelBtn.addEventListener('click', onCancelClick);
  els.confirmBtn.addEventListener('click', onConfirmClick);
  els.confirmRow.addEventListener('keydown', onKeydown as EventListener);

  render();

  return {
    get state() {
      return state;
    },
    reveal,
    cancel,
    destroy() {
      els.trigger.removeEventListener('click', onTriggerClick);
      els.cancelBtn.removeEventListener('click', onCancelClick);
      els.confirmBtn.removeEventListener('click', onConfirmClick);
      els.confirmRow.removeEventListener('keydown', onKeydown as EventListener);
    },
  };
}
