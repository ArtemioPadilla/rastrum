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

// In-flight promise deduplication: if N components call getCachedUser/getCachedSession
// simultaneously on a cold start (cache empty), they all share the same single network
// request instead of each firing their own. This is the main fix for the fan-out
// "Failed to fetch" storm seen on Android Chrome when 5+ home widgets mount at once.
let _userFlight: Promise<import('@supabase/supabase-js').User | null> | null = null;
let _sessionFlight: Promise<import('@supabase/supabase-js').Session | null> | null = null;

if (typeof document !== 'undefined') {
  document.addEventListener('visibilitychange', () => {
    if (document.visibilityState === 'hidden') {
      _userCache = null;
      _sessionCache = null;
    }
  });
}

// Single shared gotrue subscription, fanned out to in-process listeners.
// Each direct `supabase.auth.onAuthStateChange()` registers a gotrue
// subscription whose INITIAL_SESSION replay + internal `_useSession`
// path acquires the single navigator lock (`lock:rastrum-auth-v1`).
// Five chrome islands (Header/MobileBottomBar/MobileDrawer/BellIcon/
// BanBanner) each subscribing → lock contention → "Lock not released
// within 5000ms" → an in-flight destructive call's auth gets stolen
// (`AbortError: Lock broken … 'steal'`), which is the delete-hang in
// #1098. Collapsing every subscriber onto ONE shared gotrue listener +
// a lightweight callback registry leaves a single lock acquirer. The
// SIGNED_OUT cache-invalidation semantics (#1064) are unchanged.
type AuthChangeCb = (
  event: string,
  session: import('@supabase/supabase-js').Session | null,
) => void;
const _authListeners = new Set<AuthChangeCb>();

let _authListenerAttached = false;
function ensureAuthListener() {
  if (_authListenerAttached) return;
  _authListenerAttached = true;
  getSupabase().auth.onAuthStateChange((event, session) => {
    if (event === 'SIGNED_OUT') {
      _userCache = null;
      _sessionCache = null;
    }
    for (const cb of _authListeners) {
      try { cb(event, session); } catch { /* one listener must not break the rest */ }
    }
  });
}

/**
 * Subscribe to auth-state changes through the single shared gotrue
 * listener instead of calling `getSupabase().auth.onAuthStateChange()`
 * directly (each direct call adds a navigator-lock acquirer — the
 * lock-steal root cause of #1076/#1098). Mirrors gotrue's contract: the
 * callback fires once with `('INITIAL_SESSION', <current session>)` on
 * subscribe (via the dedup'd cached session — no extra lock) so callers
 * that paint from the initial session still do, then on every change.
 *
 * Returns an unsubscribe function. Today's callers are chrome islands
 * that live for the whole session, so none call it. But any caller in a
 * dynamic context (SPA navigation, a conditionally-mounted island, a
 * component teardown) MUST call it on unmount — otherwise the callback
 * stays in `_authListeners` and leaks (and keeps firing against dead
 * DOM):
 *
 * ```ts
 * const off = onAuthChange((event, session) => paint(!!session));
 * onCleanup(off); // or: element.addEventListener('rastrum:unmount', off)
 * ```
 */
export function onAuthChange(cb: AuthChangeCb): () => void {
  ensureAuthListener();
  _authListeners.add(cb);
  getCachedSession()
    .then((session) => { if (_authListeners.has(cb)) cb('INITIAL_SESSION', session); })
    .catch(() => { /* offline / no session — skip the initial fire */ });
  return () => { _authListeners.delete(cb); };
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
  // Dedup concurrent callers: all share one in-flight request.
  if (!_sessionFlight) {
    _sessionFlight = getSupabase().auth.getSession()
      .then(({ data: { session } }) => {
        _sessionCache = { session, resolvedAt: Date.now() };
        return session;
      })
      .catch(() => null)  // Network failure — return null, don't crash callers.
      .finally(() => { _sessionFlight = null; });
  }
  return _sessionFlight;
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
  // Dedup concurrent callers: all share one in-flight request.
  if (!_userFlight) {
    _userFlight = getSupabase().auth.getUser()
      .then(({ data: { user } }) => {
        _userCache = { user, resolvedAt: Date.now() };
        return user;
      })
      .catch(() => null)  // Network failure — return null, don't crash callers.
      .finally(() => { _userFlight = null; });
  }
  return _userFlight;
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
