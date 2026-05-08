import type { SupabaseClient } from '@supabase/supabase-js';
import { KARMA_REASONS } from './karma-config';

export interface KarmaToast {
  delta: number;
  reason: string;
  label: string;
  timestamp: number;
}

export interface KarmaMilestone {
  threshold: number;
  label_en: string;
  label_es: string;
  icon: string;
}

export interface MilestoneToast {
  threshold: number;
  label: string;
  icon: string;
}

interface KarmaEventRow {
  id: number | string;
  user_id: string;
  delta: number;
  reason: string;
  created_at: string;
}

const TOAST_DURATION_MS = 4000;
const MILESTONE_TOAST_DURATION_MS = 8000;
let toastContainer: HTMLElement | null = null;

const reasonLabelMap: Record<string, { en: string; es: string }> = Object.fromEntries(
  KARMA_REASONS.map((r) => [r.id, { en: r.label_en, es: r.label_es }]),
);

let cachedMilestones: KarmaMilestone[] | null = null;
let milestonesPromise: Promise<KarmaMilestone[]> | null = null;

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
 * Fire a celebratory milestone toast. Distinct gold visual, longer duration,
 * larger size to differentiate from the regular delta toast.
 */
export function showMilestoneToast(toast: MilestoneToast): void {
  if (!toastContainer) {
    toastContainer = document.createElement('div');
    toastContainer.id = 'karma-toast-container';
    toastContainer.className = 'fixed bottom-20 right-4 z-50 flex flex-col gap-2 pointer-events-none';
    document.body.appendChild(toastContainer);
  }

  const el = document.createElement('div');
  el.dataset.milestone = String(toast.threshold);
  el.className =
    'pointer-events-auto px-5 py-3 rounded-xl shadow-xl text-base font-semibold transition-all duration-300 ' +
    'bg-amber-500 text-white ring-2 ring-yellow-400 dark:bg-amber-600 dark:ring-yellow-300';
  el.textContent = `${toast.icon} ${toast.label}`;
  el.style.opacity = '0';
  el.style.transform = 'translateY(10px) scale(0.97)';
  toastContainer.appendChild(el);

  requestAnimationFrame(() => {
    el.style.opacity = '1';
    el.style.transform = 'translateY(0) scale(1)';
  });

  setTimeout(() => {
    el.style.opacity = '0';
    el.style.transform = 'translateY(-10px) scale(0.97)';
    setTimeout(() => el.remove(), 300);
  }, MILESTONE_TOAST_DURATION_MS);
}

/**
 * Determine which milestone (if any) the user crossed. Returns the highest
 * single milestone in (prevTotal, newTotal]. If two thresholds fall in that
 * window we fire the highest one — observers crossing 100 and 500 in a single
 * event get the bigger celebration.
 */
export function findCrossedMilestone(
  prevTotal: number,
  newTotal: number,
  milestones: KarmaMilestone[],
): KarmaMilestone | null {
  if (!Number.isFinite(prevTotal) || !Number.isFinite(newTotal) || newTotal <= prevTotal) {
    return null;
  }
  let crossed: KarmaMilestone | null = null;
  for (const m of milestones) {
    if (m.threshold > prevTotal && m.threshold <= newTotal) {
      if (!crossed || m.threshold > crossed.threshold) crossed = m;
    }
  }
  return crossed;
}

export async function loadMilestones(supabase: SupabaseClient): Promise<KarmaMilestone[]> {
  if (cachedMilestones) return cachedMilestones;
  if (milestonesPromise) return milestonesPromise;
  milestonesPromise = (async () => {
    try {
      const { data, error } = await supabase
        .from('karma_milestones')
        .select('threshold, label_en, label_es, icon')
        .order('threshold', { ascending: true });
      if (error) throw error;
      const rows = (data ?? []).map((r) => ({
        threshold: Number(r.threshold),
        label_en: String(r.label_en),
        label_es: String(r.label_es),
        icon: String(r.icon ?? '🏆'),
      }));
      cachedMilestones = rows;
      return rows;
    } catch {
      return [];
    } finally {
      milestonesPromise = null;
    }
  })();
  return milestonesPromise;
}

/**
 * Subscribe to realtime karma_events INSERTs for `userId` and fire a toast
 * for each. Returns an `unsubscribe` callback that is safe to invoke
 * multiple times. The Realtime channel is filtered server-side by
 * `user_id=eq.<userId>`, mirroring the `karma_events_self_read` RLS
 * policy so a viewer cannot subscribe to another user's stream.
 *
 * Tracks a running karma total client-side (seeded from users.karma_total
 * on subscribe) so each INSERT can compute prev/new without a per-event
 * round-trip — and fire a milestone toast when a threshold is crossed.
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
  let runningTotal: number | null = null;
  void loadMilestones(supabase);
  void (async () => {
    try {
      const { data } = await supabase.from('users').select('karma_total').eq('id', userId).maybeSingle();
      const v = (data as { karma_total?: number | null } | null)?.karma_total;
      if (typeof v === 'number') runningTotal = v;
    } catch {
      // Best-effort; if the query fails we simply skip milestone detection
      // until a manual reset.
    }
  })();

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

        if (row.delta > 0 && runningTotal !== null) {
          const prevTotal = runningTotal;
          const newTotal = prevTotal + row.delta;
          runningTotal = newTotal;
          if (cachedMilestones) {
            const crossed = findCrossedMilestone(prevTotal, newTotal, cachedMilestones);
            if (crossed) {
              showMilestoneToast({
                threshold: crossed.threshold,
                label: lang === 'es' ? crossed.label_es : crossed.label_en,
                icon: crossed.icon,
              });
            }
          }
        } else if (runningTotal !== null) {
          runningTotal += row.delta;
        }
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

export function _resetMilestonesCache(): void {
  cachedMilestones = null;
  milestonesPromise = null;
}

export function _setMilestonesCacheForTest(milestones: KarmaMilestone[] | null): void {
  cachedMilestones = milestones;
}
