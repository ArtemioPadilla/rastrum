# Module 14 — User API Tokens

**Version target:** v1.0
**Status:** Not started

---

## Overview

Personal API tokens allow Rastrum users to submit observations, query their
records, and trigger photo ID from any external tool — CLI, AI agents,
scripts — without sharing their Supabase session credentials.

---

## Token Schema

```sql
CREATE TABLE user_api_tokens (
  id          uuid PRIMARY KEY DEFAULT uuid_generate_v4(),
  user_id     uuid NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  name        text NOT NULL,                    -- "My AI agent", "Field laptop"
  token_hash  text NOT NULL UNIQUE,             -- SHA-256 of raw token
  prefix      text NOT NULL,                    -- First 8 chars for display: "rst_a1b2"
  scopes      text[] NOT NULL DEFAULT '{observe,identify,export}',
  last_used_at timestamptz,
  expires_at  timestamptz,                      -- NULL = never expires
  created_at  timestamptz DEFAULT now(),
  revoked_at  timestamptz                       -- NULL = active
);

CREATE INDEX idx_tokens_user ON user_api_tokens(user_id) WHERE revoked_at IS NULL;
CREATE INDEX idx_tokens_hash ON user_api_tokens(token_hash) WHERE revoked_at IS NULL;
```

**Token format:** `rst_` prefix + 32 random hex chars
Example: `rst_a1b2c3d4e5f6a1b2c3d4e5f6a1b2c3d4`

---

## Scopes

| Scope | Allows |
|-------|--------|
| `observe` | Create / read own observations |
| `identify` | Call photo ID pipeline |
| `export` | Export Darwin Core / CONANP CSV |
| `read_all` | Read public observations (no write) |
| `admin` | Reserved — not user-grantable |

---

## Edge Functions

### POST /functions/v1/tokens — Create token

```typescript
// supabase/functions/tokens/index.ts
import { createClient } from '@supabase/supabase-js';
import { crypto } from 'https://deno.land/std/crypto/mod.ts';

Deno.serve(async (req) => {
  if (req.method !== 'POST') return new Response('Method not allowed', { status: 405 });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  // Auth: must be logged-in user
  const jwt = req.headers.get('Authorization')?.replace('Bearer ', '');
  const { data: { user }, error: authError } = await supabase.auth.getUser(jwt!);
  if (authError || !user) return new Response('Unauthorized', { status: 401 });

  const { name, scopes, expires_in_days } = await req.json();

  // Generate token
  const raw = 'rst_' + Array.from(
    crypto.getRandomValues(new Uint8Array(16))
  ).map(b => b.toString(16).padStart(2, '0')).join('');

  // Hash for storage
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest('SHA-256', encoder.encode(raw));
  const token_hash = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const expires_at = expires_in_days
    ? new Date(Date.now() + expires_in_days * 86400000).toISOString()
    : null;

  const { error } = await supabase.from('user_api_tokens').insert({
    user_id: user.id,
    name: name || 'API Token',
    token_hash,
    prefix: raw.slice(0, 12),   // "rst_a1b2c3d4"
    scopes: scopes || ['observe', 'identify', 'export'],
    expires_at,
  });

  if (error) return new Response(JSON.stringify({ error }), { status: 500 });

  // Return raw token ONCE — never stored
  return new Response(JSON.stringify({ token: raw, prefix: raw.slice(0, 12) }), {
    headers: { 'Content-Type': 'application/json' },
  });
});
```

### Token Verification Middleware

```typescript
// src/lib/token-auth.ts
export async function verifyApiToken(
  token: string,
  requiredScope: string,
  supabase: SupabaseClient
): Promise<{ user_id: string; scopes: string[] } | null> {
  const encoder = new TextEncoder();
  const hashBuf = await crypto.subtle.digest(
    'SHA-256', encoder.encode(token)
  );
  const token_hash = Array.from(new Uint8Array(hashBuf))
    .map(b => b.toString(16).padStart(2, '0')).join('');

  const { data, error } = await supabase
    .from('user_api_tokens')
    .select('user_id, scopes, expires_at')
    .eq('token_hash', token_hash)
    .is('revoked_at', null)
    .single();

  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  if (!data.scopes.includes(requiredScope)) return null;

  // Update last_used_at (fire and forget)
  supabase.from('user_api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('token_hash', token_hash);

  return { user_id: data.user_id, scopes: data.scopes };
}
```

---

## REST API Endpoints (token-authenticated)

All endpoints accept: `Authorization: Bearer rst_xxxx`

### POST /functions/v1/api/observe
Submit a new observation.

```json
{
  "scientific_name": "Brongniartia argentea",
  "lat": 17.11,
  "lng": -96.74,
  "observed_at": "2026-04-24T15:30:00Z",
  "notes": "Bosque de encino, hojarasca",
  "photo_url": "https://media.rastrum.app/observations/xxx/primary.jpg"
}
```

### POST /functions/v1/api/identify
Identify a species from photo URL.

```json
{
  "image_url": "https://...",
  "lat": 17.11,
  "lng": -96.74
}
```

Returns PlantNet + Claude cascade result.

### GET /functions/v1/api/observations
List own observations (paginated).

```
?limit=20&offset=0&from=2026-01-01
```

### GET /functions/v1/api/export?format=darwin_core
Export observations as Darwin Core CSV.

---

## UI — Token Management Page

Route: `/es/perfil/tokens` | `/en/profile/tokens`

```
┌─────────────────────────────────────────────────────┐
│ 🔑 Tokens de API                                    │
├─────────────────────────────────────────────────────┤
│ [+ Nuevo token]                                     │
├─────────────────────────────────────────────────────┤
│ rst_a1b2c3d4   "Mi agente IA"    Hace 2h   [Revocar]│
│ rst_e5f6a7b8   "Laptop campo"    Hace 3d   [Revocar]│
└─────────────────────────────────────────────────────┘
```

**On create:** Show raw token ONCE with copy button.
Warning: "Guarda este token — no se puede ver de nuevo."

---

## Security Notes

- Raw token shown **only once** at creation — never stored
- Only SHA-256 hash stored in DB
- Tokens scoped to minimum necessary permissions
- Revocation immediate (sets `revoked_at`)
- Rate limit: 100 req/min per token (Supabase RLS + Edge Function)
- Token prefix displayed for identification without exposing full token
