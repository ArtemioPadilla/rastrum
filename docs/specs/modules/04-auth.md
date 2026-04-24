# Module 04 — Authentication

**Version target:** v0.1
**Status:** Not started

---

## Overview

Magic link email auth (primary) + optional passkey/WebAuthn. No passwords. Auth via Supabase Auth. Sessions persist in IndexedDB for offline access. Anonymous/guest mode allowed for first 3 observations before prompting sign-up.

---

## Auth Methods

### 1. Magic Link (primary)
```typescript
// Send magic link
const { error } = await supabase.auth.signInWithOtp({
  email: userEmail,
  options: {
    emailRedirectTo: `${window.location.origin}/auth/callback`,
    shouldCreateUser: true,
  }
});
```

### 2. Passkey / WebAuthn (v0.3+)
```typescript
// Register passkey after first sign-in
await supabase.auth.mfa.enroll({ factorType: 'webauthn' });
```

### 3. Guest Mode

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
