/**
 * Supabase client — singleton for the PWA.
 *
 * Session is persisted in localStorage so it survives reload, PWA install,
 * and offline use. The JWT auto-refreshes before expiry; when offline, the
 * cached JWT continues to work for Dexie reads (no network call needed).
 *
 * See docs/specs/modules/04-auth.md for the auth flow.
 */
import { createClient, type SupabaseClient } from '@supabase/supabase-js';

const url = import.meta.env.PUBLIC_SUPABASE_URL;
const anonKey = import.meta.env.PUBLIC_SUPABASE_ANON_KEY;

if (!url || !anonKey) {
  // We want a loud failure in dev, silent in production (the landing pages
  // work without Supabase — only auth/observe routes need it).
  if (import.meta.env.DEV) {
    console.warn(
      '[rastrum] PUBLIC_SUPABASE_URL / PUBLIC_SUPABASE_ANON_KEY missing.',
      'Copy .env.example → .env.local and fill them in.'
    );
  }
}

let client: SupabaseClient | null = null;

/**
 * Returns the singleton Supabase client. Only call from client-side code
 * (hydrated islands or <script> blocks) — Astro SSG pages themselves never
 * need this at build time.
 */
export function getSupabase(): SupabaseClient {
  if (client) return client;
  // Use the browser's native Web Locks API for the gotrue mutex (instead
  // of the library's default async-mutex polyfill). Native locks are
  // automatically released when the holder tab/page closes, eliminating
  // the "Lock 'lock:rastrum-auth-v1' was not released within 5000ms"
  // warnings on every page nav.
  const lock = (typeof navigator !== 'undefined' && navigator.locks)
    ? async <T>(name: string, acquireTimeout: number, fn: () => Promise<T>): Promise<T> => {
        return navigator.locks.request(name, { mode: 'exclusive' }, async () => fn());
      }
    : undefined;

  client = createClient(url ?? '', anonKey ?? '', {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storageKey: 'rastrum-auth-v1',
      ...(lock ? { lock } : {}),
    },
  });
  return client;
}
