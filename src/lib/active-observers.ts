import type { SupabaseClient } from '@supabase/supabase-js';

/**
 * Pure formatter for the active-observers micro-banner (issue #743).
 *
 * Decoupled from the DOM and the Supabase client so the messaging
 * logic — including the NULL-region fallback and the singular/plural
 * branch — can be unit-tested in isolation.
 */

export interface BannerCopy {
  today_n: string;
  today_one: string;
  empty: string;
}

export interface ActiveObserversInput {
  /** Distinct observer count for the user's country today. >= 0. */
  count: number;
  /** Free-text region label ("Oaxaca"). Null if user has no region. */
  region: string | null;
}

export interface ActiveObserversOutput {
  /** Rendered text. Null = do NOT render the banner. */
  text: string | null;
  /** True when the banner should advertise the empty-state CTA. */
  isEmpty: boolean;
}

/**
 * Compute the banner text for a (count, region) pair.
 *
 * Returns `{ text: null }` when the region is missing — the banner
 * MUST NOT render copy like "today X people are observing in NULL".
 *
 * Singular / plural / empty branches use distinct copy keys so each
 * locale can pick the right grammatical form rather than relying on a
 * single string with a `count` placeholder.
 */
export function formatActiveObserversBanner(
  input: ActiveObserversInput,
  copy: BannerCopy,
): ActiveObserversOutput {
  const region = (input.region ?? '').trim();
  if (!region) return { text: null, isEmpty: false };

  const count = Math.max(0, Math.trunc(input.count));

  if (count === 0) {
    return {
      text: copy.empty.replace('{region}', region),
      isEmpty: true,
    };
  }

  const template = count === 1 ? copy.today_one : copy.today_n;
  const text = template
    .replace('{count}', String(count))
    .replace('{region}', region);
  return { text, isEmpty: false };
}

/**
 * Subscribe to realtime active-observers count updates for a country.
 *
 * Uses Supabase Realtime postgres_changes on `observations` INSERT/UPDATE
 * to detect new synced observations. On each change, re-fetches the
 * aggregate count via `community_active_observers_today(p_country)` RPC.
 *
 * Privacy: no observer IDs or row data leave the server. The only data
 * the client receives is the integer count from the RPC.
 *
 * Note: pg_notify is Postgres LISTEN/NOTIFY — not Supabase Realtime Broadcast.
 * This implementation uses postgres_changes, the correct Realtime protocol.
 *
 * @returns unsubscribe function — call on component unmount
 */
export function subscribeToActiveObservers(
  supabase: SupabaseClient,
  country: string,
  onCount: (count: number) => void,
): () => void {
  const channel = supabase
    .channel(`active-observers:${country}`)
    .on(
      'postgres_changes',
      { event: '*', schema: 'public', table: 'observations', filter: 'sync_status=eq.synced' },
      async () => {
        // Re-fetch aggregate — never expose row data to client
        try {
          const { data } = await supabase
            .rpc('community_active_observers_today', { p_country: country });
          if (typeof data === 'number') onCount(data);
        } catch { /* silent — banner keeps last known count */ }
      },
    )
    .subscribe();

  return () => { channel.unsubscribe(); };
}
