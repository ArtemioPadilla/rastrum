/**
 * Auth helpers — see docs/specs/modules/04-auth.md.
 *
 * Client-side only. Astro pages must import from hydrated islands or
 * <script> blocks; calling these during SSG would crash the build.
 */
import { getSupabase } from './supabase';
import type { Provider } from '@supabase/supabase-js';

// ─────────────────────────── Storage key constants ───────────────────────────
// Centralised here so any change propagates automatically to Header,
// MobileDrawer, PrivacyMatrix and any future consumer.
export const SUPABASE_AUTH_STORAGE_KEY = 'rastrum-auth-v1';
export const HEADER_AVATAR_CACHE_KEY   = 'rastrum.headerAvatar';
export const HEADER_AVATAR_NAME_KEY    = 'rastrum.headerName';

const callbackUrl = () =>
  (typeof window !== 'undefined' ? window.location.origin : '') + '/auth/callback/';

// ───────────────────── Magic link (legacy / fallback) ─────────────────────
/** Request a magic link. Kept for backwards compat — prefer requestEmailOtp. */
export async function sendMagicLink(email: string, redirectTo?: string) {
  return getSupabase().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: redirectTo ?? callbackUrl(),
      shouldCreateUser: true,
    },
  });
}

// ───────────────────── Email OTP (numeric code) ─────────────────────
/**
 * Request an email OTP. Supabase emails the user a 6-digit code AND a magic
 * link. The user can either click the link or paste the code. The code path
 * has higher mobile completion (no app→browser handoff).
 */
export async function requestEmailOtp(email: string) {
  return getSupabase().auth.signInWithOtp({
    email,
    options: {
      emailRedirectTo: callbackUrl(),
      shouldCreateUser: true,
    },
  });
}

/** Verify the 6-digit code the user pasted. */
export async function verifyEmailOtp(email: string, token: string) {
  return getSupabase().auth.verifyOtp({ email, token, type: 'email' });
}

// ───────────────────── PKCE callback ─────────────────────
export async function exchangeCode(code: string) {
  return getSupabase().auth.exchangeCodeForSession(code);
}

// ───────────────────── OAuth ─────────────────────
async function signInWithProvider(provider: Provider, scopes?: string) {
  return getSupabase().auth.signInWithOAuth({
    provider,
    options: {
      redirectTo: callbackUrl(),
      // Force Supabase to land us on /auth/callback/ instead of the dashboard
      // default. The Site URL allow-list already covers this origin.
      ...(scopes ? { scopes } : {}),
    },
  });
}

export const signInWithGoogle = () => signInWithProvider('google');
// `user:email` forces GitHub to return private emails too, so we never need
// the "Allow users without an email" toggle. Keeping that toggle OFF means
// magic-link recovery + Darwin Core attribution always have a contact email.
export const signInWithGitHub = () => signInWithProvider('github', 'read:user user:email');

// ───────────────────── Passkey / WebAuthn ─────────────────────
/**
 * Helpers serialise binary fields between ArrayBuffer and base64url because
 * `navigator.credentials.create()` and `JSON.stringify` don't agree on shapes.
 */
function bufToB64Url(buf: ArrayBuffer): string {
  const bytes = new Uint8Array(buf);
  let bin = '';
  for (let i = 0; i < bytes.length; i++) bin += String.fromCharCode(bytes[i]);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}

function b64UrlToBuf(s: string): ArrayBuffer {
  const pad = '='.repeat((4 - (s.length % 4)) % 4);
  const std = (s + pad).replace(/-/g, '+').replace(/_/g, '/');
  const bin = atob(std);
  const out = new Uint8Array(bin.length);
  for (let i = 0; i < bin.length; i++) out[i] = bin.charCodeAt(i);
  return out.buffer;
}

function serialiseCredentialResponse(cred: PublicKeyCredential): unknown {
  const r = cred.response as AuthenticatorAttestationResponse | AuthenticatorAssertionResponse;
  const base = {
    id: cred.id,
    rawId: bufToB64Url(cred.rawId),
    type: cred.type,
  };
  if ('attestationObject' in r) {
    return {
      ...base,
      response: {
        clientDataJSON: bufToB64Url(r.clientDataJSON),
        attestationObject: bufToB64Url((r as AuthenticatorAttestationResponse).attestationObject),
      },
    };
  }
  const a = r as AuthenticatorAssertionResponse;
  return {
    ...base,
    response: {
      clientDataJSON: bufToB64Url(a.clientDataJSON),
      authenticatorData: bufToB64Url(a.authenticatorData),
      signature: bufToB64Url(a.signature),
      userHandle: a.userHandle ? bufToB64Url(a.userHandle) : null,
    },
  };
}

/**
 * Recursively walk a Supabase-returned PublicKeyCredentialCreationOptions /
 * RequestOptions and convert any base64url-string `challenge` / `id` /
 * `userHandle` fields back into ArrayBuffers, which is what the browser API
 * expects.
 */
type WebAuthnOpts = Record<string, unknown>;
function rehydrateWebAuthnOptions(opts: WebAuthnOpts): WebAuthnOpts {
  const o = JSON.parse(JSON.stringify(opts)) as WebAuthnOpts;
  const conv = (v: unknown): unknown => typeof v === 'string' ? b64UrlToBuf(v) : v;

  if ('challenge' in o) o.challenge = conv(o.challenge);
  if ('user' in o && o.user && typeof o.user === 'object') {
    const u = o.user as Record<string, unknown>;
    if ('id' in u) u.id = conv(u.id);
  }
  for (const key of ['excludeCredentials', 'allowCredentials'] as const) {
    if (Array.isArray(o[key])) {
      o[key] = (o[key] as Array<Record<string, unknown>>).map(c => ({ ...c, id: conv(c.id) }));
    }
  }
  return o;
}

/** Returns true if this browser supports WebAuthn. */
export function passkeySupported(): boolean {
  return typeof window !== 'undefined'
    && typeof window.PublicKeyCredential !== 'undefined';
}

/**
 * Enroll a passkey on the current device. Requires an active aal1 session
 * (i.e. user is already signed in via email/OAuth). Adds the passkey as a
 * second factor; future sign-ins on this device can verify via
 * `verifyPasskey()` instead of an email round-trip.
 */
export async function enrollPasskey(friendlyName = 'This device') {
  const supabase = getSupabase();
  type EnrollResult = { id: string; credential_creation_options?: WebAuthnOpts };
  const { data, error } = await supabase.auth.mfa.enroll({
    factorType: 'webauthn',
    friendlyName,
  } as Parameters<typeof supabase.auth.mfa.enroll>[0]);
  if (error || !data) return { error };

  const enroll = data as unknown as EnrollResult;
  if (!enroll.credential_creation_options) return { error: new Error('No WebAuthn options returned') };

  const publicKey = rehydrateWebAuthnOptions(enroll.credential_creation_options) as unknown as PublicKeyCredentialCreationOptions;
  const cred = await navigator.credentials.create({ publicKey }) as PublicKeyCredential | null;
  if (!cred) return { error: new Error('Passkey creation cancelled') };

  const challenge = await supabase.auth.mfa.challenge({ factorId: enroll.id });
  if (challenge.error) return { error: challenge.error };

  const verify = await supabase.auth.mfa.verify({
    factorId: enroll.id,
    challengeId: challenge.data.id,
    code: JSON.stringify(serialiseCredentialResponse(cred)),
  });
  return { error: verify.error, factorId: enroll.id };
}

/**
 * Sign-in step-up using an existing passkey. Requires the user to already
 * have a Supabase session (we elevate aal1 → aal2 by verifying the passkey).
 * Useful as a "skip the email next time" shortcut on the same device.
 */
export async function verifyPasskey() {
  const supabase = getSupabase();
  const { data: factors } = await supabase.auth.mfa.listFactors();
  const webauthn = factors?.all?.find(
    (f: { factor_type: string; status: string }) =>
      f.factor_type === 'webauthn' && f.status === 'verified'
  );
  if (!webauthn) return { error: new Error('No passkey registered on this account.') };

  type ChallengeData = { id: string; webauthn_options?: WebAuthnOpts };
  const challenge = await supabase.auth.mfa.challenge({ factorId: webauthn.id });
  if (challenge.error) return { error: challenge.error };

  const data = challenge.data as unknown as ChallengeData;
  if (!data.webauthn_options) return { error: new Error('No WebAuthn challenge returned') };

  const publicKey = rehydrateWebAuthnOptions(data.webauthn_options) as unknown as PublicKeyCredentialRequestOptions;
  const cred = await navigator.credentials.get({ publicKey }) as PublicKeyCredential | null;
  if (!cred) return { error: new Error('Passkey verification cancelled') };

  return supabase.auth.mfa.verify({
    factorId: webauthn.id,
    challengeId: data.id,
    code: JSON.stringify(serialiseCredentialResponse(cred)),
  });
}

// ───────────────────── User helpers ─────────────────────
export async function getCurrentUser() {
  const supabase = getSupabase();
  const { data: { user } } = await supabase.auth.getUser();
  return user;
}

/** Sign out of this device only. */
export async function signOut() {
  return getSupabase().auth.signOut();
}

/** Sign out from every device the user is currently signed in on. */
export async function signOutEverywhere() {
  return getSupabase().auth.signOut({ scope: 'global' });
}
