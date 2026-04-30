/**
 * Wires a single trigger / menu pair as an accessible overflow menu.
 *
 * Behaviour:
 *  - Click the trigger toggles the menu (stopPropagation so the doc
 *    click-outside listener doesn't immediately close it again).
 *  - Click anywhere outside `wrap` closes the menu.
 *  - Esc closes the menu (regardless of focus location, mirroring the
 *    pre-extraction behaviour in the three call sites).
 *  - Keeps `aria-expanded` on the trigger in sync with the menu state.
 *
 * Returns a teardown that detaches the document-level listeners. Per-element
 * listeners on the trigger are anonymous and live as long as the trigger node.
 *
 * `wrap` is the bounding ancestor used for the click-outside check. For
 * single-instance menus (e.g. PublicProfileViewV2's profile-header overflow)
 * it's the wrap div. For list-driven menus it's the per-row wrap.
 */
export interface OverflowMenuOptions {
  onOpen?: () => void;
  onClose?: () => void;
}

export function wireOverflowMenu(
  wrap: HTMLElement,
  trigger: HTMLElement,
  menu: HTMLElement,
  opts: OverflowMenuOptions = {},
): () => void {
  const close = () => {
    if (menu.classList.contains('hidden')) return;
    menu.classList.add('hidden');
    trigger.setAttribute('aria-expanded', 'false');
    opts.onClose?.();
  };
  const open = () => {
    menu.classList.remove('hidden');
    trigger.setAttribute('aria-expanded', 'true');
    opts.onOpen?.();
  };

  const onTrigger = (e: Event) => {
    e.preventDefault();
    e.stopPropagation();
    if (menu.classList.contains('hidden')) open();
    else close();
  };

  const onDocClick = (e: MouseEvent) => {
    if (!wrap.contains(e.target as Node)) close();
  };

  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') close();
  };

  trigger.addEventListener('click', onTrigger);
  document.addEventListener('click', onDocClick);
  document.addEventListener('keydown', onKey);

  return () => {
    trigger.removeEventListener('click', onTrigger);
    document.removeEventListener('click', onDocClick);
    document.removeEventListener('keydown', onKey);
  };
}
