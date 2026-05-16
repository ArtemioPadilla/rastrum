/**
 * Canonical in-UI toast — fire-and-forget replacement for `window.alert()`.
 * Drives the global `<Toast>` container mounted in `BaseLayout.astro` and
 * `ConsoleLayout.astro`. Mirrors the `confirm-dialog` / `karma-toast`
 * patterns so all global chrome shares one mental model.
 *
 * Non-blocking: callers MUST keep their existing control flow (the `return;`
 * after a failed-path `alert()` stays). Do NOT await `showToast`.
 *
 * SSR-safe: a no-op when `document` is undefined.
 */

export type ToastVariant = 'success' | 'error' | 'info';

export interface ToastOptions {
  message: string;
  variant?: ToastVariant;
  /** 0 = sticky (manual dismiss only). Default 4000ms. */
  durationMs?: number;
}

export const TOAST_CONTAINER_ID = 'rastrum-toast-container';

const DEFAULT_DURATION_MS = 4000;

function variantClass(variant: ToastVariant): string {
  switch (variant) {
    case 'success':
      return 'bg-emerald-700 text-white';
    case 'error':
      return 'bg-red-700 text-white';
    case 'info':
      return 'bg-zinc-800 text-white';
    default: {
      const _exhaustive: never = variant;
      return _exhaustive;
    }
  }
}

function resolveContainer(): HTMLElement {
  let container = document.getElementById(TOAST_CONTAINER_ID);
  if (!container) {
    // Safety net (mirrors karma-toast.ts lazy-container guard): the
    // component is mounted globally, but if a surface renders before it
    // we still create a usable container rather than dropping the toast.
    container = document.createElement('div');
    container.id = TOAST_CONTAINER_ID;
    container.className =
      'fixed left-1/2 -translate-x-1/2 bottom-[calc(5rem+env(safe-area-inset-bottom))] sm:bottom-4 z-50 flex flex-col items-center gap-2 pointer-events-none';
    container.setAttribute('role', 'status');
    container.setAttribute('aria-live', 'polite');
    document.body.appendChild(container);
  }
  return container;
}

export function showToast(opts: ToastOptions): void {
  if (typeof document === 'undefined') return;

  const variant: ToastVariant = opts.variant ?? 'info';
  const durationMs = opts.durationMs ?? DEFAULT_DURATION_MS;
  const container = resolveContainer();

  const dismissLabel =
    container.dataset.dismissLabel ??
    (container.dataset.lang === 'es' ? 'Descartar' : 'Dismiss');

  const el = document.createElement('div');
  el.className =
    `pointer-events-auto flex items-start gap-3 max-w-sm px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 ${variantClass(variant)}`;
  if (variant === 'error') el.setAttribute('role', 'alert');

  const text = document.createElement('span');
  text.className = 'flex-1';
  text.textContent = opts.message;
  el.appendChild(text);

  const dismissBtn = document.createElement('button');
  dismissBtn.type = 'button';
  dismissBtn.textContent = '×';
  dismissBtn.setAttribute('aria-label', dismissLabel);
  dismissBtn.className =
    'shrink-0 -mr-1 px-1 leading-none text-lg opacity-80 hover:opacity-100 focus:outline-none focus:ring-2 focus:ring-white/60 rounded';
  el.appendChild(dismissBtn);

  el.style.opacity = '0';
  el.style.transform = 'translateY(10px)';
  container.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });

  let removeTimer: ReturnType<typeof setTimeout> | null = null;

  function dismiss() {
    if (removeTimer) {
      clearTimeout(removeTimer);
      removeTimer = null;
    }
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 300);
  }

  dismissBtn.addEventListener('click', dismiss);

  if (durationMs > 0) {
    removeTimer = setTimeout(() => {
      el.style.opacity = '0';
      el.style.transform = 'translateY(-10px)';
      setTimeout(() => el.remove(), 300);
    }, durationMs);
  }
}

/** Test-only: drop any reference so the next showToast re-resolves. */
export function _resetToastContainer(): void {
  const existing =
    typeof document !== 'undefined'
      ? document.getElementById(TOAST_CONTAINER_ID)
      : null;
  existing?.remove();
}
