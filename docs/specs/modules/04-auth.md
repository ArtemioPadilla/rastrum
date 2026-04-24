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
- User can create up to 3 observations without signing in
- Observations stored in Dexie with `observer_id: 'guest'`
- On sign-up/in: transfer guest observations to real account
- Show soft prompt after first observation: "Create free account to save your observations to the cloud"

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

```typescript
async function migrateGuestObservations(userId: string): Promise<void> {
  const guestObs = await db.observations
    .where('data.observer_id').equals('guest')
    .toArray();

  for (const obs of guestObs) {
    await db.observations.update(obs.id, {
      data: { ...obs.data, observer_id: userId },
    });
  }

  // Re-trigger sync for migrated observations
  await syncOutbox();
}
```
