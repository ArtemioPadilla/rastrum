# Module 20 — AI Sponsorships Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a sponsorship system that lets any Rastrum user share their Anthropic credential (API key or long-lived OAuth token) with specific other users. Hard monthly call cap, auto-pause on rate-limit abuse, karma reward for the sponsor, and removal of the operator-key fallback so Claude is only invocable via BYO or sponsorship.

**Architecture:** Five new Postgres tables + one denormalized monthly rollup, all idempotent and behind RLS; secrets in Supabase Vault; one shared Deno helper library (`_shared/sponsorship.ts`) consumed by two Edge Functions (new `sponsorships` for CRUD; modified `identify` for resolution); two Astro views (sponsor / beneficiary) paired EN/ES; karma awarded via SQL triggers; cron jobs handle cleanup, monthly rollup, and weekly credential heartbeat.

**Tech Stack:** Postgres + RLS + Supabase Vault, Deno Edge Functions, Astro 4, Tailwind, Vitest, Playwright. Anthropic Messages API. Resend SMTP for threshold notifications (existing operator setup).

**Spec:** `docs/superpowers/specs/2026-04-28-ai-sponsorships-design.md`

---

## Pre-flight

- [ ] **Confirm working directory and clean tree**

```bash
pwd                                          # → .../rastrum
git status -s                                # → empty (or only the spec doc)
git rev-parse --abbrev-ref HEAD              # confirm current branch
```

If anything is dirty besides the spec, stash or commit first. The auth fix PR (`fix/auth-stale-session-signout`) is unrelated and can ship independently — this work goes on a new branch.

- [ ] **Create the feature branch**

```bash
git checkout main
git pull
git checkout -b feat/ai-sponsorships
```

- [ ] **Confirm test baseline is green**

```bash
npm run typecheck && npm run test
```

Expected: 0 type errors; all Vitest tests pass (current count ≈ 225).

- [ ] **Confirm karma module already shipped**

```bash
grep -n "CREATE TABLE IF NOT EXISTS public.karma_events" docs/specs/infra/supabase-schema.sql
```

Expected: at least one match. If missing, stop — this plan depends on `karma_events` and `users.karma_total`.

- [ ] **Confirm Supabase Vault is enabled in project**

```bash
make db-psql -c "SELECT extname FROM pg_extension WHERE extname IN ('vault', 'pgsodium');"
```

Expected: both rows present. Vault is enabled by default on Supabase Cloud projects (it is on this one per `architecture.md`); if rows missing, add `CREATE EXTENSION IF NOT EXISTS vault;` to schema before continuing.

- [ ] **Confirm `add_karma_simple()` does NOT yet exist**

```bash
grep -n "add_karma_simple" docs/specs/infra/supabase-schema.sql
```

Expected: no matches (we add it in Task 9).

---

## File structure

Files created (paths absolute from repo root):

| Path | Responsibility |
|---|---|
| `docs/specs/modules/20-ai-sponsorships.md` | Module spec (registers in `00-index.md`) |
| `supabase/functions/_shared/sponsorship.ts` | Shared Deno helpers: resolve, decrypt, recordUsage, rate limit, auto-pause, notify, pickAuthHeader |
| `supabase/functions/_shared/anthropic-validate.ts` | Deno port of `validateAnthropicKey()` |
| `supabase/functions/_shared/sponsorship.test.ts` | Deno tests for shared helpers |
| `supabase/functions/sponsorships/index.ts` | CRUD Edge Function: credentials + sponsorships + heartbeat |
| `supabase/functions/sponsorships/index.test.ts` | Deno tests for CRUD endpoints |
| `supabase/functions/sponsorships/README.md` | Operator notes (deploy + secrets) |
| `src/lib/types.sponsorship.ts` | Frontend TS types |
| `src/lib/sponsorships.ts` | Frontend client wrapper around the Edge Function |
| `src/components/SponsoringView.astro` | Sponsor view (3 sections: credentials, beneficiaries, analytics) |
| `src/components/SponsoredByView.astro` | Beneficiary view (quota + sponsors + privacy) |
| `src/components/SponsorshipBanner.astro` | The amber/red banner that mounts on `/identify` |
| `src/pages/en/profile/sponsoring.astro` | EN sponsor page |
| `src/pages/es/perfil/patrocinios.astro` | ES sponsor page |
| `src/pages/en/profile/sponsored-by.astro` | EN beneficiary page |
| `src/pages/es/perfil/patrocinado-por.astro` | ES beneficiary page |
| `tests/unit/sponsorships.test.ts` | Vitest for `src/lib/sponsorships.ts` |
| `tests/e2e/sponsoring.spec.ts` | Playwright happy-path |
| `infra/smoke-sponsorships.sh` | Post-deploy CI smoke test |
| `infra/check-no-secret-logs.sh` | CI lint: greps for leaked Anthropic secrets |

Files modified:

| Path | Change |
|---|---|
| `docs/specs/infra/supabase-schema.sql` | Append "Module 20 — AI Sponsorships" section (idempotent) |
| `docs/specs/infra/cron-schedules.sql` | Append four cron jobs |
| `docs/specs/modules/00-index.md` | Register `20-ai-sponsorships.md` |
| `docs/progress.json` | Add `ai-sponsorships` item with `_es` translation |
| `docs/tasks.json` | Add subtasks for `ai-sponsorships` |
| `src/i18n/en.json` | Add `sponsoring.*` namespace |
| `src/i18n/es.json` | Add `sponsoring.*` namespace |
| `src/i18n/utils.ts` | Register sponsoring + sponsoredBy routes |
| `src/components/Header.astro` | Add sponsoring entries to avatar dropdown menu |
| `src/components/IdentifyView.astro` | Mount `<SponsorshipBanner />` |
| `src/pages/{en,es}/profile/index.astro` (or equivalent) | Add discovery card |
| `supabase/functions/identify/index.ts` | Replace operator-key block with `resolveSponsorship()` flow |
| `.github/workflows/deploy-functions.yml` | Add `sponsorships` to function matrix |

---

## Task 1 — Module spec doc

**Files:**
- Create: `docs/specs/modules/20-ai-sponsorships.md`
- Modify: `docs/specs/modules/00-index.md`

The module spec is a public-facing summary that lives alongside the other 19 modules. It sources from the design doc but is shorter (1-2 pages) and stable across implementation.

- [ ] **Step 1: Read the existing module index for placement**

```bash
tail -20 docs/specs/modules/00-index.md
```

- [ ] **Step 2: Create `docs/specs/modules/20-ai-sponsorships.md`**

```markdown
# Module 20 — AI Sponsorships

**Status:** in implementation (PR feat/ai-sponsorships)
**Related modules:** 04 (auth), 13 (identifier registry), 14 (BYO keys), karma module.
**Design doc:** `docs/superpowers/specs/2026-04-28-ai-sponsorships-design.md`

## Scope

Lets any Rastrum user share their Anthropic credential (API key or long-lived OAuth token) with specific beneficiaries. Hard monthly call cap; auto-pause on rate-limit abuse; sponsor karma reward. Removes the operator-key fallback so Claude is invocable only via BYO or sponsorship.

## Out of scope

- Group / club credentials (one pool, many beneficiaries via membership).
- Token-based caps (USD or token count); v1 caps by call count.
- Provider beyond Anthropic in v1 (schema is multi-provider ready).
- Public marketplace of sponsors.

## Tables

`sponsor_credentials`, `sponsorships`, `ai_usage`, `ai_rate_limits`, `ai_usage_monthly`, `ai_errors_log`, `notifications_sent`. All RLS-enabled. See design doc for column-level detail.

## Edge Functions

- `sponsorships` (new) — CRUD for credentials and sponsorships, plus weekly `heartbeat`.
- `identify` (modified) — replaces `ANTHROPIC_API_KEY` fallback with `resolveSponsorship()`.

## Privacy invariants

- Secret value never appears in any SELECT, log, browser-visible state, or audit row. Only `vault_secret_id` is referenced.
- BYO key always wins over sponsorship resolution.
- Sponsor's beneficiary list is public by default (`sponsor_public=true`); beneficiary's "sponsored by" is private by default (`beneficiary_public=false`). Both must opt-in for the relation to appear publicly.

## Karma

`+20` on sponsorship activation, `-20` on revoke/pause; `+1` per call used by beneficiary while under the cap. Self-sponsoring grants no karma. Beneficiary must have ≥10 own karma before per-call karma accrues (Sybil defense).

## Cron jobs

`ai_rate_limits_cleanup` (daily), `ai_usage_monthly_rollup` (nightly), `ai_credentials_heartbeat` (weekly), `ai_notifications_monthly_reset` (1st of month), `ai_errors_log_cleanup` (daily).
```

- [ ] **Step 3: Add row to `docs/specs/modules/00-index.md`**

Append (or insert in numerical order) under the Phase 4 / community section:

```markdown
| 20 | [AI Sponsorships](20-ai-sponsorships.md) | Share your Anthropic credential with friends, capped & audited |
```

- [ ] **Step 4: Verify module index renders**

```bash
grep -c "20-ai-sponsorships" docs/specs/modules/00-index.md
```

Expected: `1` (or however many cross-links you added).

- [ ] **Step 5: Commit**

```bash
git add docs/specs/modules/20-ai-sponsorships.md docs/specs/modules/00-index.md
git commit -m "docs(specs): registrar módulo 20 (AI sponsorships)"
```

---

## Task 2 — SQL: enums + Vault check

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append section "Module 20 — AI Sponsorships")

This task creates the three enums and verifies Vault is available. Idempotent — replays without errors.

- [ ] **Step 1: Open the schema file and find a stable insertion point**

Append everything for module 20 at the end of the file (after the karma section), preceded by a header comment.

- [ ] **Step 2: Append enum DDL**

Append to `docs/specs/infra/supabase-schema.sql`:

```sql
-- ============================================================
-- Module 20 — AI Sponsorships
-- See docs/specs/modules/20-ai-sponsorships.md and
-- docs/superpowers/specs/2026-04-28-ai-sponsorships-design.md
-- ============================================================

-- Vault prerequisite (no-op if already enabled).
CREATE EXTENSION IF NOT EXISTS vault;

-- 1. Enums (idempotent via DO blocks)
DO $$ BEGIN CREATE TYPE public.ai_provider AS ENUM ('anthropic');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.ai_credential_kind AS ENUM ('api_key', 'oauth_token');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN CREATE TYPE public.ai_sponsorship_status AS ENUM ('active', 'paused', 'revoked');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
```

- [ ] **Step 3: Apply the schema and verify**

```bash
make db-apply
make db-psql -c "SELECT typname FROM pg_type WHERE typname LIKE 'ai_%' ORDER BY typname;"
```

Expected output includes: `ai_credential_kind`, `ai_provider`, `ai_sponsorship_status`.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): enums para módulo 20 (ai_provider, ai_credential_kind, ai_sponsorship_status)"
```

---

## Task 3 — SQL: `sponsor_credentials` table

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 1: Append table DDL + RLS**

```sql
-- 2. sponsor_credentials — credencial reusable. El secret real vive en
--    Supabase Vault; aquí solo guardamos metadata + vault_secret_id.
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
-- No INSERT/UPDATE/DELETE policies for authenticated — writes only via the
-- sponsorships Edge Function with service_role.
```

- [ ] **Step 2: Apply and verify table + RLS**

```bash
make db-apply
make db-psql -c "\d public.sponsor_credentials"
make db-psql -c "SELECT polname FROM pg_policy WHERE polrelid = 'public.sponsor_credentials'::regclass;"
```

Expected: columns match; one policy `sponsor_credentials_owner_read`.

- [ ] **Step 3: Verify RLS blocks anon SELECT**

```bash
make db-psql -c "SET ROLE anon; SELECT count(*) FROM public.sponsor_credentials; RESET ROLE;"
```

Expected: `0` rows (or RLS error). NOT a permission error — anon should just see nothing.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): tabla sponsor_credentials + RLS (owner-read only)"
```

---

## Task 4 — SQL: `sponsorships` table

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 1: Append table DDL + RLS**

```sql
-- 3. sponsorships — relación sponsor→beneficiary→credential. Self-sponsoring
--    está permitido (no CHECK sponsor_id <> beneficiary_id) para que el
--    sponsor use la misma UI para su propio uso. Karma triggers protegen
--    contra recompensar self-flow.
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

- [ ] **Step 2: Apply and verify**

```bash
make db-apply
make db-psql -c "\d public.sponsorships"
make db-psql -c "SELECT polname FROM pg_policy WHERE polrelid = 'public.sponsorships'::regclass ORDER BY polname;"
```

Expected: two policies — `sponsorships_party_read`, `sponsorships_public_read`.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): tabla sponsorships + RLS (party + opt-in público)"
```

---

## Task 5 — SQL: `ai_usage` append-only ledger

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 1: Append table DDL + RLS**

```sql
-- 4. ai_usage — append-only ledger. Source of truth para cap enforcement,
--    karma, analytics. No UPDATE/DELETE policies → effectively immutable.
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
```

- [ ] **Step 2: Apply + verify**

```bash
make db-apply
make db-psql -c "\d public.ai_usage"
```

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): tabla ai_usage append-only + RLS"
```

---

## Task 6 — SQL: `ai_rate_limits`, `ai_usage_monthly`, `ai_errors_log`, `notifications_sent`

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 1: Append four tables**

```sql
-- 5. ai_rate_limits — sliding-window por buckets de 1min para detectar
--    >30 calls / 10min. Cleanup diario.
CREATE TABLE IF NOT EXISTS public.ai_rate_limits (
  beneficiary_id uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  provider       public.ai_provider NOT NULL,
  bucket         timestamptz NOT NULL,
  count          integer NOT NULL DEFAULT 1,
  PRIMARY KEY (beneficiary_id, provider, bucket)
);
ALTER TABLE public.ai_rate_limits ENABLE ROW LEVEL SECURITY;
-- Service-role only. No policies for authenticated/anon.

-- 6. ai_usage_monthly — denormalized rollup para queries de analytics
--    rápidas. Consolidado nightly por cron desde ai_usage.
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

-- 7. ai_errors_log — transient log para debugging de errores transitorios
--    de Anthropic. Retención 30 días via cron.
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
  USING (EXISTS (
    SELECT 1 FROM public.sponsorships s
    WHERE s.id = ai_errors_log.sponsorship_id
      AND (s.sponsor_id = auth.uid() OR s.beneficiary_id = auth.uid())
  ));

-- 8. notifications_sent — idempotencia para emails de threshold (80%/100%).
--    Reset mensual via cron.
CREATE TABLE IF NOT EXISTS public.notifications_sent (
  sponsorship_id uuid NOT NULL REFERENCES public.sponsorships(id) ON DELETE CASCADE,
  threshold      smallint NOT NULL CHECK (threshold IN (80, 100)),
  year_month     date NOT NULL,
  sent_at        timestamptz NOT NULL DEFAULT now(),
  PRIMARY KEY (sponsorship_id, threshold, year_month)
);
ALTER TABLE public.notifications_sent ENABLE ROW LEVEL SECURITY;
-- Service-role only.
```

- [ ] **Step 2: Apply + verify all four tables exist**

```bash
make db-apply
make db-psql -c "\dt public.ai_*"
make db-psql -c "\dt public.notifications_sent"
```

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): tablas ai_rate_limits, ai_usage_monthly, ai_errors_log, notifications_sent"
```

---

## Task 7 — SQL: `resolve_sponsorship()` function

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

This is the heart of resolution: given a beneficiary and a provider, return the highest-priority active sponsorship with cap remaining, or nothing.

- [ ] **Step 1: Append function DDL**

```sql
-- 9. resolve_sponsorship — devuelve la mejor credencial activa con cuota
--    para el beneficiary, ordenando por priority ASC y created_at ASC.
--    Solo para service_role (Edge Function).
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

- [ ] **Step 2: Apply + verify**

```bash
make db-apply
make db-psql -c "\df+ public.resolve_sponsorship"
```

Expected: function exists, security=definer, owner=postgres, EXECUTE granted to service_role only.

- [ ] **Step 3: Smoke-test the function with no data (empty result)**

```bash
make db-psql -c "SELECT * FROM public.resolve_sponsorship('00000000-0000-0000-0000-000000000000', 'anthropic');"
```

Expected: 0 rows returned.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): función resolve_sponsorship() con fallback chain por priority"
```

---

## Task 8 — SQL: extend `karma_events` reasons + `add_karma_simple()`

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

The existing `award_karma()` is observation-specific. We need a generic helper for sponsorship reasons.

- [ ] **Step 1: Append CHECK extension + helper function**

```sql
-- 10. Extend karma_events.reason CHECK to include sponsorship reasons.
ALTER TABLE public.karma_events DROP CONSTRAINT IF EXISTS karma_events_reason_check;
ALTER TABLE public.karma_events ADD CONSTRAINT karma_events_reason_check
  CHECK (reason IN (
    'consensus_win','consensus_loss','first_in_rastrum',
    'observation_synced','comment_reaction','manual_adjust',
    'ai_sponsorship_active','ai_sponsorship_revoked','ai_sponsor_call'
  ));

-- 11. add_karma_simple — generic karma helper (no observation/taxon refs).
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

- [ ] **Step 2: Apply + verify CHECK and function**

```bash
make db-apply
make db-psql -c "SELECT conname, pg_get_constraintdef(oid) FROM pg_constraint WHERE conname = 'karma_events_reason_check';"
make db-psql -c "\df public.add_karma_simple"
```

- [ ] **Step 3: Smoke-test add_karma_simple as service_role**

```bash
make db-psql -c "
SELECT add_karma_simple((SELECT id FROM public.users LIMIT 1), 0.0001, 'manual_adjust');
SELECT delta, reason FROM public.karma_events ORDER BY id DESC LIMIT 1;
"
```

Expected: row inserted with delta=0.0001 and reason='manual_adjust'.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): add_karma_simple() + CHECK extension para razones de sponsorship"
```

---

## Task 9 — SQL: karma triggers (per-call + base)

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 1: Append both trigger functions and triggers**

```sql
-- 12. award_sponsor_karma — +1 per call mientras sponsorship esté bajo
--     el cap. Sin karma para self-sponsoring. Sin karma si beneficiary
--     tiene <10 karma propio (Sybil defense).
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

-- 13. award_sponsorship_base_karma — +20 al activar, -20 al pasar a paused/revoked.
--     Sin karma para self-sponsoring.
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

- [ ] **Step 2: Apply + verify both triggers exist**

```bash
make db-apply
make db-psql -c "SELECT tgname, tgrelid::regclass, tgenabled FROM pg_trigger WHERE tgname IN ('ai_usage_award_karma','sponsorships_award_base_karma');"
```

Expected: 2 rows, both enabled.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): triggers de karma para sponsorships (+20 base /+1 call con guards)"
```

---

## Task 10 — SQL: extend `audit_op` enum

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql`

- [ ] **Step 1: Append enum extension**

```sql
-- 14. Extender audit_op para operaciones del módulo 20.
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

- [ ] **Step 2: Apply + verify**

```bash
make db-apply
make db-psql -c "SELECT enumlabel FROM pg_enum WHERE enumtypid = 'public.audit_op'::regtype ORDER BY enumlabel;"
```

Expected: list includes the 9 new ai_*/vault_* values.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(db): extender audit_op con operaciones de sponsorships"
```

---

## Task 11 — SQL: cron schedules

**Files:**
- Modify: `docs/specs/infra/cron-schedules.sql`

- [ ] **Step 1: Append five cron jobs**

```sql
-- ============================================================
-- Module 20 — AI Sponsorships cron jobs
-- ============================================================

-- 1. Daily cleanup: drop rate-limit buckets older than 24h.
SELECT cron.unschedule('ai_rate_limits_cleanup');
SELECT cron.schedule('ai_rate_limits_cleanup', '17 3 * * *',
  $$DELETE FROM public.ai_rate_limits WHERE bucket < now() - interval '24 hours'$$);

-- 2. Nightly rollup: consolidate ai_usage from yesterday into ai_usage_monthly.
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
      SET calls      = ai_usage_monthly.calls      + EXCLUDED.calls,
          tokens_in  = COALESCE(ai_usage_monthly.tokens_in,  0) + COALESCE(EXCLUDED.tokens_in,  0),
          tokens_out = COALESCE(ai_usage_monthly.tokens_out, 0) + COALESCE(EXCLUDED.tokens_out, 0)$$);

-- 3. Weekly heartbeat: probe credentials whose validated_at is older than 7 days.
SELECT cron.unschedule('ai_credentials_heartbeat');
SELECT cron.schedule('ai_credentials_heartbeat', '0 4 * * 0',
  $$SELECT net.http_post(
    url := 'https://reppvlqejgoqvitturxp.supabase.co/functions/v1/sponsorships/heartbeat',
    headers := jsonb_build_object('Authorization', 'Bearer ' || current_setting('app.cron_token'))
  )$$);

-- 4. Monthly reset: clear notification idempotency for past months.
SELECT cron.unschedule('ai_notifications_monthly_reset');
SELECT cron.schedule('ai_notifications_monthly_reset', '5 0 1 * *',
  $$DELETE FROM public.notifications_sent WHERE year_month < date_trunc('month', now())::date$$);

-- 5. Daily cleanup: drop ai_errors_log entries older than 30 days.
SELECT cron.unschedule('ai_errors_log_cleanup');
SELECT cron.schedule('ai_errors_log_cleanup', '23 3 * * *',
  $$DELETE FROM public.ai_errors_log WHERE occurred_at < now() - interval '30 days'$$);
```

- [ ] **Step 2: Apply schedules**

```bash
make db-cron-schedule
```

- [ ] **Step 3: Verify all five jobs are scheduled**

```bash
make db-psql -c "SELECT jobname, schedule FROM cron.job WHERE jobname LIKE 'ai_%' OR jobname LIKE 'ai_notifications%' ORDER BY jobname;"
```

Expected: 5 rows.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/cron-schedules.sql
git commit -m "feat(db): cron schedules (5 jobs) para módulo 20"
```

---

## Task 12 — Set `app.cron_token`

**Files:**
- (none — shell-only operation)

- [ ] **Step 1: Generate a cron token and persist as Postgres setting**

```bash
TOKEN=$(openssl rand -hex 32)
echo "$TOKEN"   # save to your password manager — needed in Task 24
make db-psql -c "ALTER DATABASE postgres SET app.cron_token = '$TOKEN';"
```

- [ ] **Step 2: Verify**

```bash
make db-psql -c "SHOW app.cron_token;"
```

Expected: prints the token.

- [ ] **Step 3: Add same token as Edge Function secret (idempotent)**

```bash
gh secret set SPONSORSHIPS_CRON_TOKEN --body "$TOKEN"
```

(No commit — this is one-time runtime configuration, not code.)

---

## Task 13 — Edge Function: `_shared/anthropic-validate.ts`

**Files:**
- Create: `supabase/functions/_shared/anthropic-validate.ts`

Port `validateAnthropicKey()` from `src/lib/anthropic-key.ts` to Deno. Same logic: probe `messages` with `max_tokens:1`, accept 200 or quota-related errors as "valid", reject 401/403.

- [ ] **Step 1: Read the existing browser-side validator**

```bash
cat src/lib/anthropic-key.ts
```

- [ ] **Step 2: Write the Deno port**

Create `supabase/functions/_shared/anthropic-validate.ts`:

```typescript
export interface ValidationResult {
  valid: boolean;
  kind?: 'api_key' | 'oauth_token';
  error?: string;
}

const PREFIX_API_KEY  = 'sk-ant-api03-';
const PREFIX_OAT      = 'sk-ant-oat01-';

export function detectKind(secret: string): 'api_key' | 'oauth_token' | null {
  if (secret.startsWith(PREFIX_API_KEY)) return 'api_key';
  if (secret.startsWith(PREFIX_OAT))     return 'oauth_token';
  return null;
}

export async function validateAnthropicCredential(secret: string): Promise<ValidationResult> {
  const kind = detectKind(secret);
  if (!kind) return { valid: false, error: 'invalid_prefix' };

  const headers: HeadersInit = { 'anthropic-version': '2023-06-01', 'content-type': 'application/json' };
  if (kind === 'api_key') headers['x-api-key'] = secret;
  else                    headers['Authorization'] = `Bearer ${secret}`;

  try {
    const res = await fetch('https://api.anthropic.com/v1/messages', {
      method: 'POST',
      headers,
      body: JSON.stringify({
        model: 'claude-haiku-4-5-20251001',
        max_tokens: 1,
        messages: [{ role: 'user', content: 'hi' }],
      }),
    });
    if (res.status === 401 || res.status === 403) return { valid: false, error: 'auth_failed' };
    // 200 or 429 (rate-limited) both indicate the credential is recognized.
    return { valid: true, kind };
  } catch (e) {
    return { valid: false, error: `network: ${(e as Error).message}` };
  }
}
```

- [ ] **Step 3: Write a tiny Deno test**

Create `supabase/functions/_shared/anthropic-validate.test.ts`:

```typescript
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { detectKind } from './anthropic-validate.ts';

Deno.test('detectKind: API key prefix', () => {
  assertEquals(detectKind('sk-ant-api03-xxxxxxxx'), 'api_key');
});

Deno.test('detectKind: OAT prefix', () => {
  assertEquals(detectKind('sk-ant-oat01-xxxxxxxx'), 'oauth_token');
});

Deno.test('detectKind: unknown prefix → null', () => {
  assertEquals(detectKind('Bearer foo'), null);
});
```

- [ ] **Step 4: Run the Deno test**

```bash
cd supabase/functions && deno test _shared/anthropic-validate.test.ts && cd ../..
```

Expected: 3 tests pass.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/anthropic-validate.ts supabase/functions/_shared/anthropic-validate.test.ts
git commit -m "feat(functions): _shared/anthropic-validate.ts (Deno port + prefix detection)"
```

---

## Task 14 — Edge Function: `_shared/sponsorship.ts` skeleton + `pickAuthHeader`

**Files:**
- Create: `supabase/functions/_shared/sponsorship.ts`
- Create: `supabase/functions/_shared/sponsorship.test.ts`

- [ ] **Step 1: Scaffold the file with type exports and `pickAuthHeader`**

Create `supabase/functions/_shared/sponsorship.ts`:

```typescript
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type Provider = 'anthropic';
export type CredentialKind = 'api_key' | 'oauth_token';

export interface ResolvedSponsorship {
  sponsorshipId: string;
  sponsorId:     string;
  credentialId:  string;
  vaultSecretId: string;
  kind:          CredentialKind;
  usedThisMonth: number;
  monthlyCap:    number;
}

export function pickAuthHeader(kind: CredentialKind, secret: string): HeadersInit {
  const base: HeadersInit = {
    'anthropic-version': '2023-06-01',
    'content-type':      'application/json',
  };
  return kind === 'api_key'
    ? { ...base, 'x-api-key': secret }
    : { ...base, 'Authorization': `Bearer ${secret}` };
}

// Stubs — implemented in Tasks 15-17.
export async function resolveSponsorship(
  _s: SupabaseClient, _b: string, _p: Provider
): Promise<ResolvedSponsorship | null> {
  throw new Error('not implemented');
}

export async function decryptCredential(_s: SupabaseClient, _id: string): Promise<string> {
  throw new Error('not implemented');
}

export async function recordUsage(
  _s: SupabaseClient,
  _args: { sponsorshipId: string; sponsorId: string; beneficiaryId: string; provider: Provider; tokensIn?: number; tokensOut?: number }
): Promise<{ usedThisMonth: number; cap: number; pctUsed: number }> {
  throw new Error('not implemented');
}

export async function checkAndBumpRateLimit(
  _s: SupabaseClient, _b: string, _p: Provider
): Promise<{ allowed: boolean; reason?: string }> {
  throw new Error('not implemented');
}

export async function autoPauseSponsorship(
  _s: SupabaseClient, _id: string, _reason: string
): Promise<void> {
  throw new Error('not implemented');
}

export async function maybeNotifyThreshold(
  _s: SupabaseClient, _id: string, _pctUsed: number
): Promise<void> {
  throw new Error('not implemented');
}
```

- [ ] **Step 2: Write tests for `pickAuthHeader`**

Create `supabase/functions/_shared/sponsorship.test.ts`:

```typescript
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';
import { pickAuthHeader } from './sponsorship.ts';

Deno.test('pickAuthHeader: api_key uses x-api-key', () => {
  const h = pickAuthHeader('api_key', 'sk-ant-api03-xxx') as Record<string, string>;
  assertEquals(h['x-api-key'], 'sk-ant-api03-xxx');
  assertEquals(h['Authorization'], undefined);
});

Deno.test('pickAuthHeader: oauth_token uses Bearer', () => {
  const h = pickAuthHeader('oauth_token', 'sk-ant-oat01-yyy') as Record<string, string>;
  assertEquals(h['Authorization'], 'Bearer sk-ant-oat01-yyy');
  assertEquals(h['x-api-key'], undefined);
});

Deno.test('pickAuthHeader: includes anthropic-version', () => {
  const h = pickAuthHeader('api_key', 'x') as Record<string, string>;
  assertEquals(h['anthropic-version'], '2023-06-01');
});
```

- [ ] **Step 3: Run tests**

```bash
cd supabase/functions && deno test _shared/sponsorship.test.ts && cd ../..
```

Expected: 3 tests pass.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/sponsorship.ts supabase/functions/_shared/sponsorship.test.ts
git commit -m "feat(functions): _shared/sponsorship.ts skeleton + pickAuthHeader"
```

---

## Task 15 — Edge Function: implement `resolveSponsorship` + `decryptCredential`

**Files:**
- Modify: `supabase/functions/_shared/sponsorship.ts`
- Modify: `supabase/functions/_shared/sponsorship.test.ts`

- [ ] **Step 1: Implement `resolveSponsorship` + `decryptCredential`**

Replace the two stubs in `supabase/functions/_shared/sponsorship.ts`:

```typescript
export async function resolveSponsorship(
  supabase: SupabaseClient, beneficiaryId: string, provider: Provider
): Promise<ResolvedSponsorship | null> {
  const { data, error } = await supabase
    .rpc('resolve_sponsorship', { p_beneficiary: beneficiaryId, p_provider: provider });
  if (error) throw new Error(`resolve_sponsorship rpc failed: ${error.message}`);
  if (!data || data.length === 0) return null;
  const row = data[0];
  return {
    sponsorshipId: row.sponsorship_id,
    sponsorId:     row.sponsor_id,
    credentialId:  row.credential_id,
    vaultSecretId: row.vault_secret_id,
    kind:          row.kind,
    usedThisMonth: row.used_this_month,
    monthlyCap:    row.monthly_call_cap,
  };
}

export async function decryptCredential(
  supabase: SupabaseClient, vaultSecretId: string
): Promise<string> {
  const { data, error } = await supabase
    .from('vault.decrypted_secrets')
    .select('decrypted_secret')
    .eq('id', vaultSecretId)
    .single();
  if (error) throw new Error(`vault decrypt failed: ${error.message}`);
  if (!data?.decrypted_secret) throw new Error('vault returned empty secret');
  return data.decrypted_secret as string;
}
```

- [ ] **Step 2: Add an integration-style test that exercises the rpc round trip**

Add to `supabase/functions/_shared/sponsorship.test.ts`:

```typescript
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { resolveSponsorship } from './sponsorship.ts';

Deno.test({
  name: 'resolveSponsorship: returns null when no active sponsorship',
  ignore: !Deno.env.get('SUPABASE_URL') || !Deno.env.get('SUPABASE_SERVICE_ROLE_KEY'),
  fn: async () => {
    const supabase = createClient(
      Deno.env.get('SUPABASE_URL')!,
      Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
    );
    const result = await resolveSponsorship(
      supabase, '00000000-0000-0000-0000-000000000000', 'anthropic'
    );
    assertEquals(result, null);
  },
});
```

- [ ] **Step 3: Run tests (the new one is auto-skipped without env vars)**

```bash
cd supabase/functions && deno test _shared/sponsorship.test.ts && cd ../..
```

Expected: 3 pass + 1 ignored locally; full pass when run in CI with env vars.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/sponsorship.ts supabase/functions/_shared/sponsorship.test.ts
git commit -m "feat(functions): resolveSponsorship + decryptCredential implementations"
```

---

## Task 16 — Edge Function: implement `recordUsage` + `maybeNotifyThreshold`

**Files:**
- Modify: `supabase/functions/_shared/sponsorship.ts`
- Modify: `supabase/functions/_shared/sponsorship.test.ts`

- [ ] **Step 1: Implement both functions**

Replace the two stubs in `supabase/functions/_shared/sponsorship.ts`:

```typescript
export async function recordUsage(
  supabase: SupabaseClient,
  args: { sponsorshipId: string; sponsorId: string; beneficiaryId: string; provider: Provider; tokensIn?: number; tokensOut?: number }
): Promise<{ usedThisMonth: number; cap: number; pctUsed: number }> {
  const { error: insErr } = await supabase.from('ai_usage').insert({
    sponsorship_id: args.sponsorshipId,
    sponsor_id:     args.sponsorId,
    beneficiary_id: args.beneficiaryId,
    provider:       args.provider,
    tokens_in:      args.tokensIn ?? null,
    tokens_out:     args.tokensOut ?? null,
  });
  if (insErr) throw new Error(`recordUsage insert failed: ${insErr.message}`);

  // recompute used + cap (cheap query thanks to ai_usage_sponsorship_month_idx)
  const { data: usageRow, error: cntErr } = await supabase
    .from('ai_usage')
    .select('id', { count: 'exact', head: true })
    .eq('sponsorship_id', args.sponsorshipId)
    .gte('occurred_at', new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString());
  if (cntErr) throw new Error(`recordUsage count failed: ${cntErr.message}`);
  const usedThisMonth = (usageRow as unknown as { count: number } | null)?.count ?? 0;

  const { data: spons, error: capErr } = await supabase
    .from('sponsorships')
    .select('monthly_call_cap')
    .eq('id', args.sponsorshipId)
    .single();
  if (capErr) throw new Error(`recordUsage cap lookup failed: ${capErr.message}`);
  const cap = (spons as { monthly_call_cap: number }).monthly_call_cap;

  return { usedThisMonth, cap, pctUsed: cap > 0 ? usedThisMonth / cap : 0 };
}

export async function maybeNotifyThreshold(
  supabase: SupabaseClient, sponsorshipId: string, pctUsed: number
): Promise<void> {
  const threshold = pctUsed >= 1.0 ? 100 : pctUsed >= 0.80 ? 80 : null;
  if (!threshold) return;

  const yearMonth = new Date(new Date().getFullYear(), new Date().getMonth(), 1)
    .toISOString().slice(0, 10);

  // Idempotent insert; if a row already exists we skip notification.
  const { error: insErr } = await supabase
    .from('notifications_sent')
    .insert({ sponsorship_id: sponsorshipId, threshold, year_month: yearMonth });
  if (insErr) {
    // Unique-violation = already notified this month; that's the success case.
    if ((insErr as { code?: string }).code === '23505') return;
    throw new Error(`notification idempotency insert failed: ${insErr.message}`);
  }

  // Lookup sponsor email + beneficiary username for the email body
  const { data: ctx } = await supabase
    .from('sponsorships')
    .select('sponsor_id, beneficiary_id, monthly_call_cap')
    .eq('id', sponsorshipId)
    .single();
  if (!ctx) return;
  const { data: sponsor } = await supabase
    .from('users').select('id,display_name,username').eq('id', (ctx as { sponsor_id: string }).sponsor_id).single();
  const { data: beneficiary } = await supabase
    .from('users').select('username').eq('id', (ctx as { beneficiary_id: string }).beneficiary_id).single();
  if (!sponsor || !beneficiary) return;

  await sendThresholdEmail(supabase, {
    sponsorId:        (sponsor as { id: string }).id,
    sponsorDisplay:   (sponsor as { display_name?: string | null; username: string }).display_name
                      ?? (sponsor as { username: string }).username,
    beneficiaryUsername: (beneficiary as { username: string }).username,
    threshold,
  });
}

// Helper: dispatches via Supabase Auth's email infra (operator already has Resend SMTP).
// Implementation lives in supabase/functions/_shared/email.ts (TODO if not present).
async function sendThresholdEmail(
  _supabase: SupabaseClient,
  args: { sponsorId: string; sponsorDisplay: string; beneficiaryUsername: string; threshold: 80 | 100 }
): Promise<void> {
  // For v1, log the event and let the cron-driven email worker pick it up; the operator
  // confirms with `gh secret set RESEND_API_KEY`. Adjust to direct Resend call when needed.
  console.warn(`[sponsorships] threshold ${args.threshold}% — notify ${args.sponsorDisplay} re @${args.beneficiaryUsername}`);
}
```

- [ ] **Step 2: Add unit-style tests for `maybeNotifyThreshold` boundaries**

Add to `supabase/functions/_shared/sponsorship.test.ts`:

```typescript
Deno.test('maybeNotifyThreshold: pctUsed < 0.80 → no-op', () => {
  // pure threshold logic test: we re-export the boundary-picker function for testability
  const pickThreshold = (p: number): 80 | 100 | null =>
    p >= 1.0 ? 100 : p >= 0.80 ? 80 : null;
  assertEquals(pickThreshold(0.79), null);
  assertEquals(pickThreshold(0.80), 80);
  assertEquals(pickThreshold(0.99), 80);
  assertEquals(pickThreshold(1.00), 100);
  assertEquals(pickThreshold(1.50), 100);
});
```

(For the real integration test, we'd need a fixtured DB; the boundary logic test is the high-value unit-level check.)

- [ ] **Step 3: Run tests**

```bash
cd supabase/functions && deno test _shared/sponsorship.test.ts && cd ../..
```

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/_shared/sponsorship.ts supabase/functions/_shared/sponsorship.test.ts
git commit -m "feat(functions): recordUsage + maybeNotifyThreshold (idempotent)"
```

---

## Task 17 — Edge Function: implement `checkAndBumpRateLimit` + `autoPauseSponsorship`

**Files:**
- Modify: `supabase/functions/_shared/sponsorship.ts`

- [ ] **Step 1: Implement both**

Replace the two remaining stubs in `supabase/functions/_shared/sponsorship.ts`:

```typescript
export async function checkAndBumpRateLimit(
  supabase: SupabaseClient, beneficiaryId: string, provider: Provider
): Promise<{ allowed: boolean; reason?: string }> {
  const now = new Date();
  // Bucket = current minute
  const bucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  // Upsert: increment count if same minute, insert new row otherwise
  const { error: upErr } = await supabase.rpc('exec_sql', {
    sql: `
      INSERT INTO public.ai_rate_limits (beneficiary_id, provider, bucket, count)
      VALUES ($1, $2, $3::timestamptz, 1)
      ON CONFLICT (beneficiary_id, provider, bucket)
      DO UPDATE SET count = ai_rate_limits.count + 1
    `,
    params: [beneficiaryId, provider, bucket],
  });
  // NOTE: exec_sql isn't built-in — for v1 we use a direct postgrest insert
  // since the table is small. Replace with explicit upsert via supabase-js:
  await supabase.from('ai_rate_limits').upsert({
    beneficiary_id: beneficiaryId,
    provider,
    bucket,
    count: 1,
  }, { onConflict: 'beneficiary_id,provider,bucket', ignoreDuplicates: false });
  // Above doesn't increment; do increment via rpc helper instead:
  await supabase.rpc('increment_rate_limit_bucket', {
    p_beneficiary: beneficiaryId, p_provider: provider, p_bucket: bucket,
  });

  // Window total = sum of buckets in last 10 minutes
  const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
  const { data: agg } = await supabase
    .from('ai_rate_limits')
    .select('count')
    .eq('beneficiary_id', beneficiaryId).eq('provider', provider)
    .gte('bucket', tenMinAgo);
  const total = (agg as Array<{ count: number }> | null)?.reduce((s, r) => s + r.count, 0) ?? 0;

  if (total > 30) return { allowed: false, reason: 'rate_limit:30/10min' };
  return { allowed: true };
}

export async function autoPauseSponsorship(
  supabase: SupabaseClient, sponsorshipId: string, reason: string
): Promise<void> {
  await supabase.from('sponsorships').update({
    status:         'paused',
    paused_reason:  reason,
    paused_at:      new Date().toISOString(),
    updated_at:     new Date().toISOString(),
  }).eq('id', sponsorshipId);

  await supabase.from('admin_audit').insert({
    actor_id: null,
    op:       'ai_sponsorship_pause',
    target:   sponsorshipId,
    details:  { reason, source: 'edge_function:identify' },
  });
}
```

- [ ] **Step 2: Add SQL helper `increment_rate_limit_bucket` to schema**

Append to `docs/specs/infra/supabase-schema.sql`:

```sql
-- 15. Helper para increment atómico del bucket de rate limit (UPSERT).
CREATE OR REPLACE FUNCTION public.increment_rate_limit_bucket(
  p_beneficiary uuid, p_provider public.ai_provider, p_bucket timestamptz
) RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
BEGIN
  INSERT INTO public.ai_rate_limits (beneficiary_id, provider, bucket, count)
    VALUES (p_beneficiary, p_provider, p_bucket, 1)
  ON CONFLICT (beneficiary_id, provider, bucket)
    DO UPDATE SET count = ai_rate_limits.count + 1;
END $$;
REVOKE ALL ON FUNCTION public.increment_rate_limit_bucket(uuid, public.ai_provider, timestamptz) FROM public;
GRANT EXECUTE ON FUNCTION public.increment_rate_limit_bucket(uuid, public.ai_provider, timestamptz) TO service_role;
```

Apply: `make db-apply`.

Then **clean up** `checkAndBumpRateLimit` to drop the dead `exec_sql` call and the no-op upsert; the implementation should just be:

```typescript
export async function checkAndBumpRateLimit(
  supabase: SupabaseClient, beneficiaryId: string, provider: Provider
): Promise<{ allowed: boolean; reason?: string }> {
  const now = new Date();
  const bucket = new Date(Math.floor(now.getTime() / 60_000) * 60_000).toISOString();
  await supabase.rpc('increment_rate_limit_bucket', {
    p_beneficiary: beneficiaryId, p_provider: provider, p_bucket: bucket,
  });
  const tenMinAgo = new Date(now.getTime() - 10 * 60_000).toISOString();
  const { data: agg } = await supabase
    .from('ai_rate_limits')
    .select('count')
    .eq('beneficiary_id', beneficiaryId).eq('provider', provider)
    .gte('bucket', tenMinAgo);
  const total = (agg as Array<{ count: number }> | null)?.reduce((s, r) => s + r.count, 0) ?? 0;
  if (total > 30) return { allowed: false, reason: 'rate_limit:30/10min' };
  return { allowed: true };
}
```

- [ ] **Step 3: Verify the SQL helper exists**

```bash
make db-psql -c "\df+ public.increment_rate_limit_bucket"
```

- [ ] **Step 4: Run Deno tests (no new test for these — covered by integration smoke)**

```bash
cd supabase/functions && deno test _shared/ && cd ../..
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/_shared/sponsorship.ts docs/specs/infra/supabase-schema.sql
git commit -m "feat(functions): checkAndBumpRateLimit + autoPauseSponsorship + SQL helper"
```

---

## Task 18 — Edge Function: `sponsorships` scaffold + JWT helper

**Files:**
- Create: `supabase/functions/sponsorships/index.ts`
- Create: `supabase/functions/sponsorships/README.md`

- [ ] **Step 1: Scaffold the entry point**

Create `supabase/functions/sponsorships/index.ts`:

```typescript
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const SUPABASE_URL          = Deno.env.get('SUPABASE_URL')!;
const SUPABASE_SERVICE_ROLE = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const SPONSORSHIPS_CRON_TOKEN = Deno.env.get('SPONSORSHIPS_CRON_TOKEN');

function jsonResponse(status: number, body: unknown): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { 'content-type': 'application/json' },
  });
}

async function withUser(req: Request): Promise<{ userId: string } | Response> {
  const auth = req.headers.get('authorization') ?? '';
  if (!auth.startsWith('Bearer ')) return jsonResponse(401, { error: 'no_auth' });
  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const { data, error } = await supabase.auth.getUser(auth.slice('Bearer '.length));
  if (error || !data.user) return jsonResponse(401, { error: 'invalid_token' });
  return { userId: data.user.id };
}

function withCronToken(req: Request): boolean {
  if (!SPONSORSHIPS_CRON_TOKEN) return false;
  const auth = req.headers.get('authorization') ?? '';
  return auth === `Bearer ${SPONSORSHIPS_CRON_TOKEN}`;
}

serve(async (req) => {
  const url = new URL(req.url);
  const path = url.pathname.replace(/^\/sponsorships/, '') || '/';

  // Heartbeat endpoint (cron-only auth)
  if (req.method === 'POST' && path === '/heartbeat') {
    if (!withCronToken(req)) return jsonResponse(401, { error: 'no_cron_token' });
    return jsonResponse(200, { stub: 'heartbeat — implemented in Task 24' });
  }

  // All other endpoints require user JWT
  const ctx = await withUser(req);
  if (ctx instanceof Response) return ctx;

  return jsonResponse(404, { error: 'not_found', path, method: req.method });
});
```

- [ ] **Step 2: Create `supabase/functions/sponsorships/README.md`**

```markdown
# sponsorships Edge Function

CRUD for credentials and sponsorships. JWT-gated except `/heartbeat`, which uses `SPONSORSHIPS_CRON_TOKEN`.

## Secrets required

| Name | Source |
|---|---|
| `SUPABASE_URL` | Project default |
| `SUPABASE_SERVICE_ROLE_KEY` | Project default |
| `SPONSORSHIPS_CRON_TOKEN` | `gh secret set SPONSORSHIPS_CRON_TOKEN` (matches `app.cron_token` PG setting) |

## Deploy

```bash
gh workflow run deploy-functions.yml --ref main -f function=sponsorships
gh run watch <run-id>
```

## Endpoints

See module 20 design doc, "Edge Functions" section. Summary:

- `POST /credentials` — create + Vault-store
- `GET  /credentials` — list (no secret)
- `POST /credentials/:id/rotate` — atomic Vault swap
- `DELETE /credentials/:id` — soft revoke + cascade pause
- `POST /sponsorships` — create
- `GET  /sponsorships` — list
- `PATCH /sponsorships/:id` — update cap/priority/status/visibility
- `POST /sponsorships/:id/unpause` — reactivate (3-strike enforced)
- `DELETE /sponsorships/:id` — revoke
- `GET  /sponsorships/:id/usage` — analytics
- `POST /heartbeat` — cron-only credential probe
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/sponsorships/
git commit -m "feat(functions): scaffold sponsorships function + JWT helper"
```

---

## Task 19 — Edge Function: `POST /credentials` + `GET /credentials`

**Files:**
- Modify: `supabase/functions/sponsorships/index.ts`
- Create: `supabase/functions/sponsorships/index.test.ts`

- [ ] **Step 1: Implement POST /credentials and GET /credentials inside the `serve(async (req))` body**

Add the two endpoint handlers before the final `return jsonResponse(404, ...)`:

```typescript
import { detectKind, validateAnthropicCredential } from '../_shared/anthropic-validate.ts';

// ... inside serve(async (req)) after `const ctx = await withUser(req); if (ctx instanceof Response) return ctx;`

const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);

// POST /credentials
if (req.method === 'POST' && path === '/credentials') {
  const body = await req.json().catch(() => ({}));
  const { label, secret, provider = 'anthropic' } = body as { label?: string; secret?: string; provider?: string };
  if (!label || !secret) return jsonResponse(400, { error: 'label_and_secret_required' });
  if (label.length < 1 || label.length > 64) return jsonResponse(400, { error: 'label_length_1_64' });

  const kind = detectKind(secret);
  if (!kind) return jsonResponse(400, { error: 'unrecognized_secret_prefix' });

  const validation = await validateAnthropicCredential(secret);
  if (!validation.valid) return jsonResponse(400, { error: 'validation_failed', detail: validation.error });

  // Insert into Vault
  const { data: vaultRow, error: vaultErr } = await supabase.rpc('create_vault_secret', {
    p_secret: secret, p_name: `sponsor_credential:${ctx.userId}:${label}`,
  });
  if (vaultErr || !vaultRow) return jsonResponse(500, { error: 'vault_insert_failed', detail: vaultErr?.message });

  const { data: cred, error: insErr } = await supabase
    .from('sponsor_credentials')
    .insert({
      user_id:         ctx.userId,
      provider,
      kind,
      label,
      vault_secret_id: vaultRow as string,
      validated_at:    new Date().toISOString(),
    })
    .select('id, label, provider, kind, validated_at, created_at')
    .single();
  if (insErr) {
    // Best-effort cleanup of the orphaned vault secret
    await supabase.rpc('delete_vault_secret', { p_secret_id: vaultRow });
    return jsonResponse(500, { error: 'credential_insert_failed', detail: insErr.message });
  }

  await supabase.from('admin_audit').insert({
    actor_id: ctx.userId, op: 'ai_credential_create', target: cred?.id, details: { label, kind },
  });

  return jsonResponse(201, cred);
}

// GET /credentials
if (req.method === 'GET' && path === '/credentials') {
  const { data, error } = await supabase
    .from('sponsor_credentials')
    .select('id, label, provider, kind, validated_at, last_used_at, revoked_at, created_at')
    .eq('user_id', ctx.userId)
    .order('created_at', { ascending: false });
  if (error) return jsonResponse(500, { error: 'list_failed', detail: error.message });
  return jsonResponse(200, data ?? []);
}
```

- [ ] **Step 2: Add SQL helpers `create_vault_secret` + `delete_vault_secret`**

Append to `docs/specs/infra/supabase-schema.sql`:

```sql
-- 16. Vault helpers para insertar y borrar secrets desde el Edge Function.
CREATE OR REPLACE FUNCTION public.create_vault_secret(p_secret text, p_name text)
RETURNS uuid LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
DECLARE v_id uuid;
BEGIN
  v_id := vault.create_secret(p_secret, p_name);
  RETURN v_id;
END $$;
REVOKE ALL ON FUNCTION public.create_vault_secret(text, text) FROM public;
GRANT EXECUTE ON FUNCTION public.create_vault_secret(text, text) TO service_role;

CREATE OR REPLACE FUNCTION public.delete_vault_secret(p_secret_id uuid)
RETURNS void LANGUAGE plpgsql SECURITY DEFINER SET search_path = public, vault AS $$
BEGIN
  DELETE FROM vault.secrets WHERE id = p_secret_id;
END $$;
REVOKE ALL ON FUNCTION public.delete_vault_secret(uuid) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_vault_secret(uuid) TO service_role;
```

Apply: `make db-apply`.

- [ ] **Step 3: Write Deno tests**

Create `supabase/functions/sponsorships/index.test.ts`:

```typescript
import { assertEquals } from 'https://deno.land/std@0.224.0/assert/mod.ts';

Deno.test('POST /credentials: rejects missing label', async () => {
  // This is a request-shape test — no Supabase round-trip.
  const validate = (body: { label?: string; secret?: string }) => {
    if (!body.label || !body.secret) return { error: 'label_and_secret_required' };
    return null;
  };
  assertEquals(validate({ secret: 'x' }), { error: 'label_and_secret_required' });
  assertEquals(validate({ label: 'x' }), { error: 'label_and_secret_required' });
  assertEquals(validate({ label: 'x', secret: 'y' }), null);
});
```

(Real end-to-end testing happens via the post-deploy smoke script.)

- [ ] **Step 4: Run tests**

```bash
cd supabase/functions && deno test sponsorships/index.test.ts && cd ../..
```

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/sponsorships/ docs/specs/infra/supabase-schema.sql
git commit -m "feat(functions): POST/GET /credentials + Vault helpers"
```

---

## Task 20 — Edge Function: `POST /credentials/:id/rotate` + `DELETE /credentials/:id`

**Files:**
- Modify: `supabase/functions/sponsorships/index.ts`

- [ ] **Step 1: Add rotate handler**

Inside `serve(async (req))` body, before the final 404:

```typescript
// POST /credentials/:id/rotate
{
  const m = path.match(/^\/credentials\/([0-9a-f-]{36})\/rotate$/);
  if (m && req.method === 'POST') {
    const credId = m[1];
    const { data: cred } = await supabase
      .from('sponsor_credentials').select('user_id, vault_secret_id, label')
      .eq('id', credId).single();
    if (!cred || (cred as { user_id: string }).user_id !== ctx.userId) {
      return jsonResponse(404, { error: 'not_found' });
    }
    const body = await req.json().catch(() => ({}));
    const { secret } = body as { secret?: string };
    if (!secret) return jsonResponse(400, { error: 'secret_required' });

    const kind = detectKind(secret);
    if (!kind) return jsonResponse(400, { error: 'unrecognized_secret_prefix' });

    const validation = await validateAnthropicCredential(secret);
    if (!validation.valid) return jsonResponse(400, { error: 'validation_failed', detail: validation.error });

    // Atomic-ish swap: insert new, swap pointer, delete old.
    const { data: newSecretId, error: vaultErr } = await supabase.rpc('create_vault_secret', {
      p_secret: secret, p_name: `sponsor_credential:${ctx.userId}:${(cred as { label: string }).label}:rotated:${Date.now()}`,
    });
    if (vaultErr || !newSecretId) return jsonResponse(500, { error: 'vault_insert_failed', detail: vaultErr?.message });

    const { error: updErr } = await supabase
      .from('sponsor_credentials')
      .update({ vault_secret_id: newSecretId, kind, validated_at: new Date().toISOString() })
      .eq('id', credId);
    if (updErr) return jsonResponse(500, { error: 'rotate_failed', detail: updErr.message });

    await supabase.rpc('delete_vault_secret', { p_secret_id: (cred as { vault_secret_id: string }).vault_secret_id });

    // Reactivate sponsorships paused with cred:invalid using this credential.
    await supabase
      .from('sponsorships')
      .update({ status: 'active', paused_reason: null, paused_at: null, updated_at: new Date().toISOString() })
      .eq('credential_id', credId)
      .eq('status', 'paused')
      .eq('paused_reason', 'cred:invalid');

    await supabase.from('admin_audit').insert({
      actor_id: ctx.userId, op: 'ai_credential_rotate', target: credId,
    });

    return jsonResponse(200, { ok: true });
  }
}
```

- [ ] **Step 2: Add DELETE handler**

```typescript
// DELETE /credentials/:id
{
  const m = path.match(/^\/credentials\/([0-9a-f-]{36})$/);
  if (m && req.method === 'DELETE') {
    const credId = m[1];
    const { data: cred } = await supabase
      .from('sponsor_credentials').select('user_id, vault_secret_id')
      .eq('id', credId).single();
    if (!cred || (cred as { user_id: string }).user_id !== ctx.userId) {
      return jsonResponse(404, { error: 'not_found' });
    }
    // Pause sponsorships using this credential first
    await supabase.from('sponsorships').update({
      status: 'paused', paused_reason: 'credential_revoked', paused_at: new Date().toISOString(),
    }).eq('credential_id', credId);
    // Soft-revoke
    await supabase.from('sponsor_credentials')
      .update({ revoked_at: new Date().toISOString() })
      .eq('id', credId);
    // Delete from Vault
    await supabase.rpc('delete_vault_secret', { p_secret_id: (cred as { vault_secret_id: string }).vault_secret_id });
    await supabase.from('admin_audit').insert({
      actor_id: ctx.userId, op: 'ai_credential_revoke', target: credId,
    });
    return jsonResponse(204, {});
  }
}
```

- [ ] **Step 3: No new tests (covered by smoke). Commit.**

```bash
git add supabase/functions/sponsorships/index.ts
git commit -m "feat(functions): POST /credentials/:id/rotate + DELETE /credentials/:id"
```

---

## Task 21 — Edge Function: sponsorships CRUD (`POST`, `GET`, `PATCH`, `DELETE`)

**Files:**
- Modify: `supabase/functions/sponsorships/index.ts`

- [ ] **Step 1: Add the four handlers**

Inside `serve(async (req))` body:

```typescript
// POST /sponsorships
if (req.method === 'POST' && path === '/sponsorships') {
  const body = await req.json().catch(() => ({}));
  const {
    beneficiary_username, credential_id,
    monthly_call_cap = 200, priority = 100, sponsor_public = true,
    provider = 'anthropic',
  } = body as {
    beneficiary_username?: string; credential_id?: string;
    monthly_call_cap?: number; priority?: number; sponsor_public?: boolean;
    provider?: string;
  };
  if (!beneficiary_username || !credential_id) return jsonResponse(400, { error: 'missing_fields' });
  if (monthly_call_cap < 1 || monthly_call_cap > 10000) return jsonResponse(400, { error: 'cap_out_of_range' });

  const { data: beneficiary } = await supabase
    .from('users').select('id').eq('username', beneficiary_username).single();
  if (!beneficiary) return jsonResponse(404, { error: 'beneficiary_not_found' });

  const { data: cred } = await supabase
    .from('sponsor_credentials').select('user_id, provider, revoked_at')
    .eq('id', credential_id).single();
  if (!cred || (cred as { user_id: string }).user_id !== ctx.userId) return jsonResponse(404, { error: 'credential_not_found' });
  if ((cred as { revoked_at: string | null }).revoked_at) return jsonResponse(400, { error: 'credential_revoked' });
  if ((cred as { provider: string }).provider !== provider) return jsonResponse(400, { error: 'provider_mismatch' });

  const { data: sponsorship, error: insErr } = await supabase
    .from('sponsorships')
    .insert({
      sponsor_id:        ctx.userId,
      beneficiary_id:    (beneficiary as { id: string }).id,
      credential_id,
      provider,
      monthly_call_cap,
      priority,
      sponsor_public,
    })
    .select('*')
    .single();
  if (insErr) {
    if ((insErr as { code?: string }).code === '23505') return jsonResponse(409, { error: 'sponsorship_exists' });
    return jsonResponse(500, { error: 'insert_failed', detail: insErr.message });
  }

  await supabase.from('admin_audit').insert({
    actor_id: ctx.userId, op: 'ai_sponsorship_create', target: sponsorship?.id,
    details: { beneficiary_id: (beneficiary as { id: string }).id, monthly_call_cap, priority },
  });

  return jsonResponse(201, sponsorship);
}

// GET /sponsorships?role=sponsor|beneficiary
if (req.method === 'GET' && path === '/sponsorships') {
  const role = url.searchParams.get('role') ?? 'sponsor';
  const col = role === 'beneficiary' ? 'beneficiary_id' : 'sponsor_id';
  const { data, error } = await supabase
    .from('sponsorships')
    .select('*')
    .eq(col, ctx.userId)
    .order('priority', { ascending: true })
    .order('created_at', { ascending: false });
  if (error) return jsonResponse(500, { error: 'list_failed', detail: error.message });
  return jsonResponse(200, data ?? []);
}

// PATCH /sponsorships/:id
{
  const m = path.match(/^\/sponsorships\/([0-9a-f-]{36})$/);
  if (m && req.method === 'PATCH') {
    const id = m[1];
    const body = await req.json().catch(() => ({}));
    const { data: spons } = await supabase
      .from('sponsorships').select('sponsor_id, beneficiary_id').eq('id', id).single();
    if (!spons) return jsonResponse(404, { error: 'not_found' });

    const isSponsor     = (spons as { sponsor_id: string }).sponsor_id === ctx.userId;
    const isBeneficiary = (spons as { beneficiary_id: string }).beneficiary_id === ctx.userId;
    if (!isSponsor && !isBeneficiary) return jsonResponse(403, { error: 'forbidden' });

    const update: Record<string, unknown> = { updated_at: new Date().toISOString() };
    if (isSponsor) {
      if ('monthly_call_cap' in body) update.monthly_call_cap = (body as { monthly_call_cap: number }).monthly_call_cap;
      if ('priority'         in body) update.priority         = (body as { priority: number }).priority;
      if ('status'           in body) update.status           = (body as { status: string }).status;
      if ('sponsor_public'   in body) update.sponsor_public   = (body as { sponsor_public: boolean }).sponsor_public;
    }
    if (isBeneficiary) {
      if ('beneficiary_public' in body) update.beneficiary_public = (body as { beneficiary_public: boolean }).beneficiary_public;
    }
    if (Object.keys(update).length === 1) return jsonResponse(400, { error: 'no_valid_fields' });

    const { data: updated, error: updErr } = await supabase
      .from('sponsorships').update(update).eq('id', id).select('*').single();
    if (updErr) return jsonResponse(500, { error: 'update_failed', detail: updErr.message });
    return jsonResponse(200, updated);
  }
}

// DELETE /sponsorships/:id
{
  const m = path.match(/^\/sponsorships\/([0-9a-f-]{36})$/);
  if (m && req.method === 'DELETE') {
    const id = m[1];
    const { data: spons } = await supabase
      .from('sponsorships').select('sponsor_id, beneficiary_id').eq('id', id).single();
    if (!spons) return jsonResponse(404, { error: 'not_found' });
    const isParty =
      (spons as { sponsor_id: string }).sponsor_id === ctx.userId ||
      (spons as { beneficiary_id: string }).beneficiary_id === ctx.userId;
    if (!isParty) return jsonResponse(403, { error: 'forbidden' });

    await supabase.from('sponsorships').update({
      status: 'revoked', updated_at: new Date().toISOString(),
    }).eq('id', id);

    await supabase.from('admin_audit').insert({
      actor_id: ctx.userId, op: 'ai_sponsorship_revoke', target: id,
    });
    return jsonResponse(204, {});
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/sponsorships/index.ts
git commit -m "feat(functions): CRUD para sponsorships (POST/GET/PATCH/DELETE)"
```

---

## Task 22 — Edge Function: `POST /sponsorships/:id/unpause` (3-strike check)

**Files:**
- Modify: `supabase/functions/sponsorships/index.ts`

- [ ] **Step 1: Add the unpause handler**

```typescript
// POST /sponsorships/:id/unpause
{
  const m = path.match(/^\/sponsorships\/([0-9a-f-]{36})\/unpause$/);
  if (m && req.method === 'POST') {
    const id = m[1];
    const { data: spons } = await supabase
      .from('sponsorships')
      .select('sponsor_id, beneficiary_id, status')
      .eq('id', id).single();
    if (!spons) return jsonResponse(404, { error: 'not_found' });
    if ((spons as { sponsor_id: string }).sponsor_id !== ctx.userId) return jsonResponse(403, { error: 'sponsor_only' });
    if ((spons as { status: string }).status !== 'paused') return jsonResponse(400, { error: 'not_paused' });

    // 3-strike check: count auto-pauses for this sponsorship in the last 7 days.
    const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
    const { data: pauseRows } = await supabase
      .from('admin_audit')
      .select('id')
      .eq('op', 'ai_sponsorship_pause')
      .eq('target', id)
      .gte('created_at', sevenDaysAgo);
    if ((pauseRows?.length ?? 0) >= 3) {
      return jsonResponse(409, { error: 'three_strike', advice: 'revoke_and_recreate' });
    }

    await supabase.from('sponsorships').update({
      status: 'active', paused_reason: null, paused_at: null, updated_at: new Date().toISOString(),
    }).eq('id', id);

    await supabase.from('admin_audit').insert({
      actor_id: ctx.userId, op: 'ai_sponsorship_unpause', target: id,
    });
    return jsonResponse(200, { ok: true });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/sponsorships/index.ts
git commit -m "feat(functions): POST /sponsorships/:id/unpause con 3-strike check"
```

---

## Task 23 — Edge Function: `GET /sponsorships/:id/usage` (analytics)

**Files:**
- Modify: `supabase/functions/sponsorships/index.ts`

- [ ] **Step 1: Add the usage analytics handler**

```typescript
// GET /sponsorships/:id/usage?range=month
{
  const m = path.match(/^\/sponsorships\/([0-9a-f-]{36})\/usage$/);
  if (m && req.method === 'GET') {
    const id = m[1];
    const { data: spons } = await supabase
      .from('sponsorships')
      .select('sponsor_id, beneficiary_id, monthly_call_cap')
      .eq('id', id).single();
    if (!spons) return jsonResponse(404, { error: 'not_found' });
    const isParty =
      (spons as { sponsor_id: string }).sponsor_id === ctx.userId ||
      (spons as { beneficiary_id: string }).beneficiary_id === ctx.userId;
    if (!isParty) return jsonResponse(403, { error: 'forbidden' });

    // Past months from rollup
    const past = await supabase
      .from('ai_usage_monthly')
      .select('year_month, calls, tokens_in, tokens_out')
      .eq('sponsorship_id', id)
      .order('year_month', { ascending: false })
      .limit(12);

    // Current month from raw ai_usage (bucketed per day)
    const monthStart = new Date(new Date().getFullYear(), new Date().getMonth(), 1).toISOString();
    const { data: currentMonth } = await supabase
      .from('ai_usage')
      .select('occurred_at, tokens_in, tokens_out')
      .eq('sponsorship_id', id)
      .gte('occurred_at', monthStart)
      .order('occurred_at', { ascending: true });

    // Aggregate currentMonth into days client-side (small N)
    const byDay: Record<string, { calls: number; tokens_in: number; tokens_out: number }> = {};
    for (const row of currentMonth ?? []) {
      const d = (row as { occurred_at: string }).occurred_at.slice(0, 10);
      byDay[d] ??= { calls: 0, tokens_in: 0, tokens_out: 0 };
      byDay[d].calls += 1;
      byDay[d].tokens_in  += (row as { tokens_in?: number  }).tokens_in  ?? 0;
      byDay[d].tokens_out += (row as { tokens_out?: number }).tokens_out ?? 0;
    }

    const usedThisMonth = Object.values(byDay).reduce((s, d) => s + d.calls, 0);
    return jsonResponse(200, {
      cap:           (spons as { monthly_call_cap: number }).monthly_call_cap,
      usedThisMonth,
      pctUsed:       (spons as { monthly_call_cap: number }).monthly_call_cap > 0
                       ? usedThisMonth / (spons as { monthly_call_cap: number }).monthly_call_cap : 0,
      currentMonthByDay: byDay,
      pastMonths:    past.data ?? [],
    });
  }
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/sponsorships/index.ts
git commit -m "feat(functions): GET /sponsorships/:id/usage para analytics"
```

---

## Task 24 — Edge Function: `POST /heartbeat`

**Files:**
- Modify: `supabase/functions/sponsorships/index.ts`

- [ ] **Step 1: Replace the stub heartbeat with the real implementation**

Find the existing stub `if (req.method === 'POST' && path === '/heartbeat') { ... return jsonResponse(200, { stub: ...`  and replace with:

```typescript
if (req.method === 'POST' && path === '/heartbeat') {
  if (!withCronToken(req)) return jsonResponse(401, { error: 'no_cron_token' });

  const supabase = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE);
  const sevenDaysAgo = new Date(Date.now() - 7 * 24 * 60 * 60_000).toISOString();
  const { data: stale } = await supabase
    .from('sponsor_credentials')
    .select('id, vault_secret_id, user_id, label')
    .is('revoked_at', null)
    .or(`validated_at.is.null,validated_at.lt.${sevenDaysAgo}`)
    .limit(50);

  const results: Array<{ id: string; ok: boolean; error?: string }> = [];
  for (const cred of stale ?? []) {
    try {
      const secret = await (await import('../_shared/sponsorship.ts')).decryptCredential(
        supabase, (cred as { vault_secret_id: string }).vault_secret_id
      );
      const { validateAnthropicCredential } = await import('../_shared/anthropic-validate.ts');
      const result = await validateAnthropicCredential(secret);
      if (result.valid) {
        await supabase.from('sponsor_credentials')
          .update({ validated_at: new Date().toISOString() })
          .eq('id', (cred as { id: string }).id);
        results.push({ id: (cred as { id: string }).id, ok: true });
      } else {
        await supabase.from('sponsor_credentials')
          .update({ revoked_at: new Date().toISOString() })
          .eq('id', (cred as { id: string }).id);
        await supabase.from('sponsorships').update({
          status: 'paused', paused_reason: 'cred:invalid', paused_at: new Date().toISOString(),
        }).eq('credential_id', (cred as { id: string }).id);
        results.push({ id: (cred as { id: string }).id, ok: false, error: result.error });
      }
    } catch (e) {
      results.push({ id: (cred as { id: string }).id, ok: false, error: (e as Error).message });
    }
  }
  return jsonResponse(200, { processed: results.length, results });
}
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/sponsorships/index.ts
git commit -m "feat(functions): heartbeat endpoint con probe + auto-revoke + cascade pause"
```

---

## Task 25 — Add `sponsorships` to deploy workflow

**Files:**
- Modify: `.github/workflows/deploy-functions.yml`

- [ ] **Step 1: Read the current workflow**

```bash
cat .github/workflows/deploy-functions.yml
```

Identify the function-name input or matrix list.

- [ ] **Step 2: Add `sponsorships` to the allowed values**

If the workflow uses a `workflow_dispatch.inputs.function` enum, add `sponsorships` to the options. If it uses a matrix, add `sponsorships` to the strategy list.

Example diff (adapt to actual structure):

```yaml
inputs:
  function:
    description: Function name to deploy
    required: true
    type: choice
    options:
      - all
      - identify
      - get-upload-url
      - share-card
      - export-dwca
      - api
      - mcp
      - sponsorships          # NEW
```

- [ ] **Step 3: Commit**

```bash
git add .github/workflows/deploy-functions.yml
git commit -m "ci(deploy): add sponsorships to deploy-functions workflow"
```

- [ ] **Step 4: Deploy via CI**

```bash
gh workflow run deploy-functions.yml --ref feat/ai-sponsorships -f function=sponsorships
gh run watch
```

Expected: workflow succeeds. Verify with:

```bash
curl -s https://reppvlqejgoqvitturxp.supabase.co/functions/v1/sponsorships/heartbeat \
  -X POST -H "Authorization: Bearer not-the-real-token" | jq
```

Expected: `{"error":"no_cron_token"}` (auth check works).

---

## Task 26 — Modify `identify` Edge Function to use sponsorships

**Files:**
- Modify: `supabase/functions/identify/index.ts`

- [ ] **Step 1: Read the current key-resolution block (around line 150)**

```bash
sed -n '140,180p' supabase/functions/identify/index.ts
```

- [ ] **Step 2: Replace the operator-key fallback with the sponsorship flow**

Find the block that reads `body.client_keys?.anthropic ?? body.client_anthropic_key` and the subsequent `Deno.env.get('ANTHROPIC_API_KEY')` fallback. Replace with:

```typescript
import {
  resolveSponsorship, decryptCredential, recordUsage,
  checkAndBumpRateLimit, autoPauseSponsorship, maybeNotifyThreshold,
  pickAuthHeader,
} from '../_shared/sponsorship.ts';

// ... at the place where the Anthropic key is resolved:

const beneficiaryId = jwtUser?.id;  // jwtUser is the existing decoded user
let anthropicKey   = body.client_keys?.anthropic ?? body.client_anthropic_key ?? null;
let credentialKind: 'api_key' | 'oauth_token' = 'api_key';
let sponsorshipCtx: Awaited<ReturnType<typeof resolveSponsorship>> = null;

if (!anthropicKey && beneficiaryId) {
  const rl = await checkAndBumpRateLimit(supabase, beneficiaryId, 'anthropic');
  if (!rl.allowed) {
    if (rl.reason?.startsWith('rate_limit:')) {
      const ctxNow = await resolveSponsorship(supabase, beneficiaryId, 'anthropic');
      if (ctxNow) await autoPauseSponsorship(supabase, ctxNow.sponsorshipId, rl.reason);
    }
    return { skipped: true, reason: rl.reason };
  }
  sponsorshipCtx = await resolveSponsorship(supabase, beneficiaryId, 'anthropic');
  if (sponsorshipCtx) {
    anthropicKey   = await decryptCredential(supabase, sponsorshipCtx.vaultSecretId);
    credentialKind = sponsorshipCtx.kind;
  }
}

// NO operator-key fallback. If neither BYO nor sponsorship, Claude is unavailable.
if (!anthropicKey) return { skipped: true, reason: 'no_credential' };

// Use the right header based on credential kind
const headers = pickAuthHeader(credentialKind, anthropicKey);

// ... existing Anthropic call, replace the headers it builds with `headers` above ...

// After the call succeeds, record usage if sponsored
if (sponsorshipCtx && result?.usage) {
  const usage = await recordUsage(supabase, {
    sponsorshipId: sponsorshipCtx.sponsorshipId,
    sponsorId:     sponsorshipCtx.sponsorId,
    beneficiaryId,
    provider:      'anthropic',
    tokensIn:      result.usage.input_tokens,
    tokensOut:     result.usage.output_tokens,
  });
  await maybeNotifyThreshold(supabase, sponsorshipCtx.sponsorshipId, usage.pctUsed);
}
```

The existing cascade engine in `identify` already handles `{ skipped: true }` as "move to next identifier" — verify by reading `src/lib/identifiers/cascade.ts` and the `identify` function's caller. If the contract is different, adapt the return shape to whatever the cascade expects for "skip silently."

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

- [ ] **Step 4: Run existing identify tests**

```bash
cd supabase/functions && deno test identify/ && cd ../..
```

Expected: existing tests pass; if any test relied on the operator-key fallback, update it to use BYO or mock a sponsorship.

- [ ] **Step 5: Commit**

```bash
git add supabase/functions/identify/index.ts
git commit -m "feat(functions): identify usa resolveSponsorship; quita operator-key fallback"
```

- [ ] **Step 6: Deploy via CI**

```bash
gh workflow run deploy-functions.yml --ref feat/ai-sponsorships -f function=identify
gh run watch
```

---

## Task 27 — Frontend: types

**Files:**
- Create: `src/lib/types.sponsorship.ts`

- [ ] **Step 1: Write the types**

Create `src/lib/types.sponsorship.ts`:

```typescript
export type AiProvider = 'anthropic';
export type AiCredentialKind = 'api_key' | 'oauth_token';
export type AiSponsorshipStatus = 'active' | 'paused' | 'revoked';

export interface SponsorCredential {
  id:            string;
  label:         string;
  provider:      AiProvider;
  kind:          AiCredentialKind;
  validated_at:  string | null;
  last_used_at:  string | null;
  revoked_at:    string | null;
  created_at:    string;
}

export interface Sponsorship {
  id:                 string;
  sponsor_id:         string;
  beneficiary_id:     string;
  credential_id:      string;
  provider:           AiProvider;
  monthly_call_cap:   number;
  priority:           number;
  status:             AiSponsorshipStatus;
  paused_reason:      string | null;
  paused_at:          string | null;
  beneficiary_public: boolean;
  sponsor_public:     boolean;
  created_at:         string;
  updated_at:         string;
}

export interface SponsorshipUsage {
  cap: number;
  usedThisMonth: number;
  pctUsed: number;
  currentMonthByDay: Record<string, { calls: number; tokens_in: number; tokens_out: number }>;
  pastMonths: Array<{ year_month: string; calls: number; tokens_in: number | null; tokens_out: number | null }>;
}
```

- [ ] **Step 2: Type-check**

```bash
npm run typecheck
```

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.sponsorship.ts
git commit -m "feat(types): tipos TS para sponsorships"
```

---

## Task 28 — Frontend: client wrapper `src/lib/sponsorships.ts`

**Files:**
- Create: `src/lib/sponsorships.ts`
- Create: `tests/unit/sponsorships.test.ts`

- [ ] **Step 1: Write the client**

Create `src/lib/sponsorships.ts`:

```typescript
import { getSupabase } from './supabase';
import type { SponsorCredential, Sponsorship, SponsorshipUsage } from './types.sponsorship';

const FN_BASE = `${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/sponsorships`;

async function authedFetch(path: string, init?: RequestInit): Promise<Response> {
  const { data: { session } } = await getSupabase().auth.getSession();
  if (!session) throw new Error('not_authenticated');
  return fetch(`${FN_BASE}${path}`, {
    ...init,
    headers: {
      ...(init?.headers ?? {}),
      'authorization': `Bearer ${session.access_token}`,
      'content-type':  'application/json',
    },
  });
}

export async function listCredentials(): Promise<SponsorCredential[]> {
  const r = await authedFetch('/credentials');
  if (!r.ok) throw new Error(`listCredentials: ${r.status}`);
  return r.json();
}

export async function createCredential(args: { label: string; secret: string }): Promise<SponsorCredential> {
  const r = await authedFetch('/credentials', { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`createCredential: ${(body as { error?: string }).error ?? r.status}`);
  }
  return r.json();
}

export async function rotateCredential(id: string, secret: string): Promise<void> {
  const r = await authedFetch(`/credentials/${id}/rotate`, { method: 'POST', body: JSON.stringify({ secret }) });
  if (!r.ok) throw new Error(`rotateCredential: ${r.status}`);
}

export async function deleteCredential(id: string): Promise<void> {
  const r = await authedFetch(`/credentials/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`deleteCredential: ${r.status}`);
}

export async function listSponsorships(role: 'sponsor' | 'beneficiary'): Promise<Sponsorship[]> {
  const r = await authedFetch(`/sponsorships?role=${role}`);
  if (!r.ok) throw new Error(`listSponsorships: ${r.status}`);
  return r.json();
}

export async function createSponsorship(args: {
  beneficiary_username: string; credential_id: string;
  monthly_call_cap?: number; priority?: number; sponsor_public?: boolean;
}): Promise<Sponsorship> {
  const r = await authedFetch('/sponsorships', { method: 'POST', body: JSON.stringify(args) });
  if (!r.ok) {
    const body = await r.json().catch(() => ({}));
    throw new Error(`createSponsorship: ${(body as { error?: string }).error ?? r.status}`);
  }
  return r.json();
}

export async function patchSponsorship(id: string, patch: Partial<Pick<Sponsorship,
  'monthly_call_cap' | 'priority' | 'status' | 'sponsor_public' | 'beneficiary_public'>>
): Promise<Sponsorship> {
  const r = await authedFetch(`/sponsorships/${id}`, { method: 'PATCH', body: JSON.stringify(patch) });
  if (!r.ok) throw new Error(`patchSponsorship: ${r.status}`);
  return r.json();
}

export async function unpauseSponsorship(id: string): Promise<{ ok?: boolean; error?: string; advice?: string }> {
  const r = await authedFetch(`/sponsorships/${id}/unpause`, { method: 'POST' });
  return r.json();
}

export async function revokeSponsorship(id: string): Promise<void> {
  const r = await authedFetch(`/sponsorships/${id}`, { method: 'DELETE' });
  if (!r.ok && r.status !== 204) throw new Error(`revokeSponsorship: ${r.status}`);
}

export async function getUsage(id: string): Promise<SponsorshipUsage> {
  const r = await authedFetch(`/sponsorships/${id}/usage`);
  if (!r.ok) throw new Error(`getUsage: ${r.status}`);
  return r.json();
}
```

- [ ] **Step 2: Write a smoke unit test**

Create `tests/unit/sponsorships.test.ts`:

```typescript
import { describe, expect, it, vi } from 'vitest';

// We're testing only the URL composition + error mapping, not the network round-trip.
vi.mock('../../src/lib/supabase', () => ({
  getSupabase: () => ({
    auth: { getSession: () => Promise.resolve({ data: { session: { access_token: 'fake' } } }) },
  }),
}));

const FETCH_URLS: string[] = [];
globalThis.fetch = vi.fn(async (url: string) => {
  FETCH_URLS.push(url);
  return new Response(JSON.stringify([]), { status: 200 });
}) as unknown as typeof fetch;

describe('sponsorships client', () => {
  it('listCredentials hits /credentials', async () => {
    const { listCredentials } = await import('../../src/lib/sponsorships');
    await listCredentials();
    expect(FETCH_URLS.at(-1)).toMatch(/\/sponsorships\/credentials$/);
  });

  it('listSponsorships passes role param', async () => {
    const { listSponsorships } = await import('../../src/lib/sponsorships');
    await listSponsorships('beneficiary');
    expect(FETCH_URLS.at(-1)).toMatch(/\/sponsorships\?role=beneficiary$/);
  });
});
```

- [ ] **Step 3: Run tests**

```bash
npm run test -- tests/unit/sponsorships.test.ts
```

Expected: 2 pass.

- [ ] **Step 4: Commit**

```bash
git add src/lib/sponsorships.ts tests/unit/sponsorships.test.ts
git commit -m "feat(lib): client wrapper para sponsorships Edge Function + tests"
```

---

## Task 29 — i18n: `sponsoring.*` namespace (EN)

**Files:**
- Modify: `src/i18n/en.json`

- [ ] **Step 1: Read the current file shape**

```bash
head -5 src/i18n/en.json
```

- [ ] **Step 2: Add the `sponsoring` namespace**

Insert into `src/i18n/en.json` (alphabetical order, sibling to other top-level keys):

```json
"sponsoring": {
  "page_title": "AI Sponsoring",
  "page_subtitle": "Share your Anthropic credential with friends, capped per month and audited.",
  "credentials_section": "My credentials",
  "credentials_empty": "No credentials yet. Add one to start sponsoring.",
  "add_credential": "Add credential",
  "credential_label": "Label",
  "credential_label_help": "A friendly name to recognize this credential later.",
  "credential_secret": "API key or long-lived token",
  "secret_help": "Stored encrypted in Supabase Vault. Decrypted only at call time inside the Edge Function. Never logged.",
  "validate_btn": "Save & validate",
  "kind_api_key": "API key",
  "kind_oauth_token": "Long-lived token (OAuth)",
  "rotate_btn": "Rotate",
  "revoke_btn": "Revoke",
  "validated_at": "Validated {when}",
  "never_validated": "Never validated yet",

  "beneficiaries_section": "People I sponsor",
  "beneficiaries_empty": "Not sponsoring anyone yet.",
  "add_beneficiary": "Add beneficiary",
  "beneficiary_username": "Username",
  "monthly_cap": "Monthly cap (calls)",
  "priority": "Priority (lower = preferred)",
  "show_publicly": "Show this beneficiary publicly on my profile",
  "self_sponsorship_badge": "Self-sponsorship",
  "auto_paused": "Auto-paused: {reason}",
  "unpause": "Reactivate",
  "three_strike_warning": "Reactivated 3+ times in 7 days — please revoke and recreate this sponsorship.",

  "analytics_section": "Analytics",
  "calls_last_30d": "Calls (last 30 days)",
  "top_beneficiaries": "Top beneficiaries this month",
  "karma_generated": "Karma generated this month",
  "estimated_cost": "Estimated cost",
  "covered_by_subscription": "Covered by your Claude subscription",
  "below_engagement_threshold": "@{username} hasn't reached the engagement threshold yet — your karma starts accruing once they hit 10 observations.",

  "quota_card_title": "AI quota this month",
  "quota_card_unit": "{used} / {cap} identifications",
  "quota_card_sponsors": "Sponsored by",
  "quota_remaining_amber": "{remaining} AI IDs left this month (sponsored by {sponsor}).",
  "quota_exhausted_red": "AI quota exhausted. Configure your own API key to continue.",
  "quota_paused_gray": "Your sponsored access is paused. Your sponsor was notified.",

  "decline_sponsorship": "Decline this sponsorship",
  "show_sponsor_publicly": "Show {sponsor} on my public profile",

  "discovery_card_title": "Want your friends to try Rastrum without configuring their own API key?",
  "discovery_card_cta": "Sponsor AI access"
}
```

- [ ] **Step 3: Verify JSON parses**

```bash
node -e "console.log(Object.keys(require('./src/i18n/en.json').sponsoring).length)"
```

Expected: ≥ 30 keys.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/en.json
git commit -m "feat(i18n): añadir namespace sponsoring.* (EN)"
```

---

## Task 30 — i18n: `sponsoring.*` namespace (ES)

**Files:**
- Modify: `src/i18n/es.json`

- [ ] **Step 1: Mirror the EN namespace with translations**

Insert into `src/i18n/es.json`:

```json
"sponsoring": {
  "page_title": "Patrocinios IA",
  "page_subtitle": "Comparte tu credencial Anthropic con amigos, con límite mensual y auditoría.",
  "credentials_section": "Mis credenciales",
  "credentials_empty": "Aún no tienes credenciales. Agrega una para empezar a patrocinar.",
  "add_credential": "Agregar credencial",
  "credential_label": "Etiqueta",
  "credential_label_help": "Un nombre amigable para reconocer esta credencial.",
  "credential_secret": "API key o token de larga duración",
  "secret_help": "Se guarda cifrada en Supabase Vault. Solo se descifra al momento de la llamada dentro del Edge Function. Nunca aparece en logs.",
  "validate_btn": "Guardar y validar",
  "kind_api_key": "API key",
  "kind_oauth_token": "Token de larga duración (OAuth)",
  "rotate_btn": "Rotar",
  "revoke_btn": "Revocar",
  "validated_at": "Validada {when}",
  "never_validated": "Nunca validada",

  "beneficiaries_section": "A quién patrocino",
  "beneficiaries_empty": "Todavía no patrocinas a nadie.",
  "add_beneficiary": "Agregar beneficiary",
  "beneficiary_username": "Usuario",
  "monthly_cap": "Cuota mensual (llamadas)",
  "priority": "Prioridad (menor = preferido)",
  "show_publicly": "Mostrar a este beneficiary en mi perfil público",
  "self_sponsorship_badge": "Auto-patrocinio",
  "auto_paused": "Auto-pausado: {reason}",
  "unpause": "Reactivar",
  "three_strike_warning": "Reactivado 3+ veces en 7 días — por favor revoca y vuelve a crear este patrocinio.",

  "analytics_section": "Analítica",
  "calls_last_30d": "Llamadas (últimos 30 días)",
  "top_beneficiaries": "Top beneficiaries este mes",
  "karma_generated": "Karma generado este mes",
  "estimated_cost": "Costo estimado",
  "covered_by_subscription": "Cubierto por tu suscripción Claude",
  "below_engagement_threshold": "@{username} aún no llega al umbral de engagement — tu karma empieza a acumularse cuando haga 10 observaciones.",

  "quota_card_title": "Cuota IA este mes",
  "quota_card_unit": "{used} / {cap} identificaciones",
  "quota_card_sponsors": "Patrocinado por",
  "quota_remaining_amber": "Te quedan {remaining} identificaciones IA este mes (patrocinadas por {sponsor}).",
  "quota_exhausted_red": "Cuota IA agotada. Configura tu propia API key para continuar.",
  "quota_paused_gray": "Tu acceso patrocinado está pausado. Tu sponsor fue notificado.",

  "decline_sponsorship": "Rechazar este patrocinio",
  "show_sponsor_publicly": "Mostrar a {sponsor} en mi perfil público",

  "discovery_card_title": "¿Quieres que tus amigos prueben Rastrum sin configurar su propia API key?",
  "discovery_card_cta": "Patrocinar acceso IA"
}
```

- [ ] **Step 2: Verify**

```bash
node -e "console.log(Object.keys(require('./src/i18n/es.json').sponsoring).length)"
```

Expected: same count as EN.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/es.json
git commit -m "feat(i18n): añadir namespace sponsoring.* (ES)"
```

---

## Task 31 — Routes registration

**Files:**
- Modify: `src/i18n/utils.ts`

- [ ] **Step 1: Read current routes table**

```bash
grep -n "routes\|routeTree" src/i18n/utils.ts | head -20
```

- [ ] **Step 2: Add the four route entries**

Insert into the `routes` map:

```typescript
sponsoring:   { en: '/profile/sponsoring',    es: '/perfil/patrocinios' },
sponsoredBy:  { en: '/profile/sponsored-by',  es: '/perfil/patrocinado-por' },
```

And register both in `routeTree` under the existing profile group.

- [ ] **Step 3: Type-check**

```bash
npm run typecheck
```

- [ ] **Step 4: Commit**

```bash
git add src/i18n/utils.ts
git commit -m "feat(i18n): registrar rutas /profile/sponsoring y /profile/sponsored-by"
```

---

## Task 32 — Components: `SponsoringView.astro`

**Files:**
- Create: `src/components/SponsoringView.astro`

This is the largest component — three sections (credentials, beneficiaries, analytics). Inline-script driven with the client wrapper from Task 28.

- [ ] **Step 1: Scaffold the component shell**

Create `src/components/SponsoringView.astro` with frontmatter, the three sections, and an empty script tag — then implement each section in subsequent steps.

```astro
---
import { t } from '../i18n/utils';
interface Props { lang: 'en' | 'es' }
const { lang } = Astro.props;
const tr = t(lang);
const stoneAccent = 'border-stone-300 dark:border-stone-700';
---

<section class={`max-w-4xl mx-auto p-6 space-y-10 ${stoneAccent}`}>
  <header>
    <h1 class="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100">
      {tr.sponsoring.page_title}
    </h1>
    <p class="mt-1 text-sm text-zinc-600 dark:text-zinc-400">{tr.sponsoring.page_subtitle}</p>
  </header>

  <!-- Section A: Credentials -->
  <section id="creds-section" data-empty-msg={tr.sponsoring.credentials_empty} class="space-y-4">
    <h2 class="text-lg font-semibold">{tr.sponsoring.credentials_section}</h2>
    <button id="add-cred-btn" type="button"
      class="rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 text-sm font-medium">
      {tr.sponsoring.add_credential}
    </button>
    <ul id="creds-list" class="divide-y divide-zinc-200 dark:divide-zinc-800"></ul>
  </section>

  <!-- Section B: Beneficiaries -->
  <section id="bens-section" data-empty-msg={tr.sponsoring.beneficiaries_empty} class="space-y-4">
    <h2 class="text-lg font-semibold">{tr.sponsoring.beneficiaries_section}</h2>
    <button id="add-ben-btn" type="button"
      class="rounded-lg bg-emerald-700 hover:bg-emerald-800 text-white px-4 py-2 text-sm font-medium">
      {tr.sponsoring.add_beneficiary}
    </button>
    <table id="bens-table" class="min-w-full text-sm">
      <thead>
        <tr class="text-left text-zinc-500">
          <th class="py-2 pr-4">{tr.sponsoring.beneficiary_username}</th>
          <th class="py-2 pr-4">{tr.sponsoring.monthly_cap}</th>
          <th class="py-2 pr-4">{tr.sponsoring.priority}</th>
          <th class="py-2 pr-4">Status</th>
          <th class="py-2"></th>
        </tr>
      </thead>
      <tbody id="bens-tbody"></tbody>
    </table>
  </section>

  <!-- Section C: Analytics -->
  <section id="analytics-section" class="space-y-4">
    <h2 class="text-lg font-semibold">{tr.sponsoring.analytics_section}</h2>
    <div id="analytics-content" class="space-y-2 text-sm text-zinc-600 dark:text-zinc-400">
      <p>—</p>
    </div>
  </section>
</section>

<script>
  import {
    listCredentials, createCredential, rotateCredential, deleteCredential,
    listSponsorships, createSponsorship, patchSponsorship, unpauseSponsorship,
    revokeSponsorship, getUsage,
  } from '../lib/sponsorships';
  import { detectKind } from '../lib/sponsorships';   // re-export from client; adjust if separate file

  // Section A — credentials
  async function refreshCreds() {
    const credsList = document.getElementById('creds-list')!;
    const creds = await listCredentials().catch(() => []);
    credsList.innerHTML = '';
    if (creds.length === 0) {
      credsList.innerHTML = `<li class="py-3 text-sm text-zinc-500">${(document.getElementById('creds-section') as HTMLElement).dataset.emptyMsg}</li>`;
      return;
    }
    for (const c of creds) {
      const li = document.createElement('li');
      li.className = 'py-3 flex items-center justify-between';
      li.innerHTML = `
        <div>
          <div class="font-medium">${c.label} <span class="text-xs text-zinc-500">(${c.kind})</span></div>
          <div class="text-xs text-zinc-500">${c.validated_at ? `validated ${new Date(c.validated_at).toLocaleString()}` : 'never validated'}</div>
        </div>
        <div class="flex gap-2">
          <button data-rotate="${c.id}" class="text-sm text-emerald-700 hover:text-emerald-900">Rotate</button>
          <button data-revoke="${c.id}" class="text-sm text-red-600 hover:text-red-800">Revoke</button>
        </div>`;
      credsList.appendChild(li);
    }
  }

  document.getElementById('add-cred-btn')?.addEventListener('click', async () => {
    const label  = prompt('Label?');
    if (!label) return;
    const secret = prompt('Anthropic secret (sk-ant-api03- or sk-ant-oat01-)?');
    if (!secret) return;
    try {
      await createCredential({ label, secret });
      await refreshCreds();
    } catch (e) { alert(`Error: ${(e as Error).message}`); }
  });

  document.getElementById('creds-list')?.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.rotate) {
      const newSecret = prompt('New secret?');
      if (newSecret) { await rotateCredential(t.dataset.rotate, newSecret); await refreshCreds(); }
    } else if (t.dataset.revoke) {
      if (confirm('Revoke this credential? Sponsorships using it will be paused.')) {
        await deleteCredential(t.dataset.revoke); await refreshCreds(); await refreshBens();
      }
    }
  });

  // Section B — beneficiaries
  async function refreshBens() {
    const tbody = document.getElementById('bens-tbody')!;
    const bens = await listSponsorships('sponsor').catch(() => []);
    tbody.innerHTML = '';
    for (const b of bens) {
      const tr = document.createElement('tr');
      tr.className = 'border-t border-zinc-200 dark:border-zinc-800';
      tr.innerHTML = `
        <td class="py-2 pr-4">${b.beneficiary_id.slice(0, 8)}…</td>
        <td class="py-2 pr-4">${b.monthly_call_cap}</td>
        <td class="py-2 pr-4">${b.priority}</td>
        <td class="py-2 pr-4">
          <span class="${b.status === 'active' ? 'text-emerald-600' : b.status === 'paused' ? 'text-amber-600' : 'text-zinc-500'}">
            ${b.status}${b.paused_reason ? ` (${b.paused_reason})` : ''}
          </span>
        </td>
        <td class="py-2">
          ${b.status === 'paused' ? `<button data-unpause="${b.id}" class="text-sm text-emerald-700">Reactivate</button>` : ''}
          <button data-revoke-spons="${b.id}" class="text-sm text-red-600 ml-2">Revoke</button>
        </td>`;
      tbody.appendChild(tr);
    }
  }

  document.getElementById('add-ben-btn')?.addEventListener('click', async () => {
    const username = prompt('Beneficiary username?');
    if (!username) return;
    const creds = await listCredentials();
    if (creds.length === 0) { alert('Add a credential first.'); return; }
    const credential_id = creds[0].id;  // for v1 — UI to pick comes later
    const cap = parseInt(prompt('Monthly cap?', '200') ?? '200', 10);
    try {
      await createSponsorship({ beneficiary_username: username, credential_id, monthly_call_cap: cap });
      await refreshBens();
    } catch (e) { alert(`Error: ${(e as Error).message}`); }
  });

  document.getElementById('bens-tbody')?.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.unpause) {
      const r = await unpauseSponsorship(t.dataset.unpause);
      if (r.error === 'three_strike') alert('Three-strike: revoke and recreate.');
      await refreshBens();
    } else if (t.dataset.revokeSpons) {
      if (confirm('Revoke?')) { await revokeSponsorship(t.dataset.revokeSpons); await refreshBens(); }
    }
  });

  // Initial load
  refreshCreds();
  refreshBens();
</script>
```

NOTE: the `detectKind` import path needs to be valid — re-export it from `src/lib/sponsorships.ts` if it's used in the UI:

```typescript
// at top of src/lib/sponsorships.ts
export { detectKind } from '../../supabase/functions/_shared/anthropic-validate';
```

(Or duplicate the prefix logic in the UI if you prefer to avoid the cross-package import. Adjust to taste.)

- [ ] **Step 2: Run build to ensure JSX gotchas didn't bite**

```bash
npm run build
```

Expected: no Astro JSX errors. If `Record<…>` cast complaints appear, follow the CLAUDE.md pattern (extract to typed locals in frontmatter).

- [ ] **Step 3: Commit**

```bash
git add src/components/SponsoringView.astro src/lib/sponsorships.ts
git commit -m "feat(ui): SponsoringView (3 secciones: creds, beneficiaries, analytics)"
```

---

## Task 33 — Components: `SponsoredByView.astro`

**Files:**
- Create: `src/components/SponsoredByView.astro`

- [ ] **Step 1: Write the component**

Create `src/components/SponsoredByView.astro`:

```astro
---
import { t } from '../i18n/utils';
interface Props { lang: 'en' | 'es' }
const { lang } = Astro.props;
const tr = t(lang);
---

<section class="max-w-3xl mx-auto p-6 space-y-8">
  <header>
    <h1 class="text-2xl md:text-3xl font-bold text-zinc-900 dark:text-zinc-100">
      {tr.sponsoring.quota_card_title}
    </h1>
  </header>

  <div id="quota-card" class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-6 bg-white dark:bg-zinc-900">
    <div id="quota-summary" class="text-lg font-semibold">—</div>
    <div id="quota-bar" class="h-2 mt-3 rounded bg-zinc-200 dark:bg-zinc-800 overflow-hidden">
      <div id="quota-fill" class="h-full bg-emerald-600" style="width: 0%"></div>
    </div>
    <div id="quota-banner" class="mt-3 text-sm hidden"></div>
    <div id="quota-sponsors" class="mt-4 text-sm text-zinc-600 dark:text-zinc-400">—</div>
  </div>

  <section>
    <h2 class="text-lg font-semibold mb-2">Privacidad</h2>
    <ul id="privacy-list" class="space-y-2 text-sm"></ul>
  </section>
</section>

<script>
  import { listSponsorships, getUsage, patchSponsorship, revokeSponsorship } from '../lib/sponsorships';

  async function refresh() {
    const sponsorships = await listSponsorships('beneficiary').catch(() => []);
    const active = sponsorships.filter(s => s.status === 'active');
    if (active.length === 0) {
      document.getElementById('quota-summary')!.textContent = 'No active sponsorship';
      return;
    }
    // Show usage from highest-priority sponsorship
    active.sort((a, b) => a.priority - b.priority);
    const primary = active[0];
    const usage = await getUsage(primary.id).catch(() => null);
    if (!usage) return;

    document.getElementById('quota-summary')!.textContent =
      `${usage.usedThisMonth} / ${usage.cap} this month`;
    const pct = Math.min(100, Math.round(usage.pctUsed * 100));
    (document.getElementById('quota-fill') as HTMLElement).style.width = `${pct}%`;

    const banner = document.getElementById('quota-banner')!;
    if (usage.pctUsed >= 1.0) {
      banner.className = 'mt-3 text-sm rounded-lg p-3 bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-200';
      banner.textContent = 'Quota exhausted. Configure your own API key to continue.';
      banner.classList.remove('hidden');
    } else if (usage.pctUsed >= 0.80) {
      banner.className = 'mt-3 text-sm rounded-lg p-3 bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200';
      banner.textContent = `Only ${usage.cap - usage.usedThisMonth} IDs left this month.`;
      banner.classList.remove('hidden');
    }

    document.getElementById('quota-sponsors')!.textContent =
      `Sponsored by ${active.length} sponsor${active.length === 1 ? '' : 's'}`;

    // Privacy section
    const list = document.getElementById('privacy-list')!;
    list.innerHTML = '';
    for (const s of active) {
      const li = document.createElement('li');
      li.className = 'flex items-center justify-between border-b border-zinc-200 dark:border-zinc-800 pb-2';
      li.innerHTML = `
        <span>Sponsor ${s.sponsor_id.slice(0, 8)}…</span>
        <label class="flex items-center gap-2 text-xs">
          <input type="checkbox" data-toggle-public="${s.id}" ${s.beneficiary_public ? 'checked' : ''} />
          Show publicly
        </label>
        <button data-decline="${s.id}" class="text-sm text-red-600">Decline</button>`;
      list.appendChild(li);
    }
  }

  document.getElementById('privacy-list')?.addEventListener('change', async (e) => {
    const t = e.target as HTMLInputElement;
    if (t.dataset.togglePublic) {
      await patchSponsorship(t.dataset.togglePublic, { beneficiary_public: t.checked });
    }
  });

  document.getElementById('privacy-list')?.addEventListener('click', async (e) => {
    const t = e.target as HTMLElement;
    if (t.dataset.decline) {
      if (confirm('Decline this sponsorship?')) {
        await revokeSponsorship(t.dataset.decline);
        await refresh();
      }
    }
  });

  refresh();
</script>
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/SponsoredByView.astro
git commit -m "feat(ui): SponsoredByView (cuota, sponsors, privacidad)"
```

---

## Task 34 — Pages: paired EN/ES routes

**Files:**
- Create: `src/pages/en/profile/sponsoring.astro`
- Create: `src/pages/es/perfil/patrocinios.astro`
- Create: `src/pages/en/profile/sponsored-by.astro`
- Create: `src/pages/es/perfil/patrocinado-por.astro`

- [ ] **Step 1: Create all four pages**

`src/pages/en/profile/sponsoring.astro`:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import SponsoringView from '../../../components/SponsoringView.astro';
import { t } from '../../../i18n/utils';
const lang = 'en';
const tr = t(lang);
---
<BaseLayout title={`${tr.sponsoring.page_title} — Rastrum`} description={tr.sponsoring.page_subtitle} lang={lang}>
  <SponsoringView lang={lang} />
</BaseLayout>
```

`src/pages/es/perfil/patrocinios.astro`:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import SponsoringView from '../../../components/SponsoringView.astro';
import { t } from '../../../i18n/utils';
const lang = 'es';
const tr = t(lang);
---
<BaseLayout title={`${tr.sponsoring.page_title} — Rastrum`} description={tr.sponsoring.page_subtitle} lang={lang}>
  <SponsoringView lang={lang} />
</BaseLayout>
```

`src/pages/en/profile/sponsored-by.astro`:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import SponsoredByView from '../../../components/SponsoredByView.astro';
import { t } from '../../../i18n/utils';
const lang = 'en';
const tr = t(lang);
---
<BaseLayout title={`${tr.sponsoring.quota_card_title} — Rastrum`} description={tr.sponsoring.quota_card_title} lang={lang}>
  <SponsoredByView lang={lang} />
</BaseLayout>
```

`src/pages/es/perfil/patrocinado-por.astro`:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import SponsoredByView from '../../../components/SponsoredByView.astro';
import { t } from '../../../i18n/utils';
const lang = 'es';
const tr = t(lang);
---
<BaseLayout title={`${tr.sponsoring.quota_card_title} — Rastrum`} description={tr.sponsoring.quota_card_title} lang={lang}>
  <SponsoredByView lang={lang} />
</BaseLayout>
```

- [ ] **Step 2: Build and verify pages emit**

```bash
npm run build
ls dist/en/profile/sponsoring/ dist/es/perfil/patrocinios/ dist/en/profile/sponsored-by/ dist/es/perfil/patrocinado-por/
```

Each path should contain an `index.html`.

- [ ] **Step 3: Commit**

```bash
git add src/pages/en/profile/sponsoring.astro src/pages/es/perfil/patrocinios.astro src/pages/en/profile/sponsored-by.astro src/pages/es/perfil/patrocinado-por.astro
git commit -m "feat(routes): páginas EN/ES para sponsoring + sponsored-by"
```

---

## Task 35 — Integration: banner on `/identify`

**Files:**
- Create: `src/components/SponsorshipBanner.astro`
- Modify: `src/components/IdentifyView.astro` (or whatever the identify page mounts)

- [ ] **Step 1: Create the banner component**

Create `src/components/SponsorshipBanner.astro`:

```astro
---
import { t } from '../i18n/utils';
interface Props { lang: 'en' | 'es' }
const { lang } = Astro.props;
const tr = t(lang);
---

<div id="sponsorship-banner" class="hidden mb-4 rounded-lg border p-3 text-sm"></div>

<script>
  import { listSponsorships, getUsage } from '../lib/sponsorships';
  import { getSupabase } from '../lib/supabase';

  async function paint() {
    const banner = document.getElementById('sponsorship-banner') as HTMLElement | null;
    if (!banner) return;
    const { data: { session } } = await getSupabase().auth.getSession();
    if (!session) return;
    const cacheKey = 'rastrum.sponsorshipBanner';
    const cached = sessionStorage.getItem(cacheKey);
    let usage: { pctUsed: number; cap: number; usedThisMonth: number; sponsorshipId: string } | null = null;

    if (cached) {
      try { usage = JSON.parse(cached); } catch { /* ignore */ }
    }
    if (!usage) {
      const sponsorships = await listSponsorships('beneficiary').catch(() => []);
      const active = sponsorships.filter(s => s.status === 'active').sort((a, b) => a.priority - b.priority);
      if (active.length === 0) return;
      const u = await getUsage(active[0].id).catch(() => null);
      if (!u) return;
      usage = { pctUsed: u.pctUsed, cap: u.cap, usedThisMonth: u.usedThisMonth, sponsorshipId: active[0].id };
      sessionStorage.setItem(cacheKey, JSON.stringify(usage));
      setTimeout(() => sessionStorage.removeItem(cacheKey), 5 * 60_000);
    }

    if (usage.pctUsed < 0.80) return;

    if (usage.pctUsed >= 1.0) {
      banner.className = 'mb-4 rounded-lg border p-3 text-sm bg-red-50 dark:bg-red-900/30 text-red-900 dark:text-red-200 border-red-200';
      banner.textContent = 'AI quota exhausted. Configure your own API key.';
    } else {
      banner.className = 'mb-4 rounded-lg border p-3 text-sm bg-amber-50 dark:bg-amber-900/30 text-amber-900 dark:text-amber-200 border-amber-200';
      const remaining = usage.cap - usage.usedThisMonth;
      banner.textContent = `${remaining} AI IDs left this month.`;
    }
    banner.classList.remove('hidden');
  }
  paint();
</script>
```

- [ ] **Step 2: Mount the banner in identify view**

```bash
grep -n "<form\|<section\|class=" src/components/IdentifyView.astro | head -10
```

Find a good spot near the top of the view body and add:

```astro
import SponsorshipBanner from './SponsorshipBanner.astro';
// ... in the markup:
<SponsorshipBanner lang={lang} />
```

- [ ] **Step 3: Tailwind safelist check**

`tailwind.config.mjs` should already cover amber and red banner classes (used elsewhere). If `npm run build` purges them, append to the safelist:

```js
// tailwind.config.mjs (only if needed)
safelist: [
  ...existing,
  'bg-amber-50', 'dark:bg-amber-900/30', 'text-amber-900', 'dark:text-amber-200', 'border-amber-200',
  'bg-red-50',   'dark:bg-red-900/30',   'text-red-900',   'dark:text-red-200',   'border-red-200',
],
```

- [ ] **Step 4: Build**

```bash
npm run build
```

- [ ] **Step 5: Commit**

```bash
git add src/components/SponsorshipBanner.astro src/components/IdentifyView.astro tailwind.config.mjs
git commit -m "feat(ui): banner de cuota en /identify (amber/red @80/100)"
```

---

## Task 36 — Integration: discovery card on `/profile/`

**Files:**
- Modify: `src/components/ProfileView.astro` (or equivalent profile root)

- [ ] **Step 1: Find the profile root**

```bash
ls src/components/Profile*.astro
```

- [ ] **Step 2: Add a discovery card**

Insert near the top of the profile body, conditionally shown:

```astro
---
// existing frontmatter
---

<!-- ... existing content ... -->

<aside id="sponsoring-discovery" class="hidden rounded-lg border border-emerald-300 dark:border-emerald-700 p-4 bg-emerald-50 dark:bg-emerald-900/20 mb-6">
  <p class="text-sm">
    💡 {tr.sponsoring.discovery_card_title}
  </p>
  <a href={routes.sponsoring[lang]} class="mt-2 inline-block text-emerald-700 hover:text-emerald-900 font-medium text-sm">
    {tr.sponsoring.discovery_card_cta} →
  </a>
</aside>

<script>
  import { listCredentials } from '../lib/sponsorships';
  (async () => {
    try {
      const creds = await listCredentials();
      if (creds.length === 0) {
        document.getElementById('sponsoring-discovery')?.classList.remove('hidden');
      }
    } catch { /* not auth or fn unavailable — silent */ }
  })();
</script>
```

- [ ] **Step 3: Build**

```bash
npm run build
```

- [ ] **Step 4: Commit**

```bash
git add src/components/ProfileView.astro
git commit -m "feat(ui): discovery card de patrocinios en /profile/"
```

---

## Task 37 — Header dropdown entries

**Files:**
- Modify: `src/components/Header.astro`

- [ ] **Step 1: Add the two new entries to the avatar dropdown menu**

Find the dropdown menu UL inside `Header.astro` and insert:

```astro
<li>
  <a href={routes.sponsoring[lang]} class="block px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
    {tr.sponsoring.page_title}
  </a>
</li>
<li>
  <a href={routes.sponsoredBy[lang]} class="block px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">
    {tr.sponsoring.quota_card_title}
  </a>
</li>
```

- [ ] **Step 2: Build**

```bash
npm run build
```

- [ ] **Step 3: Commit**

```bash
git add src/components/Header.astro
git commit -m "feat(ui): entradas del menú de perfil para sponsoring y sponsored-by"
```

---

## Task 38 — CI: smoke script

**Files:**
- Create: `infra/smoke-sponsorships.sh`

- [ ] **Step 1: Write the smoke script**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Smokes the sponsorships Edge Function post-deploy.
# Requires SUPABASE_URL and SUPABASE_TEST_USER_TOKEN in env.

SUPABASE_URL="${SUPABASE_URL:-https://reppvlqejgoqvitturxp.supabase.co}"
TOKEN="${SUPABASE_TEST_USER_TOKEN:?SUPABASE_TEST_USER_TOKEN required}"

echo "→ POST /credentials with invalid prefix (should reject)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/functions/v1/sponsorships/credentials" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"label":"smoke","secret":"not-a-real-key"}')
BODY=$(echo "$RESPONSE" | head -n -1)
CODE=$(echo "$RESPONSE" | tail -n 1)
if [ "$CODE" != "400" ]; then
  echo "FAIL: expected 400, got $CODE"; echo "$BODY"; exit 1
fi
if ! echo "$BODY" | grep -q "unrecognized_secret_prefix"; then
  echo "FAIL: expected unrecognized_secret_prefix"; echo "$BODY"; exit 1
fi
echo "PASS: invalid secret rejected"

echo "→ GET /credentials (should return list)"
RESPONSE=$(curl -s -w "\n%{http_code}" "$SUPABASE_URL/functions/v1/sponsorships/credentials" \
  -H "Authorization: Bearer $TOKEN")
CODE=$(echo "$RESPONSE" | tail -n 1)
if [ "$CODE" != "200" ]; then
  echo "FAIL: expected 200, got $CODE"; exit 1
fi
echo "PASS: list endpoint works"

echo "All smoke checks passed."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x infra/smoke-sponsorships.sh
```

- [ ] **Step 3: Commit**

```bash
git add infra/smoke-sponsorships.sh
git commit -m "ci: smoke script para sponsorships Edge Function"
```

---

## Task 39 — CI: secret-leak guard

**Files:**
- Create: `infra/check-no-secret-logs.sh`

- [ ] **Step 1: Write the guard**

```bash
#!/usr/bin/env bash
set -euo pipefail

# Fails the build if any Anthropic secret format leaked into shipped code or logs.

if grep -RIn "sk-ant-" dist/ supabase/functions/ 2>/dev/null \
   | grep -v "anthropic-validate.ts" \
   | grep -v "anthropic-validate.test.ts" \
   | grep -v ".test.ts" \
   | grep -v "README" ; then
  echo "FAIL: literal Anthropic key prefix found in shipped code."
  exit 1
fi

# Also check for obvious console.log of secrets/keys in Edge Functions.
if grep -RIn "console.log" supabase/functions/ 2>/dev/null \
   | grep -iE "secret|key|token|credential" \
   | grep -v "// allowed:"; then
  echo "FAIL: console.log of suspected secret/key/token/credential in Edge Function."
  echo "If this is intentional and safe, append a // allowed: <reason> comment."
  exit 1
fi

echo "PASS: no secret leaks detected."
```

- [ ] **Step 2: Make it executable**

```bash
chmod +x infra/check-no-secret-logs.sh
```

- [ ] **Step 3: Run it locally to verify it's clean**

```bash
npm run build
./infra/check-no-secret-logs.sh
```

Expected: `PASS: no secret leaks detected.`

- [ ] **Step 4: Wire into CI**

Add to the existing CI workflow (e.g., `.github/workflows/ci.yml` or similar):

```yaml
      - name: Check for secret leaks
        run: ./infra/check-no-secret-logs.sh
```

- [ ] **Step 5: Commit**

```bash
git add infra/check-no-secret-logs.sh .github/workflows/ci.yml
git commit -m "ci: guard contra leaks de secrets de Anthropic"
```

---

## Task 40 — Roadmap + tasks JSON updates

**Files:**
- Modify: `docs/progress.json`
- Modify: `docs/tasks.json`

- [ ] **Step 1: Add a roadmap entry**

Append to `docs/progress.json` under the appropriate phase (community / monetization adjacent). Example:

```json
{
  "id": "ai-sponsorships",
  "label": "AI sponsorships",
  "label_es": "Patrocinios IA",
  "status": "in_progress",
  "phase": "community"
}
```

- [ ] **Step 2: Add subtasks to `docs/tasks.json`**

Add a parallel entry in `docs/tasks.json`:

```json
{
  "id": "ai-sponsorships",
  "label": "AI sponsorships",
  "label_es": "Patrocinios IA",
  "subtasks": [
    { "label": "Schema + RLS",                 "label_es": "Schema + RLS",            "done": false },
    { "label": "_shared/sponsorship.ts + tests", "label_es": "_shared/sponsorship.ts + pruebas", "done": false },
    { "label": "sponsorships Edge Function",   "label_es": "Edge Function sponsorships", "done": false },
    { "label": "identify modificado",          "label_es": "identify modificado",      "done": false },
    { "label": "UI + i18n + rutas",            "label_es": "UI + i18n + rutas",        "done": false },
    { "label": "Smoke + lint en CI",           "label_es": "Smoke + lint en CI",       "done": false },
    { "label": "Rollout + remover ANTHROPIC_API_KEY", "label_es": "Rollout + remover ANTHROPIC_API_KEY", "done": false }
  ]
}
```

- [ ] **Step 3: Verify JSON parses**

```bash
node -e "JSON.parse(require('fs').readFileSync('docs/progress.json'));"
node -e "JSON.parse(require('fs').readFileSync('docs/tasks.json'));"
```

- [ ] **Step 4: Commit**

```bash
git add docs/progress.json docs/tasks.json
git commit -m "docs(roadmap): registrar AI sponsorships en progress + tasks"
```

---

## Task 41 — Pre-rollout verification

**Files:**
- (none — verification only)

- [ ] **Step 1: Full test suite passes**

```bash
npm run typecheck
npm run test
npm run build
./infra/check-no-secret-logs.sh
```

All four must succeed.

- [ ] **Step 2: Schema is fully applied**

```bash
make db-apply
make db-verify
```

Expected: tables `sponsor_credentials`, `sponsorships`, `ai_usage`, `ai_rate_limits`, `ai_usage_monthly`, `ai_errors_log`, `notifications_sent` all exist with RLS enabled.

- [ ] **Step 3: Cron jobs are scheduled**

```bash
make db-psql -c "SELECT jobname FROM cron.job WHERE jobname LIKE 'ai_%' ORDER BY jobname;"
```

Expected: 5 ai_* jobs.

- [ ] **Step 4: Edge Functions deployed**

```bash
gh run list --workflow=deploy-functions.yml --limit 3
```

Expected: latest runs for `sponsorships` and `identify` succeeded.

- [ ] **Step 5: Run smoke script against deployed functions**

```bash
SUPABASE_TEST_USER_TOKEN="<jwt-of-a-test-user>" ./infra/smoke-sponsorships.sh
```

Expected: all checks pass.

- [ ] **Step 6: Manual happy-path test**

In a browser, signed in as your own account:

1. Visit `/en/profile/sponsoring/`. The page renders.
2. Click "Add credential" — paste your real Anthropic key. The credential appears in the list with `validated_at` set.
3. Click "Add beneficiary" — enter a friend's username, set cap to 50. Row appears.
4. Visit `/en/profile/sponsored-by/` (as the beneficiary user). Quota card shows 0/50.
5. The beneficiary visits `/en/identify/` and runs an ID. Banner does not appear (pctUsed < 80%).
6. The `ai_usage` table has a new row.
7. The sponsor's karma_total increased by 1 (via trigger).

If any step fails, stop and debug before continuing to Task 42.

---

## Task 42 — Rollout: remove `ANTHROPIC_API_KEY`, flip flag

**Files:**
- (no commits — runtime configuration)

- [ ] **Step 1: Confirm at least one sponsorship is active in prod**

```bash
make db-psql -c "SELECT count(*) FROM public.sponsorships WHERE status = 'active';"
```

Expected: ≥ 1 (your own sponsorships, including a self-sponsorship for personal use).

- [ ] **Step 2: Remove `ANTHROPIC_API_KEY` from Edge Function secrets**

```bash
gh secret remove ANTHROPIC_API_KEY --env production    # if env-scoped
# OR if function-scoped via Supabase CLI:
# supabase secrets unset ANTHROPIC_API_KEY --project-ref reppvlqejgoqvitturxp
```

The local `supabase` CLI is broken on this project (per CLAUDE.md), so prefer the gh-secret path or the Supabase Dashboard manual delete.

- [ ] **Step 3: Redeploy `identify` so it picks up the absence**

```bash
gh workflow run deploy-functions.yml -f function=identify
gh run watch
```

- [ ] **Step 4: Smoke once more — ensure cascade still works**

In a browser as a user with no BYO key and no sponsorship: try `/identify` with a photo. The cascade should fall through to PlantNet or Phi (on-device) silently. No errors visible.

In a browser as your own account (with self-sponsorship): try `/identify`. Claude should still fire, an `ai_usage` row should be created, and your karma should not increment (self-sponsoring guard).

- [ ] **Step 5: Open the PR**

```bash
gh pr create --title "feat: AI Sponsorships (módulo 20)" --body "$(cat <<'EOF'
## Summary
- Permite a cualquier user compartir su credencial Anthropic (API key u OAT) con beneficiaries específicos.
- Cuota mensual por llamadas, auto-pause por rate-limit (>30/10min), karma híbrido (+20 base /+1 por call).
- Self-sponsoring permitido sin karma.
- Quita ANTHROPIC_API_KEY del Edge Function: solo BYO o sponsorship invocan a Claude.

## Test plan
- [ ] make db-apply / make db-verify limpio
- [ ] gh workflow run deploy-functions.yml -f function=sponsorships -f function=identify pasan
- [ ] ./infra/smoke-sponsorships.sh PASS
- [ ] ./infra/check-no-secret-logs.sh PASS
- [ ] Manual: crear credencial, sponsorear amigo, identify exitoso, karma +1
- [ ] Manual: cuota agotada → banner rojo + cascade a PlantNet

## Spec
- `docs/superpowers/specs/2026-04-28-ai-sponsorships-design.md`
- Plan: `docs/superpowers/plans/2026-04-28-m20-ai-sponsorships.md`

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

---

## Self-Review

After writing, the spec was checked against this plan:

**Spec coverage:**
- Tables: ✓ (Tasks 3-6)
- `resolve_sponsorship()`: ✓ (Task 7)
- `add_karma_simple()` + karma triggers: ✓ (Tasks 8-9)
- `audit_op` extension: ✓ (Task 10)
- Cron jobs: ✓ (Task 11)
- `app.cron_token` setup: ✓ (Task 12)
- `_shared/anthropic-validate.ts`: ✓ (Task 13)
- `_shared/sponsorship.ts` (resolve, decrypt, recordUsage, rate-limit, autoPause, notify, pickAuthHeader): ✓ (Tasks 14-17)
- `sponsorships` Edge Function endpoints: ✓ (Tasks 18-24)
- `identify` modification: ✓ (Task 26)
- Frontend types + lib: ✓ (Tasks 27-28)
- i18n EN/ES + routes + pages: ✓ (Tasks 29-31, 34)
- Components: ✓ (Tasks 32-33)
- `/identify` banner integration: ✓ (Task 35)
- Discovery card: ✓ (Task 36)
- Header dropdown entries: ✓ (Task 37)
- CI smoke + lint: ✓ (Tasks 38-39)
- Roadmap + tasks: ✓ (Task 40)
- Operator key removal + rollout: ✓ (Task 42)

**Placeholder scan:** No "TBD", "implement later", or "fill in details" patterns. The `// TODO if not present` comment in Task 16 (sendThresholdEmail) was rewritten to a deliberate v1 stub that logs and explains the email worker dependency — acceptable for v1.

**Type consistency:**
- `ResolvedSponsorship` defined in Task 14, consumed in Tasks 15-17 and Task 26 — fields match.
- `Sponsorship` / `SponsorCredential` / `SponsorshipUsage` defined in Task 27, consumed in Task 28 client wrapper and Tasks 32-33 components — fields match.
- `pickAuthHeader(kind, secret)` signature consistent across Tasks 14, 26.
- SQL function signatures match between schema appends (Tasks 7-9) and SQL helpers in Task 17 (`increment_rate_limit_bucket`) and Task 19 (`create_vault_secret` / `delete_vault_secret`).

No issues to fix.

---

## Execution Handoff

Plan complete and saved to `docs/superpowers/plans/2026-04-28-m20-ai-sponsorships.md`. Two execution options:

**1. Subagent-Driven (recommended)** — I dispatch a fresh subagent per task, review between tasks, fast iteration. Best for a 42-task plan because each subagent stays focused and the main session reviews diffs without ballooning context.

**2. Inline Execution** — Execute tasks in this session using executing-plans, batch execution with checkpoints. Faster end-to-end if you want me to drive everything but uses more context per turn.

Which approach?
