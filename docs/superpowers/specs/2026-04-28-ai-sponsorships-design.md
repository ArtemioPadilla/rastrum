# AI sponsorships: shared API access for friends

**Date:** 2026-04-28
**Status:** Design — pending user review
**Owner:** Artemio Padilla
**Module number:** 20 (`docs/specs/modules/20-ai-sponsorships.md` to be created from this design)
**Related modules:** 04 (auth/users), 13 (identifier registry), 14 (BYO keys), karma (`2026-04-27-karma-expertise-rarity-design.md`), 26 (social graph — `2026-04-28-social-features-design.md`).

---

## Goals

1. Let any Rastrum user **share their Anthropic API access** (API key or long-lived token) with specific other users, without exposing the secret to the browser or to third parties, and with a hard monthly call cap that protects the sponsor's wallet/subscription.
2. Reward sharing through the existing **karma system** so that becoming a sponsor is a recognized social action, not just a private favor.
3. Remove the operator-side `ANTHROPIC_API_KEY` env fallback. After this module ships, the only ways to invoke Claude from `identify` are **BYO key** (user's own key in `localStorage`) or an **active sponsorship** that resolves to a Vault-encrypted credential.
4. Maintain the project invariants: zero-cost (Vault is free, pg_cron free, Edge Function free tier suffices), bilingual EN/ES from day one, every public table has RLS, every privileged write goes through an Edge Function with audit, no secret ever appears in logs or browser-visible state.
5. Keep the schema **provider-agnostic from day one** so adding OpenAI/Gemini sponsorships later is a single ALTER TYPE + handler addition, not a migration.

## Non-goals

- Sponsorship of any provider other than Anthropic in v1. Schema supports it (`ai_provider` enum); handler does not.
- Automated abuse moderation queues. Reports surface to the sponsor; admins (`has_role(uid, 'admin')`) act manually if needed.
- Per-call USD billing or token-based caps. Cap unit is **calls** for v1 (predictable, simple to explain, varies <10× cost-wise for Haiku 4.5).
- Public marketplace of sponsors ("find someone to sponsor you"). Discovery happens through the user's social graph and out-of-band (DM, Slack, in-person).
- Group / club sponsorships (one credential pool, many beneficiaries via group membership). Schema's `priority` field permits multiple sponsors per beneficiary; group abstraction is deferred.
- Mobile app: works in the PWA; no native UI work in scope.

---

## Decisions captured (brainstorming outcome)

| Axis | Decision | Rationale |
|---|---|---|
| Scale (v1) | **5–20 friends, manually added by username** | Real demand at this scale; UI for "request access" deferred until needed |
| Sharing reward | **Sharing AI access grants karma to the sponsor** | Turns sponsorship into a social-product loop, not just a cost |
| Cap unit | **Per call count, not USD/tokens** | Variance is small for Haiku 4.5; simple to explain ("you have 47 IDs left this month") |
| Cap enforcement | **Hard cap + 80%/100% sponsor email + beneficiary sees own usage** | Wallet protection + agency for the sponsor + transparency for the beneficiary |
| Provider scope | **Schema multi-provider, v1 implements only Anthropic** | Avoids future migration; zero cost to plumb the column today |
| Anthropic credential types | **Both `sk-ant-api03-` (header `x-api-key`) and `sk-ant-oat01-` (header `Authorization: Bearer`)** | OAT against a Pro/Max subscription is effectively free per call within plan limits |
| Credential storage | **Anyone can sponsor; secret encrypted in Supabase Vault** | Reuses managed encryption (no rolled-our-own pgcrypto); enables organic growth past operator-only |
| Karma model | **+20 base on active sponsorship; +1 per call used by beneficiary; capped at `monthly_call_cap`** | Rewards the gesture (base) AND the utility (per-call), capped to prevent farming |
| Abuse handling | **Auto-pause on rate-limit threshold (>30 calls / 10min) + email sponsor for review** | Circuit breaker protects sponsor; manual review preserves agency |
| Privacy of relationship | **Asymmetric: sponsor's beneficiary list public by default; beneficiary's "sponsored by" private by default** | Being a sponsor is prestige; being sponsored can feel like charity — defaults protect the asymmetry |
| Operator key fallback | **Removed. Only BYO and sponsorship invoke Claude after this ships** | Eliminates a hidden subsidy; simplifies the security surface |
| Self-sponsoring | **Permitted (CHECK removed); no karma awarded for self-flow** | Sponsor uses one config (the new UI) for both their own and friends' usage; analytics consistent |
| Architecture scope | **Enfoque Z (full SaaS-ish)** — multi-sponsor fallback chain, dedicated rate-limit table, monthly rollup for analytics, multi-provider plumbing | Best-engineering principle; aditive features (fallback chain, analytics) add value even at small scale |

---

## Architecture

```
┌──────────────────────────────────────────────────────────────────────┐
│  Browser (PWA)                                                       │
│  ─ /profile/sponsoring/   (sponsor view: creds, beneficiaries, charts) │
│  ─ /profile/sponsored-by/ (beneficiary view: quota, sponsors, opt-in) │
│  ─ /identify              (banner: 80% / 100% / paused)               │
└────────────┬─────────────────────────────────────────┬────────────────┘
             │ JWT                                     │ JWT
             ▼                                         ▼
┌──────────────────────────┐         ┌─────────────────────────────────┐
│  sponsorships Edge Fn    │         │  identify Edge Fn (modified)    │
│  POST   /credentials     │         │  resolveSponsorship() ──────────┼──┐
│  POST   /sponsorships    │         │  decryptCredential()           │  │
│  PATCH  /sponsorships/:id│         │  pickAuthHeader(kind)           │  │
│  DELETE /sponsorships/:id│         │  callAnthropic()                │  │
│  GET    /.../usage       │         │  recordUsage()                  │  │
└────────────┬─────────────┘         └────────┬────────────────────────┘  │
             │                                │                            │
             │ service_role                   │ service_role               │
             ▼                                ▼                            │
┌─────────────────────────────────────────────────────────────────────┐  │
│  Postgres + Supabase Vault                                          │  │
│  ─ sponsor_credentials (vault_secret_id → vault.secrets)            │  │
│  ─ sponsorships (sponsor → credential → beneficiary, status, cap)   │  │
│  ─ ai_usage (append-only ledger)                                    │  │
│  ─ ai_rate_limits (sliding-window buckets)                          │  │
│  ─ ai_usage_monthly (denormalized rollup for analytics)             │  │
│  ─ ai_errors_log (transient, 30d retention)                         │  │
│  ─ notifications_sent (idempotent threshold notifications)          │  │
│                                                                      │  │
│  Triggers:                                                          │  │
│  ─ award_sponsor_karma()         → +1 per call, capped              │  │
│  ─ award_sponsorship_base_karma()→ +20 active / -20 revoked         │  │
│                                                                      │  │
│  Cron jobs:                                                         │  │
│  ─ ai_rate_limits_cleanup        (daily, drops buckets > 24h)       │  │
│  ─ ai_usage_monthly_rollup       (nightly, consolidates yesterday)  │  │
│  ─ ai_credentials_heartbeat      (weekly, probes credential health) │  │
│  ─ ai_notifications_monthly_reset (monthly, clears notif idempotency)│  │
└─────────────────────────────────────────────────────────────────────┘  │
                                                                          │
                  ▲                                                       │
                  │  call (header chosen by kind)                         │
                  └──── Anthropic Messages API ◀──────────────────────────┘
```

**Three layers, additive over existing architecture:**

1. **Data (Postgres + Vault)** — five new tables, one rollup, two triggers, one resolution function.
2. **Service (Deno Edge Functions)** — new shared lib `_shared/sponsorship.ts`; new function `sponsorships`; `identify` modified.
3. **UI (Astro)** — two new routes (paired EN/ES), integration into `/identify` banner and `M26` public profile.

---

## Data model

### Enums

```sql
DO $$ BEGIN CREATE TYPE public.ai_provider AS ENUM ('anthropic'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.ai_credential_kind AS ENUM ('api_key', 'oauth_token'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN CREATE TYPE public.ai_sponsorship_status AS ENUM ('active', 'paused', 'revoked'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

### `sponsor_credentials`

```sql
CREATE TABLE IF NOT EXISTS public.sponsor_credentials (
  id              uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider        public.ai_provider NOT NULL,
  kind            public.ai_credential_kind NOT NULL,
  label           text NOT NULL CHECK (length(label) BETWEEN 1 AND 64),
  vault_secret_id uuid NOT NULL,
  validated_at    timestamptz,
  last_used_at    timestamptz,
  revoked_at      timestamptz,
  created_at      timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, label)
);
CREATE INDEX IF NOT EXISTS sponsor_credentials_user_active_idx
  ON public.sponsor_credentials (user_id) WHERE revoked_at IS NULL;
ALTER TABLE public.sponsor_credentials ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sponsor_credentials_owner_read ON public.sponsor_credentials;
CREATE POLICY sponsor_credentials_owner_read ON public.sponsor_credentials
  FOR SELECT TO authenticated USING (user_id = auth.uid());
-- Writes only via service_role in Edge Function.
```

The actual secret never appears in this table. `vault_secret_id` references `vault.secrets(id)`. Decryption happens only in the Edge Function via `vault.decrypted_secrets` (service-role-only view).

### `sponsorships`

```sql
CREATE TABLE IF NOT EXISTS public.sponsorships (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  sponsor_id         uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  beneficiary_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  credential_id      uuid NOT NULL REFERENCES public.sponsor_credentials(id) ON DELETE RESTRICT,
  provider           public.ai_provider NOT NULL,
  monthly_call_cap   integer NOT NULL CHECK (monthly_call_cap BETWEEN 1 AND 10000),
  priority           smallint NOT NULL DEFAULT 100,
  status             public.ai_sponsorship_status NOT NULL DEFAULT 'active',
  paused_reason      text,
  paused_at          timestamptz,
  beneficiary_public boolean NOT NULL DEFAULT false,
  sponsor_public     boolean NOT NULL DEFAULT true,
  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now(),
  UNIQUE (sponsor_id, beneficiary_id, provider)
);
-- NOTE: no CHECK (sponsor_id <> beneficiary_id) — self-sponsoring is permitted
-- so the sponsor can use the same UI to manage their own usage. Karma triggers
-- guard against rewarding self-sponsoring.

CREATE INDEX IF NOT EXISTS sponsorships_beneficiary_active_idx
  ON public.sponsorships (beneficiary_id, provider, priority) WHERE status = 'active';

ALTER TABLE public.sponsorships ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS sponsorships_party_read ON public.sponsorships;
CREATE POLICY sponsorships_party_read ON public.sponsorships
  FOR SELECT TO authenticated
  USING (sponsor_id = auth.uid() OR beneficiary_id = auth.uid());

DROP POLICY IF EXISTS sponsorships_public_read ON public.sponsorships;
CREATE POLICY sponsorships_public_read ON public.sponsorships
  FOR SELECT TO anon, authenticated
  USING (status = 'active' AND sponsor_public AND beneficiary_public);
```

### `ai_usage`

```sql
CREATE TABLE IF NOT EXISTS public.ai_usage (
  id             bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sponsorship_id uuid NOT NULL REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  sponsor_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  beneficiary_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider       public.ai_provider NOT NULL,
  tokens_in      integer,
  tokens_out     integer,
  occurred_at    timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS ai_usage_sponsorship_month_idx
  ON public.ai_usage (sponsorship_id, occurred_at);
CREATE INDEX IF NOT EXISTS ai_usage_sponsor_month_idx
  ON public.ai_usage (sponsor_id, occurred_at);

ALTER TABLE public.ai_usage ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_usage_party_read ON public.ai_usage;
CREATE POLICY ai_usage_party_read ON public.ai_usage
  FOR SELECT TO authenticated
  USING (sponsor_id = auth.uid() OR beneficiary_id = auth.uid());
-- Append-only: no INSERT/UPDATE/DELETE policies. Service role inserts; nothing modifies.
```

### `ai_rate_limits`

```sql
CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  beneficiary_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider       public.ai_provider NOT NULL,
  bucket         timestamptz NOT NULL,  -- date_trunc('minute', now())
  count          integer NOT NULL DEFAULT 1,
  PRIMARY KEY (beneficiary_id, provider, bucket)
);
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;
-- No public policies — service role only.
```

### `ai_usage_monthly` (denormalized rollup)

```sql
CREATE TABLE IF NOT EXISTS public.ai_usage_monthly (
  sponsorship_id uuid NOT NULL REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  year_month     date NOT NULL,
  calls          integer NOT NULL,
  tokens_in      bigint,
  tokens_out     bigint,
  PRIMARY KEY (sponsorship_id, year_month)
);
ALTER TABLE public.ai_usage_monthly ENABLE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS ai_usage_monthly_party_read ON public.ai_usage_monthly;
CREATE POLICY ai_usage_monthly_party_read ON public.ai_usage_monthly
  FOR SELECT TO authenticated
  USING (EXISTS (
    SELECT 1 FROM public.sponsorships s
    WHERE s.id = ai_usage_monthly.sponsorship_id
      AND (s.sponsor_id = auth.uid() OR s.beneficiary_id = auth.uid())
  ));
```

### `ai_errors_log` and `notifications_sent`

```sql
CREATE TABLE IF NOT EXISTS public.ai_errors_log (
  id              bigint GENERATED BY DEFAULT AS IDENTITY PRIMARY KEY,
  sponsorship_id  uuid REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  beneficiary_id  uuid REFERENCES public.users(id) ON DELETE SET NULL,
  provider        public.ai_provider NOT NULL,
  http_status     integer NOT NULL,
  error_code      text NOT NULL,
  occurred_at     timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.ai_errors_log ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS ai_errors_log_party_read ON public.ai_errors_log;
CREATE POLICY ai_errors_log_party_read ON public.ai_errors_log
  FOR SELECT TO authenticated
  USING (
    EXISTS (SELECT 1 FROM public.sponsorships s
            WHERE s.id = ai_errors_log.sponsorship_id
              AND (s.sponsor_id = auth.uid() OR s.beneficiary_id = auth.uid()))
  );

CREATE TABLE IF NOT EXISTS public.notifications_sent (
  sponsorship_id uuid NOT NULL REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  threshold      smallint NOT NULL CHECK (threshold IN (80, 100)),
  year_month     date NOT NULL,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sponsorship_id, threshold, year_month)
);
ALTER TABLE public.notifications_sent ENABLE ROW LEVEL SECURITY;
-- Service-role only. No public policy needed.
```

### Resolution function

```sql
CREATE OR REPLACE FUNCTION public.resolve_sponsorship(
  p_beneficiary uuid, p_provider public.ai_provider
) RETURNS TABLE (
  sponsorship_id uuid, sponsor_id uuid, credential_id uuid, vault_secret_id uuid,
  kind public.ai_credential_kind, used_this_month integer, monthly_call_cap integer
) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = public AS $$
  WITH active AS (
    SELECT s.id, s.sponsor_id, s.credential_id, s.monthly_call_cap, s.priority, s.created_at
    FROM   public.sponsorships s
    JOIN   public.sponsor_credentials c ON c.id = s.credential_id
    WHERE  s.beneficiary_id = p_beneficiary AND s.provider = p_provider
      AND  s.status = 'active' AND c.revoked_at IS NULL
    ORDER  BY s.priority ASC, s.created_at ASC
  ),
  with_usage AS (
    SELECT a.*, (SELECT count(*)::int FROM public.ai_usage u
                 WHERE u.sponsorship_id = a.id
                   AND u.occurred_at >= date_trunc('month', now())) AS used
    FROM active a
  )
  SELECT w.id, w.sponsor_id, w.credential_id, c.vault_secret_id, c.kind, w.used, w.monthly_call_cap
  FROM   with_usage w JOIN public.sponsor_credentials c ON c.id = w.credential_id
  WHERE  w.used < w.monthly_call_cap
  ORDER  BY w.priority ASC, w.created_at ASC
  LIMIT  1;
$$;
REVOKE ALL ON FUNCTION public.resolve_sponsorship(uuid, public.ai_provider) FROM public;
GRANT EXECUTE ON FUNCTION public.resolve_sponsorship(uuid, public.ai_provider) TO service_role;
```

### Karma triggers

`karma_events.reason` CHECK is extended:

```sql
ALTER TABLE public.karma_events DROP CONSTRAINT IF EXISTS karma_events_reason_check;
ALTER TABLE public.karma_events ADD CONSTRAINT karma_events_reason_check
  CHECK (reason IN (
    'consensus_win','consensus_loss','first_in_rastrum',
    'observation_synced','comment_reaction','manual_adjust',
    'ai_sponsorship_active','ai_sponsorship_revoked','ai_sponsor_call'
  ));
```

A new generic helper (the existing `award_karma()` is observation-specific):

```sql
CREATE OR REPLACE FUNCTION public.add_karma_simple(
  p_user_id uuid, p_delta numeric, p_reason text
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.karma_events (user_id, delta, reason) VALUES (p_user_id, p_delta, p_reason);
  UPDATE public.users
     SET karma_total = karma_total + p_delta, karma_updated_at = now()
   WHERE id = p_user_id;
END $$;
REVOKE ALL ON FUNCTION public.add_karma_simple(uuid, numeric, text) FROM public;
GRANT EXECUTE ON FUNCTION public.add_karma_simple(uuid, numeric, text) TO service_role;
```

Triggers:

```sql
-- +1 per call while under cap; no karma for self-sponsoring; require beneficiary >= 10 karma (Sybil defense).
CREATE OR REPLACE FUNCTION public.award_sponsor_karma() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE cap int; used int; beneficiary_karma numeric;
BEGIN
  IF NEW.sponsor_id = NEW.beneficiary_id THEN RETURN NEW; END IF;

  SELECT karma_total INTO beneficiary_karma FROM public.users WHERE id = NEW.beneficiary_id;
  IF COALESCE(beneficiary_karma, 0) < 10 THEN RETURN NEW; END IF;

  SELECT monthly_call_cap INTO cap FROM public.sponsorships WHERE id = NEW.sponsorship_id;
  SELECT count(*) INTO used FROM public.ai_usage
    WHERE sponsorship_id = NEW.sponsorship_id
      AND occurred_at >= date_trunc('month', NEW.occurred_at);
  IF used <= cap THEN
    PERFORM public.add_karma_simple(NEW.sponsor_id, 1, 'ai_sponsor_call');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS ai_usage_award_karma ON public.ai_usage;
CREATE TRIGGER ai_usage_award_karma AFTER INSERT ON public.ai_usage
  FOR EACH ROW EXECUTE FUNCTION public.award_sponsor_karma();

-- +20 on activation, -20 on revoke / pause; never for self.
CREATE OR REPLACE FUNCTION public.award_sponsorship_base_karma() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF NEW.sponsor_id = NEW.beneficiary_id THEN RETURN NEW; END IF;

  IF (TG_OP = 'INSERT' AND NEW.status = 'active') OR
     (TG_OP = 'UPDATE' AND OLD.status <> 'active' AND NEW.status = 'active') THEN
    PERFORM public.add_karma_simple(NEW.sponsor_id,  20, 'ai_sponsorship_active');
  ELSIF (TG_OP = 'UPDATE' AND OLD.status = 'active' AND NEW.status <> 'active') THEN
    PERFORM public.add_karma_simple(NEW.sponsor_id, -20, 'ai_sponsorship_revoked');
  END IF;
  RETURN NEW;
END $$;

DROP TRIGGER IF EXISTS sponsorships_award_base_karma ON public.sponsorships;
CREATE TRIGGER sponsorships_award_base_karma AFTER INSERT OR UPDATE OF status ON public.sponsorships
  FOR EACH ROW EXECUTE FUNCTION public.award_sponsorship_base_karma();
```

### Audit log enum extension

```sql
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_credential_create';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_credential_revoke';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_credential_rotate';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_create';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_pause';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_unpause';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_revoke';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'ai_sponsorship_quota_hit';
ALTER TYPE public.audit_op ADD VALUE IF NOT EXISTS 'vault_failure';
```

### Cron schedules (in `cron-schedules.sql`)

```sql
SELECT cron.unschedule('ai_rate_limits_cleanup');
SELECT cron.schedule('ai_rate_limits_cleanup', '17 3 * * *',
  $$DELETE FROM public.ai_rate_limits WHERE bucket < now() - interval '24 hours'$$);

SELECT cron.unschedule('ai_usage_monthly_rollup');
SELECT cron.schedule('ai_usage_monthly_rollup', '23 0 * * *',
  $$INSERT INTO public.ai_usage_monthly (sponsorship_id, year_month, calls, tokens_in, tokens_out)
    SELECT sponsorship_id, date_trunc('month', occurred_at)::date,
           count(*), sum(tokens_in), sum(tokens_out)
    FROM   public.ai_usage
    WHERE  occurred_at >= date_trunc('day', now() - interval '1 day')
      AND  occurred_at <  date_trunc('day', now())
    GROUP  BY 1, 2
    ON CONFLICT (sponsorship_id, year_month) DO UPDATE
      SET calls = ai_usage_monthly.calls + EXCLUDED.calls,
          tokens_in  = COALESCE(ai_usage_monthly.tokens_in,  0) + COALESCE(EXCLUDED.tokens_in,  0),
          tokens_out = COALESCE(ai_usage_monthly.tokens_out, 0) + COALESCE(EXCLUDED.tokens_out, 0)$$);

SELECT cron.unschedule('ai_credentials_heartbeat');
SELECT cron.schedule('ai_credentials_heartbeat', '0 4 * * 0',
  $$SELECT net.http_post(
    url := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/sponsorships/heartbeat',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_token'))
  )$$);

SELECT cron.unschedule('ai_notifications_monthly_reset');
SELECT cron.schedule('ai_notifications_monthly_reset', '5 0 1 * *',
  $$DELETE FROM public.notifications_sent WHERE year_month < date_trunc('month', now())::date$$);

SELECT cron.unschedule('ai_errors_log_cleanup');
SELECT cron.schedule('ai_errors_log_cleanup', '23 3 * * *',
  $$DELETE FROM public.ai_errors_log WHERE occurred_at < now() - interval '30 days'$$);
```

---

## Edge Functions

### `supabase/functions/_shared/sponsorship.ts` (new)

Reusable from `identify`, `sponsorships`, future endpoints (MCP, REST API).

```typescript
export interface ResolvedSponsorship {
  sponsorshipId: string;
  sponsorId:     string;
  credentialId:  string;
  vaultSecretId: string;
  kind:          'api_key' | 'oauth_token';
  usedThisMonth: number;
  monthlyCap:    number;
}

export async function resolveSponsorship(
  supabase: SupabaseClient, beneficiaryId: string, provider: 'anthropic'
): Promise<ResolvedSponsorship | null>;

export async function decryptCredential(
  supabase: SupabaseClient, vaultSecretId: string
): Promise<string>;

export async function recordUsage(
  supabase: SupabaseClient,
  args: { sponsorshipId: string; sponsorId: string; beneficiaryId: string; provider: 'anthropic'; tokensIn?: number; tokensOut?: number }
): Promise<{ usedThisMonth: number; cap: number; pctUsed: number }>;

export async function checkAndBumpRateLimit(
  supabase: SupabaseClient, beneficiaryId: string, provider: 'anthropic'
): Promise<{ allowed: boolean; reason?: string }>;

export async function autoPauseSponsorship(
  supabase: SupabaseClient, sponsorshipId: string, reason: string
): Promise<void>;

export async function maybeNotifyThreshold(
  supabase: SupabaseClient, sponsorshipId: string, pctUsed: number
): Promise<void>;

export function pickAuthHeader(
  kind: 'api_key' | 'oauth_token', secret: string
): HeadersInit;
// api_key     → { 'x-api-key': secret, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
// oauth_token → { 'Authorization': `Bearer ${secret}`, 'anthropic-version': '2023-06-01', 'content-type': 'application/json' }
```

### `supabase/functions/identify/index.ts` (modified)

Replace the current operator-key fallback (around line 150) with:

```typescript
const beneficiaryId = jwt.sub;

// 1. BYO key wins (explicit user choice)
let anthropicKey  = body.client_keys?.anthropic ?? body.client_anthropic_key;
let credKind: 'api_key' | 'oauth_token' = 'api_key';
let sponsorshipCtx: ResolvedSponsorship | null = null;

if (!anthropicKey && beneficiaryId) {
  // 2. Rate limit BEFORE touching Vault
  const rl = await checkAndBumpRateLimit(supabase, beneficiaryId, 'anthropic');
  if (!rl.allowed) {
    if (rl.reason?.startsWith('rate_limit:')) {
      // resolve current sponsorship (if any) to record auto-pause
      const ctx = await resolveSponsorship(supabase, beneficiaryId, 'anthropic');
      if (ctx) await autoPauseSponsorship(supabase, ctx.sponsorshipId, rl.reason);
    }
    // Return null key → cascade engine moves to next identifier silently
    return { skipped: true, reason: 'rate_limited' };
  }
  // 3. Resolve sponsorship
  sponsorshipCtx = await resolveSponsorship(supabase, beneficiaryId, 'anthropic');
  if (sponsorshipCtx) {
    anthropicKey = await decryptCredential(supabase, sponsorshipCtx.vaultSecretId);
    credKind = sponsorshipCtx.kind;
  }
}

// 4. NO operator-key fallback. If neither BYO nor sponsorship, Claude is unavailable for this user.
//    The cascade engine moves to PlantNet, Phi-3.5-vision, BirdNET, etc. transparently.
if (!anthropicKey) return { skipped: true, reason: 'no_credential' };

// 5. Call Anthropic with the right header
const headers = pickAuthHeader(credKind, anthropicKey);
const result  = await callAnthropic(headers, ...);

// 6. If sponsored, record usage + maybe notify thresholds
if (sponsorshipCtx) {
  const usage = await recordUsage(supabase, {
    sponsorshipId: sponsorshipCtx.sponsorshipId,
    sponsorId:     sponsorshipCtx.sponsorId,
    beneficiaryId,
    provider:      'anthropic',
    tokensIn:      result.usage?.input_tokens,
    tokensOut:     result.usage?.output_tokens,
  });
  await maybeNotifyThreshold(supabase, sponsorshipCtx.sponsorshipId, usage.pctUsed);
}
```

The `ANTHROPIC_API_KEY` env var **is removed from the Edge Function** as part of the rollout (see Phasing). Identify never reads it again.

### `supabase/functions/sponsorships/index.ts` (new)

JWT-authenticated REST endpoints. Each privileged write inserts to `admin_audit`.

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST | `/credentials` | Create credential. Validate via `validateAnthropicKey()` (existing). Insert Vault secret. | JWT (any user) |
| GET | `/credentials` | List own credentials (no secret). | JWT |
| POST | `/credentials/:id/rotate` | Replace Vault secret atomically; revalidate; reactivate any `cred:invalid`-paused sponsorships using this credential. | JWT (owner) |
| DELETE | `/credentials/:id` | Soft-revoke (`revoked_at`); pause sponsorships using it; delete Vault secret. | JWT (owner) |
| POST | `/sponsorships` | Create sponsorship. Body: `beneficiary_username`, `credential_id`, `monthly_call_cap`, `priority`. | JWT (sponsor) |
| GET | `/sponsorships?role=sponsor\|beneficiary` | List. | JWT |
| PATCH | `/sponsorships/:id` | Update `monthly_call_cap`, `priority`, `status`, `sponsor_public`. Beneficiary may PATCH only `beneficiary_public`. | JWT |
| POST | `/sponsorships/:id/unpause` | Reactivate after auto-pause. Block if 3+ auto-pauses in 7 days for the same beneficiary; force revoke+recreate. | JWT (sponsor) |
| DELETE | `/sponsorships/:id` | Revoke. Either party may. | JWT |
| GET | `/sponsorships/:id/usage?range=month` | Analytics: `[{ day, calls }]` from `ai_usage_monthly` for past months + `ai_usage` count for current month. | JWT (party) |
| POST | `/heartbeat` | Cron-only. Probes credentials whose `validated_at` is older than 7 days. | Bearer cron token |

---

## UI surfaces

### Routes

- `/en/profile/sponsoring/` ↔ `/es/perfil/patrocinios/` — sponsor view
- `/en/profile/sponsored-by/` ↔ `/es/perfil/patrocinado-por/` — beneficiary view

Slugs registered in `routes`/`routeTree` (`src/i18n/utils.ts`). Both pages mount the same `SponsoringView.astro` / `SponsoredByView.astro` with `lang` prop.

### Sponsor view (`SponsoringView.astro`)

**Section A — My credentials.** List of `sponsor_credentials` (label, kind, validated_at, last_used_at). "Add credential" modal with:
- Auto-detect prefix → preview kind (API key vs Long-lived token).
- Submit calls `POST /credentials` which runs `validateAnthropicKey()` (existing helper, ~$0.0001 per probe). On failure, show inline error; never write to Vault.
- Privacy notice: "Stored encrypted in Supabase Vault. Decrypted only at call time inside the Edge Function. Never logged."
- Per-credential "Rotate" and "Revoke" buttons.

**Section B — People I sponsor.** Table with username (with avatar), monthly cap, used this month (progress bar), priority, status, actions. "Add beneficiary" modal:
- Username autocomplete (reuse `MentionAutocomplete` from M27 if shipped, else simple input).
- `monthly_call_cap` input (default 200, max 10000), `priority` (default 100), credential dropdown.
- Toggle "Show publicly on my profile" (default ON).
- The autocomplete allows your own username; the resulting row renders with a "🔒 Self-sponsorship" badge to distinguish.
- Auto-paused rows show amber badge with `paused_reason`; "Reactivate" button calls `POST /sponsorships/:id/unpause`.

**Section C — Analytics.**
- Sparkline: total sponsored calls last 30 days.
- Top 3 beneficiaries this month by usage.
- Karma generated this month from `ai_sponsor_call`.
- Estimated cost (only for `api_key` credentials, using Haiku 4.5 pricing). For `oauth_token`, show "Covered by your Claude subscription."
- For beneficiaries with karma < 10: friendly note "@beneficiary hasn't reached the engagement threshold yet — your karma starts accruing once they hit 10 observations."

### Beneficiary view (`SponsoredByView.astro`)

- **Quota card.** "X / Y AI identifications this month" with progress bar. Names of active sponsors in priority order.
- 80%/100% banners (amber/red) with link to BYO docs.
- **Privacy.** Per-sponsorship toggle "Show @sponsor on my public profile" (default OFF).
- "Decline this sponsorship" button (DELETEs the sponsorship from beneficiary side).

### Profile integrations (M26)

- Public profile of a sponsor (with `sponsor_public=true`): badge "🤝 Sponsor (×N)" + list of beneficiaries that also opted public.
- Public profile of a beneficiary: nothing by default. Only if BOTH the beneficiary and the sponsor opted public, shows "Sponsored by @sponsor".

### `/identify` banner

Fetched once on page load (cached 5 min in `sessionStorage`):

- `pctUsed < 80%` → no banner.
- `80% ≤ pctUsed < 100%` → amber banner: "N IDs left this month (sponsored by @sponsor). [Details →]"
- `pctUsed ≥ 100%` → red banner: "AI quota exhausted. [Configure your own API key →]"
- `status='paused'` (auto) → gray banner: "Your sponsored access is paused due to heavy usage. Your sponsor was notified. [More info →]"

### Discovery card on `/profile/`

Above existing actions, only if user has no credentials yet: "💡 Want your friends to try Rastrum without configuring an API key? [Sponsor AI access →]"

### i18n strings

New namespace `sponsoring.*` in `src/i18n/{en,es}.json`. Full snapshot in implementation plan.

### Tailwind safelist

No new accent rail. Reuses `stone` (settings/profile area). Verify amber/red banner classes are already covered by other banners.

---

## Error handling & abuse model

### Error taxonomy

| Code | Origin | UX (beneficiary) | UX (sponsor) | Audit |
|---|---|---|---|---|
| Cascade skip: `rate_limited` | Sliding-window >30/10min | Cascade silently moves to next identifier | Email "@X auto-paused" | `ai_sponsorship_pause` |
| Cascade skip: `quota_exhausted` | `count(*) >= cap` | Banner red + BYO link | Email at 100% | `ai_sponsorship_quota_hit` |
| Cascade skip: `no_credential` | No BYO, no sponsorship | No banner; cascade continues normally | n/a | n/a |
| `502 vault_decrypt_failed` | Vault rejected | Toast "temporary error" | Critical email with `credential_id` | `vault_failure` |
| Anthropic 401/403 | Credential dead | Toast "your sponsor will check" | Email: credential revoked, sponsorships paused | `ai_credential_revoke` |
| Anthropic 429 | Provider rate limit | Toast "Anthropic is busy" | n/a | n/a |
| Anthropic 5xx | Provider down | Toast "temporary"; row in `ai_errors_log` | If >10 in 1h: email | logged in `ai_errors_log` |

### Abuse vectors and defenses

| Vector | Defense |
|---|---|
| Beneficiary spam | (a) Sliding-window rate limit (30/10min) → auto-pause + email. (b) Hard monthly cap. |
| Prompt injection / ToS violation | (a) `identify` prompt is fixed template — user input is image + location only, no free text. (b) Anthropic 401/403 → auto-revoke credential + email. (c) "Report abuse" button on each beneficiary row → audit + admin review. |
| Key theft / leak | (a) Vault encryption at rest, service-role-only decrypt. (b) CI lint: grep `sk-ant-` in `dist/` and Edge Function source must be empty. (c) "Rotate credential" UI for atomic replacement without disrupting active sponsorships. (d) Weekly heartbeat probe (`ai_credentials_heartbeat` cron) auto-revokes dead credentials. |
| Sybil (alts to farm karma) | (a) Karma cap = `monthly_call_cap`. (b) Self-sponsoring grants no karma (trigger guard). (c) Beneficiary needs ≥10 own karma before sponsor accrues per-call karma (transparent in sponsor's analytics). |
| Sponsor account compromised | (a) Auto-pause global on N consecutive 401/403. (b) "Pause all my sponsorship" button on sponsor view. |

### Recovery flows

- **Auto-pause → unpause:** Sponsor receives email; visits view; clicks Reactivate. No mandatory cool-down. If reactivated 3+ times in 7 days for same beneficiary, the button is replaced with "Force revoke and recreate."
- **Credential invalid → rotation:** Sponsor receives email; clicks Rotate; pastes new secret; Vault atomic update; sponsorships paused with `cred:invalid` reactivate automatically.
- **Beneficiary quota exhausted → fallback chain:** `resolve_sponsorship()` returns null for primary (priority=100); retry with priority=200 sponsor (if any); cascade returns "no Claude available" only when all sponsors exhausted.

---

## Testing strategy

### SQL layer (vitest against local supabase test DB)

`tests/sql/sponsorships.test.ts`:
- `resolve_sponsorship()` ordering (priority asc, then created_at asc), exhaustion, multiple sponsors fallback chain.
- Triggers: karma awarded only under cap; never for self-sponsoring; never if beneficiary karma <10.
- RLS: outsiders cannot SELECT sponsorships; sponsor_credentials.secret never appears in SELECT.
- CHECK constraints (`monthly_call_cap` range, `notifications_sent.threshold`).
- Vault round-trip via service role.

### Edge Function layer (`deno test`)

`supabase/functions/_shared/sponsorship.test.ts`:
- `pickAuthHeader` returns correct headers for each kind.
- `checkAndBumpRateLimit` boundary cases (30 → allowed, 31 → not allowed with reason).
- `recordUsage` pct calculation correct.
- `maybeNotifyThreshold` idempotent within (sponsorship_id, threshold, year_month).

`supabase/functions/identify/index.test.ts`:
- Mock Anthropic. With sponsorship: success path writes ai_usage and increments karma.
- Mock 401: revokes credential, pauses sponsorships, audit row.
- Mock 429: no auto-pause; transparent error bubbled to cascade.
- BYO key precedence over sponsorship.
- No BYO + no sponsorship + no operator key → cascade `skipped: 'no_credential'` (does not throw).

`supabase/functions/sponsorships/index.test.ts`:
- `POST /credentials` rejects invalid secret (mocked validator); does not write to Vault.
- `POST /sponsorships` enforces auth, valid beneficiary, cap range.
- DELETE credential cascades pause sponsorships and deletes Vault secret.
- PATCH role-gating: sponsor controls `monthly_call_cap`; beneficiary controls only `beneficiary_public`.

### UI (vitest + happy-dom)

`tests/components/SponsoringView.test.ts`:
- Prefix auto-detect (`sk-ant-api03-` vs `sk-ant-oat01-`) → correct kind preview.
- Banner color thresholds (none / amber / red).
- "Reactivate" button visibility.
- Self-sponsorship row renders the badge.

### E2E (Playwright)

`tests/e2e/sponsoring.spec.ts`:
- Sponsor flow: add mocked credential, add beneficiary, verify row.
- Beneficiary flow on `/identify` with mocked `pctUsed=85` → amber banner visible.
- Cap exhausted with `pctUsed=100` → red banner + BYO link visible.

### CI smoke

- `infra/smoke-sponsorships.sh` (post-deploy): creates a test user, POSTs invalid credential, verifies rejection without Vault write, cleans up.
- `infra/check-no-secret-logs.sh`: greps `dist/` and `supabase/functions/` for `sk-ant-` and obvious console.log of secrets/keys; fails build on match.
- SQL test `test_vault_roundtrip()` (idempotent) runs after `db-apply` to verify Vault works end-to-end.

---

## Phasing & rollout

Single PR with the commits ordered to be reviewable:

1. `feat(db): tablas y enums para sponsorships` — schema, RLS, indexes.
2. `feat(db): vault bootstrap y resolve_sponsorship()` — function + helpers.
3. `feat(db): triggers de karma + ai_usage_monthly rollup`.
4. `feat(db): cron schedules` — heartbeat, cleanup, rollup, monthly reset.
5. `feat(functions): _shared/sponsorship.ts` + deno tests.
6. `feat(functions): sponsorships/index.ts` (CRUD) + tests.
7. `feat(functions): identify integra resolveSponsorship` + tests.
8. `feat(ui): SponsoringView + SponsoredByView componentes + i18n`.
9. `feat(ui): páginas EN/ES + integración perfil + banner identify`.
10. `chore(ci): smoke tests + check-no-secret-logs.sh`.
11. `docs: módulo 20 spec + 00-index + progress.json + tasks.json`.

Feature flag `PUBLIC_SPONSORSHIPS_ENABLED` (env var). Default `false` on initial build; UI is hidden until manual flip.

**CI/CD checklist (idempotent):**
- All `CREATE TABLE/POLICY/TRIGGER/FUNCTION` use `IF NOT EXISTS` or `CREATE OR REPLACE` + `DROP X IF EXISTS` first.
- All `CREATE TYPE` wrapped in `DO $$ ... EXCEPTION WHEN duplicate_object THEN NULL; END $$`.
- Cron uses `unschedule` + `schedule` by name (per CLAUDE.md convention).
- Vault bootstrap is no-op if already configured.
- Schema push triggers `.github/workflows/db-apply.yml` automatically.
- Edge Functions deploy via `gh workflow run deploy-functions.yml -f function=sponsorships` and `-f function=identify` (never local — CLAUDE.md notes the local CLI is broken on this project).
- Post-deploy smoke (`infra/smoke-sponsorships.sh`) gates the `PUBLIC_SPONSORSHIPS_ENABLED=true` flip.

**Operator key removal:** in the same rollout, after the smoke gate succeeds, remove `ANTHROPIC_API_KEY` from the Edge Function secrets. Migration path for the operator (Artemio): create a credential through the new UI with the same key before the flip, so personal usage continues without interruption.

**Public announcement:**
- Discovery card auto-appears on `/profile/` for users without credentials.
- New entry in `progress.json` (Phase: social/community).
- New module spec at `docs/specs/modules/20-ai-sponsorships.md` (this design file becomes the basis).
- Mention in homepage About section + `/about/` page.

---

## Open questions / future work

- **Group sponsorships (M21?)** — collective credential pool with member discovery (e.g., a regional bioblitz). The `priority` column already permits multiple sponsors per beneficiary; a group abstraction would add a `sponsor_groups` table where group members inherit sponsor status.
- **Token-based caps** — when usage variance grows or credential mix shifts toward `api_key`, add `tokens_cap` alongside `monthly_call_cap`.
- **Per-region sponsor leaderboard** — public ranking of top sponsors by karma generated, opt-in.
- **Monthly automated reports** — sponsor receives a 1st-of-month digest with usage breakdown and karma earned.
- **Email digest preferences** — let sponsor opt out of 80% notifications (only 100%) if they trust the cap.

---

## Appendix: validateAnthropicKey() — already exists

Per CLAUDE.md: `src/lib/anthropic-key.ts` exports `validateAnthropicKey()`. It runs a `max_tokens:1` probe that costs ≈ nothing per call. Reuse it before persisting any BYO key. The new `POST /credentials` endpoint **ports this function to Deno** (it's a small fetch wrapper) and lives at `supabase/functions/_shared/anthropic-validate.ts`. The browser-side helper stays for BYO-key validation in the SignInForm and identifier UI.

## Appendix: one-time setup requirements

Two settings must be configured **once** before the cron jobs work; both are idempotent and can live in the existing `make db-apply` flow:

1. **`app.cron_token`** — bearer token used by the heartbeat cron to call `/sponsorships/heartbeat`. Set via:
   ```sql
   ALTER DATABASE postgres SET app.cron_token = '<generated-secret>';
   ```
   The same token is added as a secret to the Edge Function (`SPONSORSHIPS_CRON_TOKEN`) and verified at the heartbeat handler. Generate once with `openssl rand -hex 32`; store in `.env.local` and via `supabase secrets set` in CI.

2. **Supabase Vault** — assumed enabled (it is on this project per `architecture.md`). The migration is no-op if already enabled. If running on a self-hosted Supabase clone, the spec assumes `pgsodium` and `vault` extensions are loaded.

## Appendix: Estimated cost computation (UI-only)

Hardcoded in `SponsoringView.astro` (sparkline tooltip and "Estimated cost" line):

```typescript
// Anthropic Haiku 4.5 pricing as of 2026-04-28; update annually.
const HAIKU_45_INPUT_USD_PER_1K  = 0.001;
const HAIKU_45_OUTPUT_USD_PER_1K = 0.005;
const estimateCost = (tokensIn: number, tokensOut: number) =>
  (tokensIn  / 1000) * HAIKU_45_INPUT_USD_PER_1K +
  (tokensOut / 1000) * HAIKU_45_OUTPUT_USD_PER_1K;
```

For `oauth_token` credentials, the UI displays "Covered by your Claude subscription" instead of a USD figure. No server-side persistence of cost data — pricing changes only require a frontend release.
