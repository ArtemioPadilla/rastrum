import type { SupabaseClient } from '@supabase/supabase-js';
import { KARMA_REASONS } from './karma-config';

export interface KarmaToast {
  delta: number;
  reason: string;
  label: string;
  timestamp: number;
}

interface KarmaEventRow {
  id: number | string;
  user_id: string;
  delta: number;
  reason: string;
  created_at: string;
}

const TOAST_DURATION_MS = 4000;
let toastContainer: HTMLElement | null = null;

const reasonLabelMap: Record<string, { en: string; es: string }> = Object.fromEntries(
  KARMA_REASONS.map((r) => [r.id, { en: r.label_en, es: r.label_es }]),
);

function resolveLabel(reason: string, lang: 'en' | 'es'): string {
  const entry = reasonLabelMap[reason];
  if (!entry) return reason;
  return lang === 'es' ? entry.es : entry.en;
}

function detectLang(): 'en' | 'es' {
  if (typeof document === 'undefined') return 'en';
  return document.documentElement.lang === 'es' ? 'es' : 'en';
}

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
 * Subscribe to realtime karma_events INSERTs for `userId` and fire a toast
 * for each. Returns an `unsubscribe` callback that is safe to invoke
 * multiple times. The Realtime channel is filtered server-side by
 * `user_id=eq.<userId>`, mirroring the `karma_events_self_read` RLS
 * policy so a viewer cannot subscribe to another user's stream.
 */
type KarmaChannel = {
  on: (
    event: string,
    filter: { event: string; schema: string; table: string; filter: string },
    handler: (payload: { new: KarmaEventRow }) => void,
  ) => KarmaChannel;
  subscribe: () => KarmaChannel;
};

export function subscribeToKarmaEvents(
  userId: string,
  supabase: SupabaseClient,
): () => void {
  // supabase-js v2 types model postgres_changes only via overloads that
  // depend on a generic Database schema; the runtime signature is the
  // looser KarmaChannel shape above.
  const channel = (supabase.channel(`karma_events:${userId}`) as unknown as KarmaChannel)
    .on(
      'postgres_changes',
      {
        event: 'INSERT',
        schema: 'public',
        table: 'karma_events',
        filter: `user_id=eq.${userId}`,
      },
      (payload) => {
        const row = payload?.new;
        if (!row || typeof row.delta !== 'number') return;
        const lang = detectLang();
        showKarmaToast({
          delta: row.delta,
          reason: row.reason,
          label: resolveLabel(row.reason, lang),
          timestamp: Date.parse(row.created_at) || Date.now(),
        });
      },
    )
    .subscribe();

  let removed = false;
  return () => {
    if (removed) return;
    removed = true;
    try {
      supabase.removeChannel(channel as unknown as Parameters<SupabaseClient['removeChannel']>[0]);
    } catch {
      // Channel may already be torn down by the client.
    }
  };
}

export function _resetToastContainer(): void {
  toastContainer = null;
}
