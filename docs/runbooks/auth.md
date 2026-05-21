# Auth — magic link, OAuth, OTP, passkey, sign-out-everywhere

Operator + developer notes for Rastrum's auth surface. The codebase is
small (one `src/lib/auth.ts` for everything) but the auth flows have
real production-only gotchas — most concentrated under "Known pitfalls"
in CLAUDE.md. This runbook is the index into those + the bits not
covered elsewhere.

## Roadmap items this covers

- `auth-magic-link` — Supabase magic-link auth + guest mode (v0.1).
- `auth-multi` — Google + GitHub OAuth, email OTP code, passkey,
  sign-out-everywhere (v0.1).

## Supported sign-in methods (v1.0)

| Method | Entry point | Server piece | Notes |
|---|---|---|---|
| Magic link | `signInWithMagicLink(email)` | Supabase Auth | Custom SMTP via Resend (see `resend-smtp.md`); built-in free SMTP caps at 3/hr |
| Email OTP | `signInWithOtp(email)` | Supabase Auth | Fallback when the magic-link redirect is unreliable on iOS |
| GitHub OAuth | `signInWithGitHub('read:user user:email')` | Supabase Auth → GitHub | The `user:email` scope is required when the user's GH email is private |
| Google OAuth | `signInWithGoogle()` | Supabase Auth → Google | Logo + privacy/terms URLs uploaded at Google Cloud Console — see `oauth-logo-google` (#3) |
| Passkey (WebAuthn) | `registerPasskey()` / `signInWithPasskey()` | `passkey-*` Edge Functions | Verified end-to-end by `journey-passkey-enroll-then-verify.spec.ts` |
| Guest | `resolveObserverRef()` returns `{kind:'guest'}` | local-only | Outbox row never syncs as guest — observer must sign in before sync |

## Critical invariants

1. **`flowType: 'pkce'` is REQUIRED on `getSupabase()`.** Without it,
   Supabase defaults to the implicit flow with hash fragments and the
   magic link redirect loops on "Verificando tu enlace" in the PWA
   (PR #350 fix).
2. **`resolveObserverRef()` MUST NOT downgrade signed-in to guest on
   transient errors.** The function does a localStorage cache-read
   FIRST (sync, no network, no auth-lock), then a bounded
   `getSession()` race, then guest only if both miss. Anything else
   orphans observations (`syncOne` refuses to sync guest rows). See
   `src/lib/observe.ts` `resolveObserverRef`.
3. **Never call `supabase.auth.onAuthStateChange` directly.** Use
   `onAuthChange()` from `src/lib/auth.ts` — that wrapper exists to
   avoid the #1076 lock-steal regression.
4. **`auth/callback.astro` strips hash + query BEFORE
   `getSupabase()`** with a `hasRun` guard + 8s timeout. The race
   between `detectSessionInUrl` and manual token parsing is what
   caused the PR #350 magic-link loop.
5. **Sign-out-everywhere** uses `supabase.auth.signOut({ scope:
   'global' })` and is the only safe path for "I lost a device" —
   the local-only sign-out is the default `signOut()` button.

## Known pitfalls (cross-references)

See the corresponding rows in CLAUDE.md "Known pitfalls":

- **Magic link redirects to `localhost:3000`** — Supabase Site URL still
  default. Set it at Authentication → URL Configuration + allow-list
  `/auth/callback/`.
- **"rate limit exceeded" after 3 sends** — free-tier SMTP cap. Use
  Resend (`resend-smtp.md`).
- **`flowType: 'pkce'` not set** — see invariant 1 above (PR #350).
- **Magic link loops on "Verificando tu enlace"** — see invariant 4
  (PR #350).
- **403 from `/rest/v1/users` even with valid JWT** — explicit GRANTs
  are in `supabase-schema.sql`; replay `make db-apply` if
  "auto-expose new tables" was off at project creation.
- **OAuth provider returns no email** — GitHub user has private email;
  scope fix is in invariant table above.
- **Custom OAuth domain (`auth.rastrum.org`) fails** — needs Supabase
  Pro ($25/mo); accepted-deferred for v1.0 zero-cost target.
- **`oauth-logo-google` / `oauth-logo-github`** — manual operator
  actions (#3) — Rastrum logo + privacy/terms URLs at the respective
  developer consoles.

## E2E coverage

- `tests/e2e/journey-magic-link-pkce-callback.spec.ts` — happy-path
  PKCE callback.
- `tests/e2e/journey-passkey-enroll-then-verify.spec.ts` — passkey
  enroll → sign-in.
- The auth wrapper invariants are covered by
  `tests/unit/auth*.test.ts` (see `src/lib/auth*.test.ts`).

## When you ship a new auth method

1. Extend `src/lib/auth.ts` (it's the single source of truth).
2. Update `journey-magic-link-pkce-callback` or add a new journey spec.
3. Update this runbook with a new row in the table above.
4. EN + ES UI strings live under `auth.*` in `src/i18n/{en,es}.json`
   (parity is a hard rule).
