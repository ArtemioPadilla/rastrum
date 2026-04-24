/**
 * Auth helpers — see docs/specs/modules/04-auth.md.
 *
 * Client-side only. Astro pages must import these from hydrated islands or
 * <script> blocks; calling these during SSG would crash the build (no window).
 */
import { getSupabase } from './supabase';

/** Request a magic link for `email`. Supabase emails the link. */
export async function sendMagicLink(email: string, redirectTo?: string) {
  const supabase = getSupabase();
  const origin = typeof window !== 'undefined' ? window.location.origin : '';
  return supabase.auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo ?? `${origin}/auth/callback/`,
      shouldCreateUser: true,
    },
  });
}

/** Finish the magic-link flow — called by /auth/callback. */
export async function exchangeCode(code: string) {
  const supabase = getSupabase();
  return supabase.auth.exchangeCodeForSession(code);
}

/** Returns the current user (or null). Reads from cached session — no network. */
export async function getCurrentUser() {
  const supabase = getSupabase();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
}

/** Sign out of the PWA. Clears localStorage session. */
export async function signOut() {
  const supabase = getSupabase();
  return supabase.auth.signOut();
}
