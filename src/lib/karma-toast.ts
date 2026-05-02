export interface KarmaToast {
  delta: number;
  reason: string;
  label: string;
  timestamp: number;
}

const TOAST_DURATION_MS = 4000;
let toastContainer: HTMLElement | null = null;

export function showKarmaToast(toast: KarmaToast): void {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'karma-toast-container';
    toastContainer.className = 'fixed bottom-20 right-4 z-50 flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const el = document.createElement('div');
  const sign = toast.delta > 0 ? '+' : '';
  el.className = `pointer-events-auto px-4 py-2 rounded-lg shadow-lg text-sm font-medium transition-all duration-300 ${
    toast.delta > 0
      ? 'bg-emerald-100 text-emerald-800 dark:bg-emerald-900 dark:text-emerald-200'
      : 'bg-red-100 text-red-800 dark:bg-red-900 dark:text-red-200'
  }`;
  el.textContent = `${sign}${Math.round(toast.delta)} karma — ${toast.label}`;
  el.style.opacity = '0';
  el.style.transform = 'translateY(10px)';
  toastContainer.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px)';
    setTimeout(() => el.remove(), 300);
  }, TOAST_DURATION_MS);
}

/**
 * Subscribe to realtime karma_events inserts for this user and show a
 * toast for each new event. Deferred to a future PR — the Supabase
 * Realtime channel setup requires the typed client and auth session.
 */
export function subscribeToKarmaEvents(_userId: string, _supabase: unknown): void {
  // Phase 2 stub — realtime subscription will be wired in a follow-up
  // PR once the karma_events table is populated by award_karma().
}

/**
 * Reset the toast container reference. Used by tests to clean up
 * between runs.
 */
export function _resetToastContainer(): void {
  toastContainer = null;
}
