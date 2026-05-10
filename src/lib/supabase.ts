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
 * In-memory session cache to reduce concurrent navigator.locks contention.
 * Multiple components mounting simultaneously each call auth.getUser() which
 * competes for the gotrue navigator.lock — on Android Chrome with 15+ components
 * this causes "Lock not released within 5000ms" warnings and AbortErrors.
 *
 * This cache holds the last resolved user for the duration of the page load.
 * It is intentionally short-lived (cleared on visibility change) so stale
 * sign-out state never persists across tab switches.
 */
let _userCache: { user: import('@supabase/supabase-js').User | null; resolvedAt: number } | null = null;
const USER_CACHE_TTL_MS = 30_000; // 30s — enough to cover a full page hydration burst
let _sessionCache: { session: import('@supabase/supabase-js').Session | null; resolvedAt: number } | null = null;
const SESSION_CACHE_TTL_MS = 30_000;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      _userCache = null;
      _sessionCache = null;
    }
  });
}

// Invalidate cache on sign-out so components reflect signed-out state immediately.
// We attach this lazily (first getCachedUser() call) to avoid circular initialization.
let _authListenerAttached = false;
function ensureAuthListener() {
  if (_authListenerAttached) return;
  _authListenerAttached = true;
  getSupabase().auth.onAuthStateChange((event) => {
    if (event === 'SIGNED_OUT') {
      _userCache = null;
      _sessionCache = null;
    }
  });
}

/**
 * Returns the current session (including access_token) with a short-lived
 * in-memory cache. Use this instead of `getSupabase().auth.getSession()` in
 * Console components that need access_token for Edge Function calls.
 *
 * Safe for concurrent callers — only one getSession() request fires per
 * 30-second window, preventing navigator.lock contention.
 */
export async function getCachedSession() {
  ensureAuthListener();
  const now = Date.now();
  if (_sessionCache && (now - _sessionCache.resolvedAt) < SESSION_CACHE_TTL_MS) {
    return _sessionCache.session;
  }
  const { data: { session } } = await getSupabase().auth.getSession();
  _sessionCache = { session, resolvedAt: now };
  return session;
}

/**
 * Returns the current user with a short-lived in-memory cache.
 * Use this instead of `getSupabase().auth.getUser()` in components that
 * mount concurrently to avoid navigator.lock contention in gotrue.
 */
export async function getCachedUser() {
  ensureAuthListener();
  const now = Date.now();
  if (_userCache && (now - _userCache.resolvedAt) < USER_CACHE_TTL_MS) {
    return _userCache.user;
  }
  const { data: { user } } = await getSupabase().auth.getUser();
  _userCache = { user, resolvedAt: now };
  return user;
}

/**
 * Returns the singleton Supabase client. Only call from client-side code
 * (hydrated islands or <script> blocks) — Astro SSG pages themselves never
 * need this at build time.
 */
/** Returns the Supabase project URL — safe to call from client-side scripts. */
export function getSupabaseUrl(): string {
  return url ?? '';
}

export function getSupabase(): SupabaseClient {
  if (client) return client;
  // No `lock` option: supabase-js auto-selects its proper `navigatorLock`
  // in browsers when persistSession=true. Passing a custom lock that
  // ignores `acquireTimeout` deadlocks getSession() if a previous holder
  // (e.g. an interrupted token refresh) doesn't release.
  client = createClient(url ?? '', anonKey ?? '', {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      flowType: 'pkce',
      storageKey: 'rastrum-auth-v1',
    },
  });
  return client;
}
