# Module 04 — Authentication

**Version target:** v0.1
**Status:** Not started

---

## Overview

Magic link email auth (primary) + optional passkey/WebAuthn. No passwords. Auth via Supabase Auth. Sessions persist in IndexedDB for offline access. Anonymous/guest mode allowed for first 3 observations before prompting sign-up.

---

## Auth Methods

The sign-in page surfaces all of these in a single component
(`src/components/SignInForm.astro`), so every method shares one UX:

### 1. Email — magic link **and** numeric OTP code

`signInWithOtp` emails the user both a magic link AND a 6-digit code. The
UI prompts for the code, with the magic link as a fallback (some inboxes
strip codes from the body but preserve links).

```typescript
// Step 1 — request
await supabase.auth.signInWithOtp({
  email,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/callback/`,
    shouldCreateUser: true,
  },
});
// Step 2 — verify the pasted code (no email round-trip)
await supabase.auth.verifyOtp({ email, token: '123456', type: 'email' });
```

**Why both?** Magic-link clicks fail on iOS Mail → Safari handoff and
sometimes get pre-fetched by spam scanners (consuming the token). Code paste
sidesteps both failures.

### 2. Google OAuth

```typescript
await supabase.auth.signInWithOAuth({
  provider: 'google',
  options: { redirectTo: `${window.location.origin}/auth/callback/` },
});
```

**Dashboard setup:**
1. Google Cloud Console → APIs & Services → Credentials → Create OAuth 2.0
   Client ID, type "Web application".
2. Authorised redirect URI: `https://reppvlqejgoqvitturxp.supabase.co/auth/v1/callback`
   (Supabase's callback, not ours — Supabase exchanges the Google token and
   then redirects to *our* callback per `redirectTo`).
3. Copy the Client ID + Secret.
4. Supabase dashboard → Authentication → Providers → Google → enable, paste
   both, save.

### 3. GitHub OAuth

```typescript
await supabase.auth.signInWithOAuth({
  provider: 'github',
  options: { redirectTo: `${window.location.origin}/auth/callback/` },
});
```

**Dashboard setup:**
1. GitHub → Settings → Developer Settings → OAuth Apps → New OAuth App.
2. Authorisation callback URL: `https://reppvlqejgoqvitturxp.supabase.co/auth/v1/callback`
3. Copy the Client ID + generate a Client Secret.
4. Supabase dashboard → Authentication → Providers → GitHub → enable, paste,
   save.

**Provider toggles** (apply to both Google and GitHub):
| Toggle | Setting | Why |
|---|---|---|
| Skip nonce checks | **OFF** | Nonce binds an ID token to its issuing session and prevents replay attacks. Only turn on for native iOS Apple Sign-In flows where the nonce can't be surfaced back. Web `signInWithOAuth` doesn't need it. |
| Allow users without an email | **OFF** | Email is required for magic-link recovery and Darwin Core attribution. We pass `scopes: 'read:user user:email'` to GitHub so private-email users still return their email. |

### 4. Passkey / WebAuthn (step-up MFA on this device)

Supabase MFA-style WebAuthn enrolment. Flow:
- User signs in with email/OAuth (aal1 session).
- Profile → Security → "Register a passkey on this device" → calls
  `mfa.enroll({ factorType: 'webauthn' })`, browser prompts for biometric.
- Subsequent visits: sign-in page shows "Sign in with passkey" button when
  WebAuthn is supported. Clicking it re-elevates aal1 → aal2 (effectively a
  passwordless sign-in on this device).

The helpers in `src/lib/auth.ts` handle the b64url ↔ ArrayBuffer dance the
browser API needs.

**Notes:**
- This is **not** primary-auth passkey (which would skip email entirely from
  cold start). Supabase JS doesn't expose that yet — when it lands, we'll add
  a "primary passkey" mode without needing email.
- WebAuthn is supported everywhere except Safari < 16.4 and very old Android
  WebViews. We feature-detect via `passkeySupported()` and hide the button
  on unsupported browsers.

### 6. Guest Mode

- User can create up to **3 observations** without signing in.
- Guest observations live **exclusively in Dexie** — they are never written to
  Supabase while `observer_id` is the sentinel `'guest'`. This matters because
  `observations.observer_id` is `uuid NOT NULL REFERENCES public.users(id)` in
  Postgres; writing the string `'guest'` would fail the constraint.
- The TypeScript type uses a discriminated union so the compiler enforces this
  invariant in the sync engine:
  ```typescript
  type ObserverRef =
    | { kind: 'user';  id: string /* uuid */ }
    | { kind: 'guest'; localId: string /* local-only */ };
  ```
- Soft prompt after the first observation:
  "Create a free account to sync your observations to the cloud."
- Hard prompt after the 3rd guest observation: the form refuses a 4th until
  the user signs in or explicitly dismisses and acknowledges that further
  observations are local-only.

---

## Auth Callback Page

`src/pages/auth/callback.astro`:
```typescript
---
import { supabase } from '../../lib/supabase';

const { searchParams } = Astro.url;
const code = searchParams.get('code');

if (code) {
  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (!error) {
    return Astro.redirect('/en/observe/');
  }
}
return Astro.redirect('/en/?auth_error=1');
---
```

---

## Session Persistence (Offline)

Supabase stores session in `localStorage` by default. For offline-resilient sessions:

```typescript
// lib/supabase.ts
import { createClient } from '@supabase/supabase-js';

export const supabase = createClient(
  import.meta.env.PUBLIC_SUPABASE_URL,
  import.meta.env.PUBLIC_SUPABASE_ANON_KEY,
  {
    auth: {
      persistSession: true,
      autoRefreshToken: true,
      detectSessionInUrl: true,
      storage: window.localStorage, // falls back to memory if unavailable
    }
  }
);
```

**Token refresh:** Supabase auto-refreshes JWT before expiry. When offline, cached JWT continues to work for read operations from Dexie.

---

## User Profile

```sql
-- Created automatically via Supabase trigger on auth.users insert
CREATE TABLE public.users (
  id uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  username text UNIQUE,                    -- optional, max 30 chars, alphanumeric + _
  display_name text,
  bio text,
  avatar_url text,
  preferred_lang text DEFAULT 'es',        -- 'es' | 'en' | 'zap' | 'mix' | 'nah' | 'myn'
  is_expert boolean DEFAULT false,
  expert_taxa text[],                       -- ['Aves', 'Plantae', 'Fungi', ...]
  observation_count integer DEFAULT 0,
  created_at timestamptz DEFAULT now(),
  updated_at timestamptz DEFAULT now()
);

-- RLS: users can read all profiles, update only their own
ALTER TABLE public.users ENABLE ROW LEVEL SECURITY;
CREATE POLICY "Public read" ON public.users FOR SELECT USING (true);
CREATE POLICY "Self update" ON public.users FOR UPDATE USING (auth.uid() = id);
```

---

## RLS Pattern (used across all tables)

```sql
-- Standard pattern: wrap auth.uid() in (SELECT ...) for initPlan caching
CREATE POLICY "Owner read/write" ON observations
  FOR ALL USING ((SELECT auth.uid()) = observer_id);

-- Public read of non-sensitive data
CREATE POLICY "Public read" ON observations
  FOR SELECT USING (
    sync_status = 'synced'
    AND (
      nom_059_status IS NULL       -- non-sensitive species
      OR captured_from = 'manual'  -- user explicitly made public
    )
  );
```

---

## Session lifetime ("keep me signed in")

Supabase JWT defaults: 1 h access token, 1 week refresh token. For a
PWA that's offline-capable and used in the field, this is too short — every
week-long field trip would force a re-auth. Bump:

**Dashboard → Authentication → Sessions:**
| Setting | Default | Recommended |
|---|---|---|
| JWT expiry (access token) | 3600 s (1 h) | 86400 s (24 h) |
| Refresh token reuse interval | 10 s | 10 s (leave) |
| Refresh token expiry | 1 week | 90 days (`7776000` s) |
| Inactivity timeout | none | none (leave) |

The `auth.refreshToken: true` flag we already pass to `createClient` keeps
the session alive transparently — users almost never see a sign-in screen
again on a device they've authed on, until they explicitly sign out or the
90-day window elapses.

**Sign out from all devices:** the profile/edit page exposes
`signOut({ scope: 'global' })` which revokes every refresh token for the
user across all sessions. Use this if a user reports a lost phone.

## Custom SMTP

Supabase's built-in SMTP caps **3 magic-link emails per hour per project** on
the free tier and is explicitly not recommended for production. Rastrum
wires a custom SMTP provider from day one.

**Dev path — Gmail + App Password (fastest, free, 500/day):**

1. Go to <https://myaccount.google.com/apppasswords> (requires 2-step
   verification enabled on the Google account).
2. Create app password: name `Rastrum Supabase`. Copy the 16-char password.
3. Supabase dashboard → Authentication → SMTP Settings → enable custom SMTP:
   - Sender email: your Gmail address
   - Sender name: `Rastrum`
   - Host: `smtp.gmail.com`
   - Port: `465`
   - Username: your Gmail address (full `you@gmail.com`)
   - Password: the 16-char app password
   - Minimum interval between emails: `60` seconds
4. Save. Test by requesting a magic link from `/en/sign-in/`.

**Prod path — Resend (recommended, 100/day free, custom domain):**

1. Sign up at <https://resend.com>. Verify the domain `rastrum.artemiop.com`
   by adding the SPF, DKIM, and DMARC records Resend shows you.
2. Create API key scoped to "Sending access" — `re_xxxxx`.
3. Supabase dashboard → Authentication → SMTP Settings:
   - Sender email: `no-reply@rastrum.artemiop.com`
   - Sender name: `Rastrum`
   - Host: `smtp.resend.com`
   - Port: `465`
   - Username: `resend`
   - Password: the `re_xxxxx` API key
   - Minimum interval between emails: `0`
4. Save. Request a magic link to verify delivery.

**Why not AWS SES?** Cheaper at scale (~$0.10 per 1K emails) but requires
provisioning out of sandbox mode, which takes 24–48 h. Revisit at v1.0 when
volume justifies it.

## Environment Variables

```env
# .env.local (never commit)
PUBLIC_SUPABASE_URL=https://xxxx.supabase.co
PUBLIC_SUPABASE_ANON_KEY=eyJhbGci...

# Server-side only (Supabase Edge Functions)
SUPABASE_SERVICE_ROLE_KEY=eyJhbGci...
PLANTNET_API_KEY=xxxxx
ANTHROPIC_API_KEY=sk-ant-xxxxx
```

---

## Guest → Authenticated Migration

When a guest signs in, all guest-scoped observations on *this device* are rewritten
with the real `observer_id` and queued for sync. Cross-device guest observations
are not merged — each device's guest store is independent.

```typescript
async function migrateGuestObservations(userId: string): Promise<MigrationResult> {
  const guestObs = await db.observations
    .where('observer_kind').equals('guest')
    .toArray();

  const migrated: string[] = [];
  const skipped: Array<{ id: string; reason: string }> = [];

  for (const obs of guestObs) {
    // Defensive: if somehow an observation already has a real user_id
    // (e.g. the same device was used by two accounts), skip and log.
    if (obs.data.observer_ref.kind === 'user') {
      skipped.push({ id: obs.id, reason: 'already owned' });
      continue;
    }

    await db.observations.update(obs.id, {
      observer_kind: 'user',
      data: {
        ...obs.data,
        observer_ref: { kind: 'user', id: userId },
      },
      sync_status: 'pending',  // re-queue for upload
    });
    migrated.push(obs.id);
  }

  // Re-trigger sync
  await syncOutbox();
  return { migrated, skipped };
}
```

**Idempotency:** migration is safe to replay. Observations already marked
`kind: 'user'` are skipped. The Supabase upsert uses `id` as the conflict
key, so a replay of a previously-synced observation is a no-op.

**Device-level conflict:** if the same user signs in on two devices that both
hold guest observations, both devices migrate their own guest rows independently.
Client-generated UUIDs make collisions statistically impossible. The rows
appear on the server as two different observations — which is the correct
behaviour (they really were two different field events).
