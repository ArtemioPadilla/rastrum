# Admin Console — PR 1 (Foundation) Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land the schema, RLS, console chrome mode, and `admin` Edge Function dispatcher needed to support a privileged-actions console — plus three working tabs (Overview, Experts moved from `/profile/admin/experts/`, Audit log).

**Architecture:** Three-layer authorization (UI gate / RLS / `admin` Edge Function). Single `user_roles` join table with audit columns. All privileged writes route through the dispatcher Edge Function which atomically inserts an `admin_audit` row in the same transaction. Console renders under a new `'console'` chrome mode driven by `console-tabs.ts` as the single source of truth for sidebar, role pills, and routes.

**Tech Stack:** Astro 5 + TypeScript strict mode + Tailwind safelist, Supabase (Postgres + PostGIS + RLS), Supabase Edge Functions on Deno (esm.sh imports), Vitest for unit tests, Playwright for e2e, idempotent SQL applied via `make db-apply`.

**Spec:** [`docs/superpowers/specs/2026-04-27-admin-console-design.md`](../specs/2026-04-27-admin-console-design.md) (commit 89b72e0).

**Out of scope for this plan:** Users tab, Credentials tab, Expert/Moderator consoles (PR2). Sync/API/Cron tabs (PR3). Badges editor, Karma tuning, Feature flags, etc. (PR4+). Each gets its own plan when scheduled.

---

## File map

### Created
| Path | Responsibility |
|---|---|
| `src/lib/console-tabs.ts` | 25-tab declaration; `tabsForRoles()` + `rolePillsFor()` projections |
| `src/lib/admin-client.ts` | Typed SDK wrapping `POST /functions/v1/admin` |
| `src/lib/user-roles.ts` | Browser-side helper: `getUserRoles(userId)` returns `Set<UserRole>` |
| `src/components/ConsoleLayout.astro` | Console chrome shell — top bar, role pills, sidebar, mobile drawer |
| `src/components/ConsoleSidebar.astro` | Filtered sidebar derived from `console-tabs.ts` |
| `src/components/ConsoleOverviewView.astro` | Overview tab body (per-role) |
| `src/components/ConsoleAuditLogView.astro` | Audit log tab body |
| `src/pages/en/console/index.astro` | Overview route (admin/mod/expert pick by active pill) |
| `src/pages/es/consola/index.astro` | ES mirror |
| `src/pages/en/console/experts/index.astro` | Experts queue (moved from `/profile/admin/experts/`) |
| `src/pages/es/consola/expertos/index.astro` | ES mirror |
| `src/pages/en/console/audit/index.astro` | Audit log |
| `src/pages/es/consola/auditoria/index.astro` | ES mirror |
| `src/pages/en/profile/admin/experts/index.astro` | Replaced by 308 redirect to `/console/experts/` |
| `src/pages/es/perfil/admin/expertos/index.astro` | ES redirect |
| `supabase/functions/admin/index.ts` | Dispatcher entry: JWT verify → role check → tx wrap |
| `supabase/functions/admin/handlers/role-grant.ts` | First write handler |
| `supabase/functions/admin/handlers/role-revoke.ts` | Second write handler |
| `supabase/functions/admin/handlers/sensitive-read-user-audit.ts` | First sensitive-read handler |
| `supabase/functions/admin/handlers/index.ts` | Lookup table |
| `supabase/functions/admin/_shared/audit.ts` | `insertAuditRow()` helper |
| `supabase/functions/admin/_shared/auth.ts` | `verifyJwtAndLoadRoles()` helper |
| `tests/lib/console-tabs.test.ts` | Vitest unit tests |
| `tests/lib/admin-client.test.ts` | Vitest unit tests (fetch mocked) |
| `tests/lib/chrome-mode-console.test.ts` | New tests for `'console'` mode |
| `tests/e2e/console-smoke.spec.ts` | Playwright smoke for chrome + redirect |
| `docs/specs/modules/24-admin-console.md` | Module spec (canonical implementation reference) |
| `docs/runbooks/admin-bootstrap.md` | One-shot bootstrap SQL |
| `docs/runbooks/role-model.md` | Definitive guide to the 4 roles |
| `docs/runbooks/admin-audit.md` | How to read the audit log (PR1 minimum) |
| `docs/runbooks/admin-ops.md` | Per-action runbook (PR1: role grant/revoke + audit-only) |
| `src/pages/en/docs/console.md` | High-level user-facing explainer |
| `src/pages/es/docs/console.md` | ES mirror |

### Modified
| Path | Change |
|---|---|
| `docs/specs/infra/supabase-schema.sql` | Append: `user_role` enum, `user_roles` table, `has_role()` function, `audit_op` enum, `admin_audit` table, sync trigger, RLS policies, refactor `api_usage` + `sync_failures` predicates |
| `src/lib/chrome-mode.ts` | Add `'console'` mode |
| `src/lib/types.ts` | Export `UserRole` type |
| `src/i18n/utils.ts` | Add 22 console route entries |
| `src/i18n/en.json` | Add `console.*` keys |
| `src/i18n/es.json` | Add `console.*` keys |
| `src/components/Header.astro` | Add conditional Console pill |
| `src/components/MobileDrawer.astro` | Add Console entry visible only when role-holder |
| `tailwind.config.mjs` | Safelist `console` accent rail classes |
| `docs/specs/modules/00-index.md` | Add row 24 |
| `docs/architecture.md` | Add console section + sequence diagram |
| `CLAUDE.md` | New "Console / privileged surfaces" section under Conventions |
| `docs/progress.json` | Add `admin-console-foundation` item |
| `docs/tasks.json` | Add subtasks under that item |

---

## Task list

### Task 1: Append schema migration to canonical SQL

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append section near the end, before any final notes)

- [ ] **Step 1: Append the migration block**

Add this block to the end of `docs/specs/infra/supabase-schema.sql`. Use `IF NOT EXISTS` and `OR REPLACE` everywhere so `make db-apply` stays idempotent.

```sql
-- ═════════════════════════════════════════════════════════════════════
-- ADMIN CONSOLE FOUNDATION (PR1)
-- See docs/superpowers/specs/2026-04-27-admin-console-design.md
-- ═════════════════════════════════════════════════════════════════════

-- 1. user_role enum
DO $$ BEGIN
  CREATE TYPE public.user_role AS ENUM ('admin', 'moderator', 'expert', 'researcher');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 2. user_roles join table
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role        public.user_role NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES public.users(id),
  revoked_at  timestamptz,
  notes       text,
  PRIMARY KEY (user_id, role)
);

-- Partial index restricted to permanently-active rows (NULL revoked_at). Future-dated revocations are rare; has_role() handles the > now() check at query time.
CREATE INDEX IF NOT EXISTS user_roles_active_idx
  ON public.user_roles (role)
  WHERE revoked_at IS NULL;

ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;

-- 3. has_role() helper, callable from RLS predicates
CREATE OR REPLACE FUNCTION public.has_role(uid uuid, r public.user_role)
RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER
SET search_path = public
AS $$
  SELECT EXISTS (
    SELECT 1 FROM public.user_roles
    WHERE user_id = uid
      AND role = r
      AND (revoked_at IS NULL OR revoked_at > now())
  );
$$;
REVOKE ALL ON FUNCTION public.has_role(uuid, public.user_role) FROM public;
GRANT EXECUTE ON FUNCTION public.has_role(uuid, public.user_role) TO authenticated, service_role;

-- 4. audit_op enum
DO $$ BEGIN
  CREATE TYPE public.audit_op AS ENUM (
    'role_grant', 'role_revoke',
    'user_ban', 'user_unban', 'user_delete',
    'observation_hide', 'observation_unhide',
    'observation_obscure', 'observation_force_unobscure',
    'observation_license_override', 'observation_hard_delete',
    'comment_hide', 'comment_lock', 'comment_unlock',
    'badge_award_manual', 'badge_revoke',
    'token_force_revoke',
    'feature_flag_toggle',
    'cron_force_run',
    'precise_coords_read',
    'user_pii_read',
    'token_list_read',
    'user_audit_read'
  );
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- 5. admin_audit table
CREATE TABLE IF NOT EXISTS public.admin_audit (
  id          bigserial PRIMARY KEY,
  actor_id    uuid NOT NULL REFERENCES public.users(id),
  op          public.audit_op NOT NULL,
  target_type text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  reason      text NOT NULL,
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_actor_idx ON public.admin_audit (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx ON public.admin_audit (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_op_idx ON public.admin_audit (op, created_at DESC);

ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;

-- 6. Sync trigger keeps users.is_expert / .credentialed_researcher cached
CREATE OR REPLACE FUNCTION public.sync_user_role_flags() RETURNS trigger
LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    UPDATE public.users
       SET is_expert = public.has_role(NEW.user_id, 'expert'),
           credentialed_researcher = public.has_role(NEW.user_id, 'researcher')
     WHERE id = NEW.user_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.users
       SET is_expert = public.has_role(OLD.user_id, 'expert'),
           credentialed_researcher = public.has_role(OLD.user_id, 'researcher')
     WHERE id = OLD.user_id;
  END IF;
  RETURN COALESCE(NEW, OLD);
END;
$$;

-- The trigger fires on changes to revoked_at because that's the only
-- time the active-roles set changes for a given user. The PRIMARY KEY
-- (user_id, role) prevents direct role-column mutations. If the schema
-- ever adds an alternative deactivation column (e.g., is_active), this
-- trigger needs to expand the UPDATE OF list.
DROP TRIGGER IF EXISTS user_roles_sync_flags ON public.user_roles;
CREATE TRIGGER user_roles_sync_flags
AFTER INSERT OR UPDATE OF revoked_at OR DELETE ON public.user_roles
FOR EACH ROW EXECUTE FUNCTION public.sync_user_role_flags();

-- 7. RLS policies
DROP POLICY IF EXISTS user_roles_admin_or_self_read ON public.user_roles;
CREATE POLICY user_roles_admin_or_self_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin') OR user_id = auth.uid());

DROP POLICY IF EXISTS user_roles_no_self_write ON public.user_roles;
CREATE POLICY user_roles_no_self_write ON public.user_roles
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

DROP POLICY IF EXISTS admin_audit_admin_read ON public.admin_audit;
CREATE POLICY admin_audit_admin_read ON public.admin_audit
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_audit_no_client_write ON public.admin_audit;
CREATE POLICY admin_audit_no_client_write ON public.admin_audit
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- 8. Refactor existing api_usage / sync_failures predicates from is_expert → admin role
--    Note: the original policies were named with a different convention; we drop
--    both the historical and the new name for idempotency.
DROP POLICY IF EXISTS "api_usage_read_admin"     ON public.api_usage;
DROP POLICY IF EXISTS api_usage_expert_read       ON public.api_usage;
DROP POLICY IF EXISTS api_usage_admin_read        ON public.api_usage;
CREATE POLICY api_usage_admin_read ON public.api_usage
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "sync_failures_read_admin" ON public.sync_failures;
DROP POLICY IF EXISTS sync_failures_expert_read   ON public.sync_failures;
DROP POLICY IF EXISTS sync_failures_admin_read    ON public.sync_failures;
CREATE POLICY sync_failures_admin_read ON public.sync_failures
  FOR SELECT TO authenticated
  USING (public.has_role(auth.uid(), 'admin'));

-- 9. Grants
GRANT SELECT                          ON public.user_roles  TO authenticated;
GRANT SELECT                          ON public.admin_audit TO authenticated;
GRANT SELECT, INSERT, UPDATE, DELETE  ON public.user_roles  TO service_role;
GRANT SELECT, INSERT                  ON public.admin_audit TO service_role;
```

- [ ] **Step 2: Apply locally and verify**

```bash
make db-apply
make db-verify
```

Expected `db-verify` output (relevant lines):
```
public.user_roles                | RLS enabled | …
public.admin_audit               | RLS enabled | …
public.has_role(uuid,user_role)  | function    | SECURITY DEFINER
```

- [ ] **Step 3: Run a sanity SQL check**

```bash
make db-psql -- -c "SELECT pg_typeof(public.has_role(gen_random_uuid(),'admin'));"
```

Expected: `boolean` returned without error.

- [ ] **Step 4: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(schema): admin console foundation — user_roles + admin_audit + has_role

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 2: Bootstrap runbook

**Files:**
- Create: `docs/runbooks/admin-bootstrap.md`

- [ ] **Step 1: Create the runbook**

```markdown
# Admin Bootstrap

> One-shot procedure to grant the operator the first `admin` role, run
> manually after applying the PR1 schema migration. After this, all
> further role grants happen through the console UI.

## Pre-conditions

- Schema migration applied (`make db-apply` shows `user_roles` table exists).
- Operator already has a row in `public.users` (sign in once via the normal auth flow).

## Procedure

1. Find your `user_id`:

```bash
make db-psql -- -c "SELECT id, username FROM public.users WHERE username = 'artemio';"
```

2. Insert the bootstrap row (`granted_by IS NULL` is the unambiguous bootstrap signal):

```bash
make db-psql -- -c "INSERT INTO public.user_roles (user_id, role, granted_by, notes)
VALUES ('<your-user-id>', 'admin', NULL, 'bootstrap')
ON CONFLICT (user_id, role) DO NOTHING;"
```

3. Verify:

```bash
make db-psql -- -c "SELECT public.has_role('<your-user-id>', 'admin');"
```

Expected: `t` (true).

4. Reload `https://rastrum.org` — the **Console** pill should now appear in
   the header. Click it; you should land on `/en/console/` (or `/es/consola/`).

## Rollback

```bash
make db-psql -- -c "DELETE FROM public.user_roles
WHERE user_id = '<your-user-id>' AND role = 'admin' AND granted_by IS NULL;"
```
```

- [ ] **Step 2: Commit**

```bash
git add docs/runbooks/admin-bootstrap.md
git commit -m "docs(runbook): admin bootstrap procedure

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 3: Add `'console'` to `ChromeMode`

**Files:**
- Modify: `src/lib/chrome-mode.ts`
- Test: `tests/lib/chrome-mode-console.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/lib/chrome-mode-console.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveChromeMode } from '../../src/lib/chrome-mode';

describe('resolveChromeMode — console mode', () => {
  it('returns "console" for /en/console/', () => {
    expect(resolveChromeMode('/en/console/')).toBe('console');
  });
  it('returns "console" for /es/consola/', () => {
    expect(resolveChromeMode('/es/consola/')).toBe('console');
  });
  it('returns "console" for nested console paths', () => {
    expect(resolveChromeMode('/en/console/users/')).toBe('console');
    expect(resolveChromeMode('/es/consola/auditoria/')).toBe('console');
  });
  it('returns "console" with no trailing slash', () => {
    expect(resolveChromeMode('/en/console')).toBe('console');
  });
  it('still returns "app" for /en/profile/', () => {
    expect(resolveChromeMode('/en/profile/')).toBe('app');
  });
  it('still returns "read" for /', () => {
    expect(resolveChromeMode('/')).toBe('read');
  });
});
```

- [ ] **Step 2: Run test — must fail**

```bash
npx vitest run tests/lib/chrome-mode-console.test.ts
```

Expected: FAIL — `Expected "console" to be "read"` or similar.

- [ ] **Step 3: Implement**

Edit `src/lib/chrome-mode.ts`. Change the type and add the regex check at the top of `resolveChromeMode`:

```ts
export type ChromeMode = 'app' | 'read' | 'console';
```

Inside `resolveChromeMode`, after the `noBase` calculation and before the `AUTH_PREFIXES` loop, add:

```ts
// Console mode: privileged-actions surface, fully separate chrome.
if (/^\/(en|es)\/(console|consola)(\/|$)/.test(noBase)) return 'console';
```

- [ ] **Step 4: Run test — must pass**

```bash
npx vitest run tests/lib/chrome-mode-console.test.ts
```

Expected: PASS, all 6 cases green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/chrome-mode.ts tests/lib/chrome-mode-console.test.ts
git commit -m "feat(chrome): add 'console' mode for privileged-actions surface

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 4: Export `UserRole` type

**Files:**
- Modify: `src/lib/types.ts` (append)

- [ ] **Step 1: Append type**

```ts
export type UserRole = 'admin' | 'moderator' | 'expert' | 'researcher';
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/types.ts
git commit -m "feat(types): export UserRole

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 5: Add console routes to `i18n/utils.ts`

**Files:**
- Modify: `src/i18n/utils.ts`

- [ ] **Step 1: Add route entries**

Append these entries to the `routes` object in `src/i18n/utils.ts`. Order matters only for readability; the object is keyed lookup.

```ts
  // Console (admin / moderator / expert privileged surface)
  console:                  { en: '/console',                  es: '/consola' },
  consoleUsers:             { en: '/console/users',            es: '/consola/usuarios' },
  consoleCredentials:       { en: '/console/credentials',      es: '/consola/credenciales' },
  consoleExperts:           { en: '/console/experts',          es: '/consola/expertos' },
  consoleObservations:      { en: '/console/observations',     es: '/consola/observaciones' },
  consoleApi:               { en: '/console/api',              es: '/consola/api' },
  consoleSync:              { en: '/console/sync',             es: '/consola/sync' },
  consoleCron:              { en: '/console/cron',             es: '/consola/cron' },
  consoleBadges:            { en: '/console/badges',           es: '/consola/insignias' },
  consoleTaxa:              { en: '/console/taxa',             es: '/consola/taxa' },
  consoleKarma:             { en: '/console/karma',            es: '/consola/karma' },
  consoleFlags:             { en: '/console/flags',            es: '/consola/banderas' },
  consoleAudit:             { en: '/console/audit',            es: '/consola/auditoria' },
  consoleFeatureFlags:      { en: '/console/features',         es: '/consola/caracteristicas' },
  consoleBioblitz:          { en: '/console/bioblitz',         es: '/consola/bioblitz' },
  consoleModFlagQueue:      { en: '/console/flag-queue',       es: '/consola/cola-banderas' },
  consoleModComments:       { en: '/console/comments',         es: '/consola/comentarios' },
  consoleModBans:           { en: '/console/bans',             es: '/consola/suspensiones' },
  consoleModDisputes:       { en: '/console/disputes',         es: '/consola/disputas' },
  consoleExpertValidation:  { en: '/console/validation',       es: '/consola/validacion' },
  consoleExpertOverrides:   { en: '/console/overrides',        es: '/consola/correcciones' },
  consoleExpertExpertise:   { en: '/console/expertise',        es: '/consola/experiencia' },
  consoleExpertTaxonNotes:  { en: '/console/taxon-notes',      es: '/consola/notas-taxon' },
```

- [ ] **Step 2: Run typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/i18n/utils.ts
git commit -m "feat(i18n): add 22 console route slugs (EN/ES paired)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 6: Build `console-tabs.ts` source of truth

**Files:**
- Create: `src/lib/console-tabs.ts`
- Test: `tests/lib/console-tabs.test.ts`

- [ ] **Step 1: Write failing tests**

Create `tests/lib/console-tabs.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { CONSOLE_TABS, tabsForRoles, rolePillsFor } from '../../src/lib/console-tabs';
import type { UserRole } from '../../src/lib/types';

describe('console-tabs', () => {
  it('declares 25 tabs total', () => {
    expect(CONSOLE_TABS).toHaveLength(25);
  });

  it('every tab has a unique id', () => {
    const ids = CONSOLE_TABS.map(t => t.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('every tab routeKey resolves in the routes table', () => {
    // import dynamically to avoid circular import
    const { routes } = require('../../src/i18n/utils');
    for (const tab of CONSOLE_TABS) {
      expect(routes).toHaveProperty(tab.routeKey);
    }
  });

  it('admin role has 15 tabs', () => {
    expect(CONSOLE_TABS.filter(t => t.role === 'admin')).toHaveLength(15);
  });

  it('moderator role has 5 tabs', () => {
    expect(CONSOLE_TABS.filter(t => t.role === 'moderator')).toHaveLength(5);
  });

  it('expert role has 5 tabs', () => {
    expect(CONSOLE_TABS.filter(t => t.role === 'expert')).toHaveLength(5);
  });

  it('researcher role has 0 sidebar tabs (data-access only)', () => {
    expect(CONSOLE_TABS.filter(t => (t.role as string) === 'researcher')).toHaveLength(0);
  });

  it('tabsForRoles filters by activeRole and gates by allRoles', () => {
    const all = new Set<UserRole>(['admin', 'expert']);
    const adminTabs = tabsForRoles('admin', all);
    expect(adminTabs.every(t => t.role === 'admin')).toBe(true);
    expect(adminTabs).toHaveLength(15);

    const moderatorTabs = tabsForRoles('moderator', all);
    expect(moderatorTabs).toHaveLength(0); // user does not hold moderator
  });

  it('rolePillsFor returns roles in canonical order', () => {
    const all = new Set<UserRole>(['expert', 'admin', 'moderator']);
    expect(rolePillsFor(all)).toEqual(['admin', 'moderator', 'expert']);
  });

  it('rolePillsFor excludes researcher (data-access role)', () => {
    const all = new Set<UserRole>(['admin', 'researcher']);
    expect(rolePillsFor(all)).toEqual(['admin']);
  });

  it('every phase-1 tab is non-stub', () => {
    const phase1 = CONSOLE_TABS.filter(t => t.phase === 1);
    expect(phase1.every(t => !t.stub)).toBe(true);
    expect(phase1.length).toBeGreaterThan(0);
  });
});
```

- [ ] **Step 2: Run — must fail**

```bash
npx vitest run tests/lib/console-tabs.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement `console-tabs.ts`**

Create `src/lib/console-tabs.ts`:

```ts
import type { UserRole } from './types';
import { routes } from '../i18n/utils';

export interface ConsoleTab {
  id: string;
  role: UserRole;
  routeKey: keyof typeof routes;
  i18nKey: string;
  icon: string;
  phase: 1 | 2 | 3 | 4;
  stub?: boolean;
}

export const CONSOLE_TABS: ConsoleTab[] = [
  // Admin (15)
  { id: 'overview',       role: 'admin',     routeKey: 'console',                 i18nKey: 'console.overview',     icon: 'gauge',       phase: 1 },
  { id: 'users',          role: 'admin',     routeKey: 'consoleUsers',            i18nKey: 'console.users',        icon: 'users',       phase: 2, stub: true },
  { id: 'credentials',    role: 'admin',     routeKey: 'consoleCredentials',      i18nKey: 'console.credentials',  icon: 'shield-check',phase: 2, stub: true },
  { id: 'experts',        role: 'admin',     routeKey: 'consoleExperts',          i18nKey: 'console.experts',      icon: 'award',       phase: 1 },
  { id: 'observations',   role: 'admin',     routeKey: 'consoleObservations',     i18nKey: 'console.observations', icon: 'leaf',        phase: 4, stub: true },
  { id: 'api',            role: 'admin',     routeKey: 'consoleApi',              i18nKey: 'console.api',          icon: 'plug',        phase: 3, stub: true },
  { id: 'sync',           role: 'admin',     routeKey: 'consoleSync',             i18nKey: 'console.sync',         icon: 'refresh',     phase: 3, stub: true },
  { id: 'cron',           role: 'admin',     routeKey: 'consoleCron',             i18nKey: 'console.cron',         icon: 'clock',       phase: 3, stub: true },
  { id: 'badges',         role: 'admin',     routeKey: 'consoleBadges',           i18nKey: 'console.badges',       icon: 'star',        phase: 4, stub: true },
  { id: 'taxa',           role: 'admin',     routeKey: 'consoleTaxa',             i18nKey: 'console.taxa',         icon: 'tree',        phase: 4, stub: true },
  { id: 'karma',          role: 'admin',     routeKey: 'consoleKarma',            i18nKey: 'console.karma',        icon: 'sparkles',    phase: 4, stub: true },
  { id: 'flags',          role: 'admin',     routeKey: 'consoleFlags',            i18nKey: 'console.flags',        icon: 'flag',        phase: 4, stub: true },
  { id: 'audit',          role: 'admin',     routeKey: 'consoleAudit',            i18nKey: 'console.audit',        icon: 'scroll',      phase: 1 },
  { id: 'features',       role: 'admin',     routeKey: 'consoleFeatureFlags',     i18nKey: 'console.features',     icon: 'toggle',      phase: 4, stub: true },
  { id: 'bioblitz',       role: 'admin',     routeKey: 'consoleBioblitz',         i18nKey: 'console.bioblitz',     icon: 'calendar',    phase: 4, stub: true },

  // Moderator (5)
  { id: 'mod-overview',   role: 'moderator', routeKey: 'console',                 i18nKey: 'console.modOverview',   icon: 'gauge',      phase: 3, stub: true },
  { id: 'mod-flag-queue', role: 'moderator', routeKey: 'consoleModFlagQueue',     i18nKey: 'console.modFlagQueue',  icon: 'flag',       phase: 3, stub: true },
  { id: 'mod-comments',   role: 'moderator', routeKey: 'consoleModComments',      i18nKey: 'console.modComments',   icon: 'message',    phase: 3, stub: true },
  { id: 'mod-bans',       role: 'moderator', routeKey: 'consoleModBans',          i18nKey: 'console.modBans',       icon: 'user-x',     phase: 4, stub: true },
  { id: 'mod-disputes',   role: 'moderator', routeKey: 'consoleModDisputes',      i18nKey: 'console.modDisputes',   icon: 'gavel',      phase: 4, stub: true },

  // Expert (5)
  { id: 'exp-overview',   role: 'expert',    routeKey: 'console',                 i18nKey: 'console.expOverview',   icon: 'gauge',      phase: 2, stub: true },
  { id: 'exp-validation', role: 'expert',    routeKey: 'consoleExpertValidation', i18nKey: 'console.expValidation', icon: 'check-circle', phase: 2, stub: true },
  { id: 'exp-expertise',  role: 'expert',    routeKey: 'consoleExpertExpertise',  i18nKey: 'console.expExpertise',  icon: 'badge-check', phase: 2, stub: true },
  { id: 'exp-overrides',  role: 'expert',    routeKey: 'consoleExpertOverrides',  i18nKey: 'console.expOverrides',  icon: 'edit',       phase: 4, stub: true },
  { id: 'exp-taxon-notes',role: 'expert',    routeKey: 'consoleExpertTaxonNotes', i18nKey: 'console.expTaxonNotes', icon: 'sticky-note',phase: 4, stub: true },
];

export function tabsForRoles(activeRole: UserRole, allRoles: Set<UserRole>): ConsoleTab[] {
  if (!allRoles.has(activeRole)) return [];
  return CONSOLE_TABS.filter(t => t.role === activeRole);
}

const PILL_ORDER: UserRole[] = ['admin', 'moderator', 'expert'];

export function rolePillsFor(allRoles: Set<UserRole>): UserRole[] {
  return PILL_ORDER.filter(r => allRoles.has(r));
}
```

- [ ] **Step 4: Run — must pass**

```bash
npx vitest run tests/lib/console-tabs.test.ts
npm run typecheck
```

Expected: all 11 tests green; typecheck clean.

- [ ] **Step 5: Commit**

```bash
git add src/lib/console-tabs.ts tests/lib/console-tabs.test.ts
git commit -m "feat(console): tabs source of truth + projections

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 7: Browser-side `getUserRoles()` helper

**Files:**
- Create: `src/lib/user-roles.ts`

- [ ] **Step 1: Implement**

```ts
import { getSupabase } from './supabase';
import type { UserRole } from './types';

/**
 * Read the active roles for a given user from public.user_roles.
 * Filters out revoked rows. Returns an empty Set for unauthenticated callers.
 */
export async function getUserRoles(userId: string | null | undefined): Promise<Set<UserRole>> {
  if (!userId) return new Set();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_roles')
    .select('role, revoked_at')
    .eq('user_id', userId);
  if (error || !data) return new Set();
  const now = Date.now();
  const active = data.filter(r => !r.revoked_at || new Date(r.revoked_at).getTime() > now);
  return new Set(active.map(r => r.role as UserRole));
}
```

- [ ] **Step 2: Verify typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/user-roles.ts
git commit -m "feat(roles): browser-side getUserRoles() helper

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 8: Tailwind safelist for the `console` accent rail

**Files:**
- Modify: `tailwind.config.mjs`

- [ ] **Step 1: Add to safelist**

Inside the existing `safelist` array in `tailwind.config.mjs`, add (preserve neighbouring entries):

```js
'border-slate-500',
'text-slate-700',
'dark:text-slate-300',
'bg-slate-100',
'dark:bg-slate-800/40',
```

If any of those classes already exist in the safelist, dedupe. The bare class names match the `railClass('console')` output documented in the spec.

- [ ] **Step 2: Build to verify**

```bash
npm run build
```

Expected: build completes; no Tailwind warnings about purged classes.

- [ ] **Step 3: Commit**

```bash
git add tailwind.config.mjs
git commit -m "chore(tailwind): safelist console accent rail classes

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 9: Add `console.*` i18n keys (EN/ES)

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

- [ ] **Step 1: Add EN keys**

Append a new top-level `console` block to `src/i18n/en.json` (insert before the closing `}`):

```json
,
  "console": {
    "nav": "Console",
    "exit": "Exit console",
    "back_to_site": "Back to Rastrum",
    "not_authorized": "You don't have console access.",
    "loading": "Loading…",
    "role_admin_pill": "Admin",
    "role_moderator_pill": "Moderation",
    "role_expert_pill": "Expert",
    "overview": "Overview",
    "users": "Users",
    "credentials": "Researcher credentials",
    "experts": "Expert applications",
    "observations": "Observations",
    "api": "API & quotas",
    "sync": "Sync failures",
    "cron": "Cron / Edge fns",
    "badges": "Badges",
    "taxa": "Taxa & rarity",
    "karma": "Karma tuning",
    "flags": "Flags (admin)",
    "audit": "Audit log",
    "features": "Feature flags",
    "bioblitz": "Bioblitz events",
    "modOverview": "Overview",
    "modFlagQueue": "Flag queue",
    "modComments": "Comments",
    "modBans": "Soft-bans",
    "modDisputes": "License disputes",
    "expOverview": "Overview",
    "expValidation": "Validation queue",
    "expExpertise": "Your expertise",
    "expOverrides": "Identification overrides",
    "expTaxonNotes": "Taxon notes",
    "stub_coming_soon": "Coming in a later phase",
    "stub_track_issue": "Track on GitHub →",
    "overview_alerts_heading": "Needs your attention",
    "overview_at_a_glance": "At a glance",
    "overview_no_alerts": "Nothing on fire — platform is healthy."
  }
```

- [ ] **Step 2: Add ES keys**

Append the equivalent block to `src/i18n/es.json`:

```json
,
  "console": {
    "nav": "Consola",
    "exit": "Salir de la consola",
    "back_to_site": "Volver a Rastrum",
    "not_authorized": "No tienes acceso a la consola.",
    "loading": "Cargando…",
    "role_admin_pill": "Admin",
    "role_moderator_pill": "Moderación",
    "role_expert_pill": "Experto",
    "overview": "Resumen",
    "users": "Usuarios",
    "credentials": "Credenciales de investigador",
    "experts": "Solicitudes de experto",
    "observations": "Observaciones",
    "api": "API y cuotas",
    "sync": "Fallos de sync",
    "cron": "Cron / Edge fns",
    "badges": "Insignias",
    "taxa": "Taxa y rareza",
    "karma": "Ajuste de karma",
    "flags": "Banderas (admin)",
    "audit": "Auditoría",
    "features": "Banderas de funcionalidad",
    "bioblitz": "Eventos bioblitz",
    "modOverview": "Resumen",
    "modFlagQueue": "Cola de banderas",
    "modComments": "Comentarios",
    "modBans": "Suspensiones",
    "modDisputes": "Disputas de licencia",
    "expOverview": "Resumen",
    "expValidation": "Cola de validación",
    "expExpertise": "Tu experiencia",
    "expOverrides": "Correcciones de ID",
    "expTaxonNotes": "Notas de taxón",
    "stub_coming_soon": "Próximamente",
    "stub_track_issue": "Sigue en GitHub →",
    "overview_alerts_heading": "Necesita tu atención",
    "overview_at_a_glance": "De un vistazo",
    "overview_no_alerts": "Nada urgente — la plataforma está sana."
  }
```

- [ ] **Step 3: Verify build**

```bash
npm run build
```

Expected: build completes; both JSON files parse.

- [ ] **Step 4: Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "i18n(console): add console.* keys (EN/ES)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 10: `ConsoleSidebar.astro` and `ConsoleLayout.astro`

**Files:**
- Create: `src/components/ConsoleSidebar.astro`
- Create: `src/components/ConsoleLayout.astro`

- [ ] **Step 1: Create `ConsoleSidebar.astro`**

```astro
---
/**
 * ConsoleSidebar — derived purely from console-tabs.ts. The active role
 * is passed in by ConsoleLayout based on the URL or pill state. Stub
 * tabs render a dimmed style + "Coming soon" suffix.
 */
import type { UserRole } from '../lib/types';
import { tabsForRoles } from '../lib/console-tabs';
import { t, getLocalizedPath, routes } from '../i18n/utils';

interface Props {
  lang: 'en' | 'es';
  activeRole: UserRole;
  allRoles: Set<UserRole>;
  currentPath: string;
}

const { lang, activeRole, allRoles, currentPath } = Astro.props;
const tr = t(lang);
const tabs = tabsForRoles(activeRole, allRoles);

function trAt(path: string): string {
  // resolve "console.users" → tr.console.users
  const parts = path.split('.');
  let cursor: unknown = tr;
  for (const p of parts) {
    if (cursor && typeof cursor === 'object' && p in (cursor as Record<string, unknown>)) {
      cursor = (cursor as Record<string, unknown>)[p];
    } else {
      return path;
    }
  }
  return typeof cursor === 'string' ? cursor : path;
}
---

<nav class="hidden md:block w-56 shrink-0 border-r border-zinc-200 dark:border-zinc-800 bg-zinc-50/40 dark:bg-zinc-950 p-3 overflow-y-auto">
  <ul class="space-y-0.5 text-sm">
    {tabs.map(tab => {
      const href = getLocalizedPath(lang, routes[tab.routeKey][lang] + '/');
      const isActive = currentPath === href || currentPath.startsWith(href);
      const cls = [
        'flex items-center justify-between rounded px-2.5 py-1.5',
        isActive
          ? 'bg-zinc-200/70 dark:bg-zinc-800 text-zinc-900 dark:text-zinc-100 font-medium'
          : 'text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-900',
        tab.stub ? 'opacity-60' : '',
      ].join(' ');
      return (
        <li>
          <a href={href} class={cls}>
            <span>{trAt(tab.i18nKey)}</span>
            {tab.stub && (
              <span class="text-[10px] uppercase tracking-wide text-zinc-500">soon</span>
            )}
          </a>
        </li>
      );
    })}
  </ul>
</nav>
```

- [ ] **Step 2: Create `ConsoleLayout.astro`**

```astro
---
/**
 * ConsoleLayout — privileged-actions chrome. No public Header/Footer.
 * Top bar: wordmark + role pills + identity + Exit.
 * Body: ConsoleSidebar + slot.
 *
 * Role pills only show for roles the signed-in user holds. The active
 * role is read from the URL pattern (specific tabs) or defaulted to
 * the first held role for the bare /console/ overview route.
 */
import type { UserRole } from '../lib/types';
import { rolePillsFor, CONSOLE_TABS } from '../lib/console-tabs';
import { t, getLocalizedPath, routes } from '../i18n/utils';
import ConsoleSidebar from './ConsoleSidebar.astro';

interface Props {
  lang: 'en' | 'es';
  allRoles: Set<UserRole>;
  activeRole: UserRole;
  currentPath: string;
  identity: { username: string | null; avatar?: string };
}

const { lang, allRoles, activeRole, currentPath, identity } = Astro.props;
const tr = t(lang);
const pills = rolePillsFor(allRoles);
const exitHref = getLocalizedPath(lang, '/');
const dashboardHref = getLocalizedPath(lang, routes.console[lang] + '/');

function pillHref(role: UserRole): string {
  // /console/ for any role; ConsoleLayout's activeRole prop is what swaps content.
  // We use a query param so pill clicks survive deep links.
  return `${dashboardHref}?role=${role}`;
}

const railColour = (role: UserRole): string => {
  switch (role) {
    case 'admin':     return 'bg-emerald-700 text-white';
    case 'moderator': return 'bg-amber-600 text-white';
    case 'expert':    return 'bg-sky-700 text-white';
    default:          return 'bg-slate-600 text-white';
  }
};
---

<div class="min-h-screen flex flex-col bg-white dark:bg-zinc-950 text-zinc-900 dark:text-zinc-100">
  <header class="flex items-center gap-3 border-b border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-950 px-4 py-2.5">
    <a href={exitHref} class="font-bold tracking-tight text-emerald-700 dark:text-emerald-400">
      Rastrum
    </a>
    <span class="ml-1 hidden sm:inline-block text-xs text-zinc-500 uppercase tracking-wide">
      {tr.console.nav}
    </span>
    <nav class="ml-3 flex gap-1.5">
      {pills.map(role => {
        const isActive = role === activeRole;
        const cls = isActive
          ? `${railColour(role)} px-2.5 py-1 rounded-full text-xs font-semibold`
          : 'px-2.5 py-1 rounded-full text-xs text-zinc-600 dark:text-zinc-400 hover:bg-zinc-100 dark:hover:bg-zinc-900';
        const labelKey: Record<UserRole, string> = {
          admin: tr.console.role_admin_pill,
          moderator: tr.console.role_moderator_pill,
          expert: tr.console.role_expert_pill,
          researcher: '',
        };
        return (
          <a href={pillHref(role)} class={cls}>{labelKey[role]}</a>
        );
      })}
    </nav>
    <div class="ml-auto flex items-center gap-3 text-xs text-zinc-600 dark:text-zinc-400">
      <span>{identity.username ?? ''}</span>
      <a href={exitHref} class="hover:underline">↩ {tr.console.exit}</a>
    </div>
  </header>

  <div class="flex flex-1 min-h-0">
    <ConsoleSidebar
      lang={lang}
      activeRole={activeRole}
      allRoles={allRoles}
      currentPath={currentPath}
    />
    <main class="flex-1 overflow-y-auto p-4 md:p-6">
      <slot />
    </main>
  </div>
</div>
```

- [ ] **Step 3: Build to verify Astro parses**

```bash
npm run build
```

Expected: build succeeds. (No pages yet consume the layout, so there's nothing to render.)

- [ ] **Step 4: Commit**

```bash
git add src/components/ConsoleLayout.astro src/components/ConsoleSidebar.astro
git commit -m "feat(console): chrome shell — layout + sidebar

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 11: `admin` Edge Function — shared helpers

**Files:**
- Create: `supabase/functions/admin/_shared/auth.ts`
- Create: `supabase/functions/admin/_shared/audit.ts`

- [ ] **Step 1: Create `auth.ts`**

```ts
/**
 * Verifies the caller's Supabase JWT and loads their active roles in one
 * round trip. Returns a typed actor or throws an HTTP-shaped error.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type UserRole = 'admin' | 'moderator' | 'expert' | 'researcher';

export interface Actor {
  id: string;
  roles: Set<UserRole>;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function verifyJwtAndLoadRoles(req: Request): Promise<Actor> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) throw new HttpError(401, 'missing bearer token');
  const jwt = auth.slice(7);

  // Anon-key client just for JWT validation.
  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userRes.user) throw new HttpError(401, 'invalid token');

  // Service-role client to read user_roles bypassing the no-write RLS
  // (the user_roles_admin_or_self_read policy actually allows it, but
  //  service role saves a JOIN through has_role()).
  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: rows, error: rolesErr } = await adminClient
    .from('user_roles')
    .select('role, revoked_at')
    .eq('user_id', userRes.user.id);
  if (rolesErr) throw new HttpError(500, rolesErr.message);

  const now = Date.now();
  const roles = new Set<UserRole>(
    (rows ?? [])
      .filter(r => !r.revoked_at || new Date(r.revoked_at).getTime() > now)
      .map(r => r.role as UserRole),
  );

  return { id: userRes.user.id, roles };
}

export function requireRole(actor: Actor, required: UserRole): void {
  if (!actor.roles.has(required)) {
    throw new HttpError(403, `requires ${required}`);
  }
}
```

- [ ] **Step 2: Create `audit.ts`**

```ts
/**
 * insertAuditRow — single-purpose helper that writes to public.admin_audit
 * using the service-role client passed in by the caller. Always called
 * inside the same logical "transaction" as the mutation (Supabase JS does
 * not expose true transactions, so we trade atomicity for ordering: the
 * audit row is inserted last; if the mutation succeeded we record it,
 * if the audit insert fails we must reverse the mutation explicitly. Each
 * handler encodes the reversal contract).
 *
 * For PR1 the only mutations are upserts to user_roles, which are themselves
 * idempotent — a re-run on retry is harmless. PR2+ handlers that touch
 * non-idempotent state must define an explicit rollback.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type AuditOp =
  | 'role_grant' | 'role_revoke'
  | 'user_ban' | 'user_unban' | 'user_delete'
  | 'observation_hide' | 'observation_unhide'
  | 'observation_obscure' | 'observation_force_unobscure'
  | 'observation_license_override' | 'observation_hard_delete'
  | 'comment_hide' | 'comment_lock' | 'comment_unlock'
  | 'badge_award_manual' | 'badge_revoke'
  | 'token_force_revoke'
  | 'feature_flag_toggle'
  | 'cron_force_run'
  | 'precise_coords_read'
  | 'user_pii_read'
  | 'token_list_read'
  | 'user_audit_read';

export interface AuditRow {
  actor_id: string;
  op: AuditOp;
  target_type?: string;
  target_id?: string;
  before?: unknown;
  after?: unknown;
  reason: string;
  ip?: string | null;
  user_agent?: string | null;
}

export async function insertAuditRow(
  admin: SupabaseClient,
  row: AuditRow,
): Promise<number> {
  const { data, error } = await admin
    .from('admin_audit')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`audit insert failed: ${error.message}`);
  return (data as { id: number }).id;
}
```

- [ ] **Step 3: Commit**

```bash
git add supabase/functions/admin/_shared/auth.ts supabase/functions/admin/_shared/audit.ts
git commit -m "feat(admin-fn): shared auth + audit helpers

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 12: `admin` Edge Function — handler interface and `role-grant.ts`

**Files:**
- Create: `supabase/functions/admin/handlers/role-grant.ts`

- [ ] **Step 1: Define the handler shape and implement role.grant**

```ts
import { createClient, type SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { z } from 'https://esm.sh/zod@3.23.8';
import type { Actor, UserRole } from '../_shared/auth.ts';
import type { AuditOp } from '../_shared/audit.ts';

export interface ActionResult {
  before: unknown;
  after: unknown;
  target: { type: string; id: string };
  result?: unknown;  // for sensitive_read.* handlers
}

export interface ActionHandler<TPayload = unknown> {
  op: AuditOp;
  requiredRole: UserRole;
  payloadSchema: z.ZodType<TPayload>;
  execute: (admin: SupabaseClient, payload: TPayload, actor: Actor) => Promise<ActionResult>;
}

const RoleGrantPayload = z.object({
  target_user_id: z.string().uuid(),
  role: z.enum(['admin', 'moderator', 'expert', 'researcher']),
  expires_at: z.string().datetime().optional(),
});
type RoleGrantPayload = z.infer<typeof RoleGrantPayload>;

export const roleGrantHandler: ActionHandler<RoleGrantPayload> = {
  op: 'role_grant',
  requiredRole: 'admin',
  payloadSchema: RoleGrantPayload,
  async execute(admin, payload, actor) {
    const { data: before } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', payload.target_user_id);

    const { error } = await admin
      .from('user_roles')
      .upsert({
        user_id: payload.target_user_id,
        role: payload.role,
        granted_at: new Date().toISOString(),
        granted_by: actor.id,
        revoked_at: payload.expires_at ?? null,
      }, { onConflict: 'user_id,role' });
    if (error) throw new Error(`role.grant: ${error.message}`);

    const { data: after } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', payload.target_user_id);

    return {
      before,
      after,
      target: { type: 'user', id: payload.target_user_id },
    };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/admin/handlers/role-grant.ts
git commit -m "feat(admin-fn): role.grant handler

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 13: `role-revoke.ts` handler

**Files:**
- Create: `supabase/functions/admin/handlers/role-revoke.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const RoleRevokePayload = z.object({
  target_user_id: z.string().uuid(),
  role: z.enum(['admin', 'moderator', 'expert', 'researcher']),
});
type RoleRevokePayload = z.infer<typeof RoleRevokePayload>;

export const roleRevokeHandler: ActionHandler<RoleRevokePayload> = {
  op: 'role_revoke',
  requiredRole: 'admin',
  payloadSchema: RoleRevokePayload,
  async execute(admin, payload, _actor) {
    const { data: before } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', payload.target_user_id)
      .eq('role', payload.role)
      .single();

    if (!before) {
      // Nothing to revoke; treat as a no-op but still audit.
      return {
        before: null,
        after: null,
        target: { type: 'user', id: payload.target_user_id },
      };
    }

    const { error } = await admin
      .from('user_roles')
      .update({ revoked_at: new Date().toISOString() })
      .eq('user_id', payload.target_user_id)
      .eq('role', payload.role);
    if (error) throw new Error(`role.revoke: ${error.message}`);

    const { data: after } = await admin
      .from('user_roles')
      .select('*')
      .eq('user_id', payload.target_user_id)
      .eq('role', payload.role)
      .single();

    return {
      before,
      after,
      target: { type: 'user', id: payload.target_user_id },
    };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/admin/handlers/role-revoke.ts
git commit -m "feat(admin-fn): role.revoke handler

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 14: `sensitive-read-user-audit.ts` handler

**Files:**
- Create: `supabase/functions/admin/handlers/sensitive-read-user-audit.ts`

- [ ] **Step 1: Implement**

```ts
import { z } from 'https://esm.sh/zod@3.23.8';
import type { ActionHandler } from './role-grant.ts';

const Payload = z.object({
  target_user_id: z.string().uuid(),
  limit: z.number().int().min(1).max(500).default(100),
});
type Payload = z.infer<typeof Payload>;

export const sensitiveReadUserAuditHandler: ActionHandler<Payload> = {
  op: 'user_audit_read',
  requiredRole: 'admin',
  payloadSchema: Payload,
  async execute(admin, payload, _actor) {
    const { data, error } = await admin
      .from('admin_audit')
      .select('*')
      .or(`actor_id.eq.${payload.target_user_id},target_id.eq.${payload.target_user_id}`)
      .order('created_at', { ascending: false })
      .limit(payload.limit);
    if (error) throw new Error(`user_audit_read: ${error.message}`);

    return {
      before: null,
      after: null,
      target: { type: 'user', id: payload.target_user_id },
      result: data ?? [],
    };
  },
};
```

- [ ] **Step 2: Commit**

```bash
git add supabase/functions/admin/handlers/sensitive-read-user-audit.ts
git commit -m "feat(admin-fn): sensitive_read.user_audit handler

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 15: Handler lookup table + dispatcher entry point

**Files:**
- Create: `supabase/functions/admin/handlers/index.ts`
- Create: `supabase/functions/admin/index.ts`

- [ ] **Step 1: Create `handlers/index.ts`**

```ts
import { roleGrantHandler } from './role-grant.ts';
import { roleRevokeHandler } from './role-revoke.ts';
import { sensitiveReadUserAuditHandler } from './sensitive-read-user-audit.ts';
import type { ActionHandler } from './role-grant.ts';

export const HANDLERS: Record<string, ActionHandler<unknown>> = {
  'role.grant': roleGrantHandler as unknown as ActionHandler<unknown>,
  'role.revoke': roleRevokeHandler as unknown as ActionHandler<unknown>,
  'sensitive_read.user_audit': sensitiveReadUserAuditHandler as unknown as ActionHandler<unknown>,
};
```

- [ ] **Step 2: Create the dispatcher `index.ts`**

```ts
/**
 * /functions/v1/admin — privileged-actions dispatcher.
 *
 * Auth: Supabase user JWT (Authorization: Bearer …). The function
 * re-verifies the JWT, loads the caller's active roles from user_roles,
 * checks the action's required role, executes the handler, and writes
 * an admin_audit row. PR1 ships three handlers (role.grant, role.revoke,
 * sensitive_read.user_audit). Adding a new action = one handler file +
 * one entry in handlers/index.ts.
 *
 * Reason field is mandatory; minimum 5 chars enforced here.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyJwtAndLoadRoles, requireRole, HttpError } from './_shared/auth.ts';
import { insertAuditRow } from './_shared/audit.ts';
import { HANDLERS } from './handlers/index.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { action?: string; payload?: unknown; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { action, payload, reason } = body;
  if (!action || typeof action !== 'string') return json({ error: 'action required' }, 400);
  if (!reason || typeof reason !== 'string' || reason.length < 5) {
    return json({ error: 'reason required (min 5 chars)' }, 400);
  }

  const handler = HANDLERS[action];
  if (!handler) return json({ error: `unknown action: ${action}` }, 400);

  try {
    const actor = await verifyJwtAndLoadRoles(req);
    requireRole(actor, handler.requiredRole);

    const parsed = handler.payloadSchema.safeParse(payload);
    if (!parsed.success) return json({ error: 'invalid payload', issues: parsed.error.issues }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const result = await handler.execute(admin, parsed.data, actor);

    const auditId = await insertAuditRow(admin, {
      actor_id: actor.id,
      op: handler.op,
      target_type: result.target.type,
      target_id: result.target.id,
      before: result.before ?? null,
      after: result.after ?? null,
      reason,
      ip: req.headers.get('x-forwarded-for'),
      user_agent: req.headers.get('user-agent'),
    });

    return json({ ok: true, audit_id: auditId, result: result.result, after: result.after });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
});
```

- [ ] **Step 3: Smoke-deploy locally** (optional — Deno typecheck only)

```bash
deno check supabase/functions/admin/index.ts
```

Expected: clean check.

- [ ] **Step 4: Commit**

```bash
git add supabase/functions/admin/handlers/index.ts supabase/functions/admin/index.ts
git commit -m "feat(admin-fn): dispatcher entry + handler lookup

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 16: `admin-client.ts` typed SDK

**Files:**
- Create: `src/lib/admin-client.ts`
- Test: `tests/lib/admin-client.test.ts`

- [ ] **Step 1: Write failing test**

Create `tests/lib/admin-client.test.ts`:

```ts
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { adminClient, AdminClientError } from '../../src/lib/admin-client';

const PROJECT_URL = 'https://example.supabase.co';
beforeEach(() => {
  vi.stubGlobal('fetch', vi.fn());
  vi.stubEnv('PUBLIC_SUPABASE_URL', PROJECT_URL);
});

describe('adminClient', () => {
  it('posts to /functions/v1/admin with action + payload + reason', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: true,
      status: 200,
      json: async () => ({ ok: true, audit_id: 42, after: { foo: 'bar' } }),
    });
    const out = await adminClient.role.grant(
      { target_user_id: '00000000-0000-0000-0000-000000000001', role: 'expert' },
      'reason here',
      'jwt-token',
    );
    expect(out.audit_id).toBe(42);
    expect(globalThis.fetch).toHaveBeenCalledTimes(1);
    const [url, init] = (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mock.calls[0];
    expect(url).toBe(`${PROJECT_URL}/functions/v1/admin`);
    expect((init as RequestInit).method).toBe('POST');
    expect((init as RequestInit).headers).toMatchObject({ Authorization: 'Bearer jwt-token' });
    const body = JSON.parse((init as RequestInit).body as string);
    expect(body.action).toBe('role.grant');
    expect(body.reason).toBe('reason here');
  });

  it('throws AdminClientError on non-200', async () => {
    (globalThis.fetch as unknown as ReturnType<typeof vi.fn>).mockResolvedValueOnce({
      ok: false, status: 403,
      json: async () => ({ error: 'requires admin' }),
    });
    await expect(
      adminClient.role.revoke(
        { target_user_id: '00000000-0000-0000-0000-000000000001', role: 'expert' },
        'reason here', 'jwt-token',
      ),
    ).rejects.toBeInstanceOf(AdminClientError);
  });
});
```

- [ ] **Step 2: Run — must fail**

```bash
npx vitest run tests/lib/admin-client.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement**

Create `src/lib/admin-client.ts`:

```ts
import type { UserRole } from './types';

export class AdminClientError extends Error {
  constructor(public status: number, message: string, public detail?: unknown) {
    super(message);
  }
}

interface RoleGrantPayload {
  target_user_id: string;
  role: UserRole;
  expires_at?: string;
}
interface RoleRevokePayload {
  target_user_id: string;
  role: UserRole;
}
interface SensitiveReadUserAuditPayload {
  target_user_id: string;
  limit?: number;
}

interface DispatcherResponse<T = unknown> {
  ok: true;
  audit_id: number;
  result?: T;
  after?: unknown;
}

async function call<T = unknown>(
  action: string,
  payload: unknown,
  reason: string,
  jwt: string,
): Promise<DispatcherResponse<T>> {
  const url = `${import.meta.env.PUBLIC_SUPABASE_URL}/functions/v1/admin`;
  const res = await fetch(url, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      Authorization: `Bearer ${jwt}`,
    },
    body: JSON.stringify({ action, payload, reason }),
  });
  let body: unknown = null;
  try { body = await res.json(); } catch { /* empty */ }
  if (!res.ok) {
    const msg = (body as { error?: string })?.error ?? `HTTP ${res.status}`;
    throw new AdminClientError(res.status, msg, body);
  }
  return body as DispatcherResponse<T>;
}

export const adminClient = {
  role: {
    grant: (payload: RoleGrantPayload, reason: string, jwt: string) =>
      call('role.grant', payload, reason, jwt),
    revoke: (payload: RoleRevokePayload, reason: string, jwt: string) =>
      call('role.revoke', payload, reason, jwt),
  },
  sensitiveRead: {
    userAudit: (payload: SensitiveReadUserAuditPayload, reason: string, jwt: string) =>
      call<unknown[]>('sensitive_read.user_audit', payload, reason, jwt),
  },
};
```

- [ ] **Step 4: Run — must pass**

```bash
npx vitest run tests/lib/admin-client.test.ts
npm run typecheck
```

Expected: both green.

- [ ] **Step 5: Commit**

```bash
git add src/lib/admin-client.ts tests/lib/admin-client.test.ts
git commit -m "feat(admin-client): typed SDK for the admin Edge Function

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 17: Console Overview tab

**Files:**
- Create: `src/components/ConsoleOverviewView.astro`
- Create: `src/pages/en/console/index.astro`
- Create: `src/pages/es/consola/index.astro`

- [ ] **Step 1: Create the view component**

```astro
---
/**
 * ConsoleOverviewView — action-primary alerts on the left, slim KPI rail on
 * the right. PR1 renders an empty-state shell; queries land in PR3 (sync,
 * api, cron) and PR4 (flags, expert apps badge).
 */
import { t } from '../i18n/utils';

interface Props { lang: 'en' | 'es' }
const { lang } = Astro.props;
const tr = t(lang);
---

<div class="grid grid-cols-1 md:grid-cols-[1fr_220px] gap-4 max-w-5xl">
  <section>
    <h2 class="text-sm font-semibold text-zinc-700 dark:text-zinc-300 mb-3">
      {tr.console.overview_alerts_heading}
    </h2>
    <div id="console-overview-alerts" class="space-y-2">
      <div class="rounded-md border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-sm text-zinc-500">
        {tr.console.overview_no_alerts}
      </div>
    </div>
  </section>
  <aside class="md:border-l md:border-zinc-200 md:dark:border-zinc-800 md:pl-4">
    <h2 class="text-[10px] font-semibold uppercase tracking-wide text-zinc-500 mb-2">
      {tr.console.overview_at_a_glance}
    </h2>
    <dl id="console-overview-kpis" class="space-y-1 text-xs text-zinc-700 dark:text-zinc-300">
      <div class="flex justify-between"><dt class="text-zinc-500">—</dt><dd>—</dd></div>
    </dl>
  </aside>
</div>
```

- [ ] **Step 2: Create the EN page**

`src/pages/en/console/index.astro`:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import ConsoleLayout from '../../../components/ConsoleLayout.astro';
import ConsoleOverviewView from '../../../components/ConsoleOverviewView.astro';
import { getUserRoles } from '../../../lib/user-roles';
import { rolePillsFor } from '../../../lib/console-tabs';
import { getSupabase } from '../../../lib/supabase';
import type { UserRole } from '../../../lib/types';

const lang = 'en';
const url = new URL(Astro.request.url);
const requestedRole = (url.searchParams.get('role') as UserRole | null) ?? null;
---

<BaseLayout lang={lang} title="Console">
  <div id="console-gate" class="p-6 text-sm text-zinc-600 dark:text-zinc-400">
    Loading…
  </div>
  <div id="console-shell" class="hidden">
    <!-- Server-side roles unknown until client auth resolves; the shell
         re-renders client-side once the Supabase session loads. -->
  </div>
</BaseLayout>

<script>
  import { getSupabase } from '../../../lib/supabase';
  import { getUserRoles } from '../../../lib/user-roles';
  import { rolePillsFor } from '../../../lib/console-tabs';

  async function init() {
    const gate = document.getElementById('console-gate')!;
    const shell = document.getElementById('console-shell')!;
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) {
      gate.textContent = 'Sign in required.';
      return;
    }
    const roles = await getUserRoles(user.id);
    if (roles.size === 0) {
      gate.textContent = 'You do not have console access.';
      return;
    }
    const pills = rolePillsFor(roles);
    const requestedRole = new URL(window.location.href).searchParams.get('role');
    const activeRole = (requestedRole && (roles.has(requestedRole as never)) ? requestedRole : pills[0]) as never;
    // Render is server-driven via Astro for the shell; we just need to
    // confirm authz client-side. Reload with the active role param set
    // so the SSR shell can pick it up next paint.
    if (!requestedRole && pills[0] !== 'admin') {
      const u = new URL(window.location.href);
      u.searchParams.set('role', String(activeRole));
      window.location.replace(u.toString());
      return;
    }
    gate.classList.add('hidden');
    shell.classList.remove('hidden');
    // Future: hydrate alerts + KPIs by calling sensitive_read endpoints.
  }
  init().catch(err => {
    document.getElementById('console-gate')!.textContent = 'Error: ' + (err as Error).message;
  });
</script>
```

NOTE: this minimal client-side gate is a v1 compromise. PR2 introduces a proper SSR-with-cookie path so the role check happens server-side (`Astro.locals` + middleware). Documented in the spec's "Open questions" section as future cleanup.

- [ ] **Step 3: Create the ES mirror**

`src/pages/es/consola/index.astro` — same as EN, but `lang = 'es'` and adjust import paths to walk up `../../../`. Keep all logic identical.

- [ ] **Step 4: Build to verify routes resolve**

```bash
npm run build
```

Expected: build succeeds, both `/en/console/` and `/es/consola/` listed in the page count output.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConsoleOverviewView.astro src/pages/en/console/index.astro src/pages/es/consola/index.astro
git commit -m "feat(console): overview tab (empty-state shell)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 18: Move `AdminExpertsView` into the console

**Files:**
- Create: `src/pages/en/console/experts/index.astro`
- Create: `src/pages/es/consola/expertos/index.astro`
- Modify: `src/components/AdminExpertsView.astro` (swap gate from `is_expert` to `has_role(admin)`)

- [ ] **Step 1: Update the gate in `AdminExpertsView.astro`**

Find the existing client-side script block (around lines 196-206 of the file) and replace this:

```ts
    const { data: me } = await supabase
      .from('users')
      .select('is_expert')
      .eq('id', user.id)
      .maybeSingle<{ is_expert: boolean | null }>();
    if (!me?.is_expert) {
      hide('admin-loading');
      show('admin-not-auth');
      return;
    }
```

With:

```ts
    const { data: roleRows } = await supabase
      .from('user_roles')
      .select('role, revoked_at')
      .eq('user_id', user.id);
    const now = Date.now();
    const isAdmin = (roleRows ?? []).some(r =>
      r.role === 'admin' && (!r.revoked_at || new Date(r.revoked_at).getTime() > now)
    );
    if (!isAdmin) {
      hide('admin-loading');
      show('admin-not-auth');
      return;
    }
```

Also update the JSDoc comment block at the top of the file to reflect the gate is now `has_role(auth.uid(), 'admin')` directly via the table read.

- [ ] **Step 2: Create the EN console route**

`src/pages/en/console/experts/index.astro`:

```astro
---
import BaseLayout from '../../../../layouts/BaseLayout.astro';
import AdminExpertsView from '../../../../components/AdminExpertsView.astro';
const lang = 'en';
---
<BaseLayout lang={lang} title="Experts — Console">
  <AdminExpertsView lang={lang} />
</BaseLayout>
```

- [ ] **Step 3: Create the ES mirror**

`src/pages/es/consola/expertos/index.astro` — same as EN but `lang = 'es'`.

- [ ] **Step 4: Replace old route with redirect**

Overwrite `src/pages/en/profile/admin/experts/index.astro` with:

```astro
---
return Astro.redirect('/en/console/experts/', 308);
---
```

Same for `src/pages/es/perfil/admin/expertos/index.astro` with `/es/consola/expertos/`.

- [ ] **Step 5: Build to verify both routes resolve**

```bash
npm run build
```

Expected: 4 new routes (2 console pages + 2 redirect pages); build clean.

- [ ] **Step 6: Commit**

```bash
git add src/pages/en/console/experts/index.astro src/pages/es/consola/expertos/index.astro \
       src/pages/en/profile/admin/experts/index.astro src/pages/es/perfil/admin/expertos/index.astro \
       src/components/AdminExpertsView.astro
git commit -m "feat(console): move experts queue to /console/experts/ + 308 redirect old path

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 19: Audit log tab

**Files:**
- Create: `src/components/ConsoleAuditLogView.astro`
- Create: `src/pages/en/console/audit/index.astro`
- Create: `src/pages/es/consola/auditoria/index.astro`

- [ ] **Step 1: Create `ConsoleAuditLogView.astro`**

```astro
---
/**
 * ConsoleAuditLogView — hybrid timeline + filter pills + JSONB diff drill-down.
 * PR1 ships a basic browse view: render the last 100 admin_audit rows grouped
 * by day with click-to-expand. Filter pills + URL-state + CSV export land in PR3
 * (when sync_failures and api_usage tabs share the table-with-filters pattern).
 */
import { t } from '../i18n/utils';
interface Props { lang: 'en' | 'es' }
const { lang } = Astro.props;
const tr = t(lang);
---

<section class="max-w-5xl">
  <h1 class="text-xl font-semibold mb-4">{tr.console.audit}</h1>
  <div id="audit-not-auth" class="hidden rounded border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-900/20 p-3 text-sm text-amber-900 dark:text-amber-100">
    {tr.console.not_authorized}
  </div>
  <div id="audit-loading" class="text-sm text-zinc-500 italic">{tr.console.loading}</div>
  <div id="audit-rows" class="hidden space-y-2"></div>
  <p id="audit-error" class="hidden mt-3 text-sm text-red-600 dark:text-red-400"></p>
</section>

<script>
  import { getSupabase } from '../lib/supabase';

  type Row = {
    id: number;
    actor_id: string;
    op: string;
    target_type: string | null;
    target_id: string | null;
    before: unknown;
    after: unknown;
    reason: string;
    created_at: string;
  };

  function show(id: string) { document.getElementById(id)?.classList.remove('hidden'); }
  function hide(id: string) { document.getElementById(id)?.classList.add('hidden'); }
  function escapeHtml(s: string): string {
    return s.replace(/[<>&'"]/g, c => ({'<':'&lt;','>':'&gt;','&':'&amp;',"'":'&#39;','"':'&quot;'}[c]!));
  }

  async function load() {
    const supabase = getSupabase();
    const { data: { user } } = await supabase.auth.getUser();
    if (!user) { hide('audit-loading'); show('audit-not-auth'); return; }

    const { data, error } = await supabase
      .from('admin_audit')
      .select('*')
      .order('created_at', { ascending: false })
      .limit(100);

    if (error) {
      hide('audit-loading');
      const e = document.getElementById('audit-error')!;
      e.textContent = error.message; e.classList.remove('hidden');
      return;
    }
    const rows = (data ?? []) as Row[];
    if (rows.length === 0) {
      hide('audit-loading');
      const wrap = document.getElementById('audit-rows')!;
      wrap.innerHTML = '<div class="rounded border border-dashed border-zinc-300 dark:border-zinc-700 p-4 text-sm text-zinc-500">No audit entries yet.</div>';
      wrap.classList.remove('hidden');
      return;
    }

    const wrap = document.getElementById('audit-rows')!;
    wrap.innerHTML = rows.map(r => `
      <details class="rounded border border-zinc-200 dark:border-zinc-800 p-3 text-sm">
        <summary class="flex justify-between cursor-pointer">
          <span><span class="font-mono text-xs text-zinc-500">${escapeHtml(r.created_at)}</span>
                <span class="ml-2 font-semibold">${escapeHtml(r.op)}</span>
                <span class="ml-2 text-zinc-600 dark:text-zinc-400">${escapeHtml(r.target_type ?? '')}/${escapeHtml(r.target_id ?? '')}</span></span>
          <span class="text-xs text-zinc-500">#${r.id}</span>
        </summary>
        <div class="mt-2 text-xs text-zinc-700 dark:text-zinc-300">
          <div class="mb-1"><strong>Reason:</strong> ${escapeHtml(r.reason)}</div>
          <div class="grid grid-cols-2 gap-2">
            <pre class="bg-zinc-50 dark:bg-zinc-900 p-2 rounded overflow-x-auto"><code>${escapeHtml(JSON.stringify(r.before, null, 2))}</code></pre>
            <pre class="bg-zinc-50 dark:bg-zinc-900 p-2 rounded overflow-x-auto"><code>${escapeHtml(JSON.stringify(r.after, null, 2))}</code></pre>
          </div>
        </div>
      </details>
    `).join('');
    hide('audit-loading');
    show('audit-rows');
  }
  load().catch(err => {
    hide('audit-loading');
    const e = document.getElementById('audit-error')!;
    e.textContent = (err as Error).message; e.classList.remove('hidden');
  });
</script>
```

- [ ] **Step 2: Create EN page**

`src/pages/en/console/audit/index.astro`:

```astro
---
import BaseLayout from '../../../../layouts/BaseLayout.astro';
import ConsoleAuditLogView from '../../../../components/ConsoleAuditLogView.astro';
const lang = 'en';
---
<BaseLayout lang={lang} title="Audit log — Console">
  <ConsoleAuditLogView lang={lang} />
</BaseLayout>
```

- [ ] **Step 3: Create ES mirror**

`src/pages/es/consola/auditoria/index.astro` — same with `lang = 'es'`.

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: routes appear, build clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/ConsoleAuditLogView.astro src/pages/en/console/audit/index.astro src/pages/es/consola/auditoria/index.astro
git commit -m "feat(console): audit log tab (basic browse + diff drill-down)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 20: Header pill + MobileDrawer entry (visible only when role-holder)

**Files:**
- Modify: `src/components/Header.astro`
- Modify: `src/components/MobileDrawer.astro`

- [ ] **Step 1: Add the pill to `Header.astro`**

Locate the existing nav element (verb-first chrome). Add a new conditional pill near the user-account block, gated client-side because the layout doesn't have access to the user session at SSR time:

```astro
<a id="header-console-pill"
   href={getLocalizedPath(lang, routes.console[lang] + '/')}
   class="hidden text-xs px-2.5 py-1 rounded-full text-slate-700 dark:text-slate-300 hover:bg-slate-100 dark:hover:bg-slate-800/40">
  {tr.console.nav}
</a>
```

In the existing client-side header script (or add a new `<script>` block at the bottom):

```ts
import { getSupabase } from '../lib/supabase';
import { getUserRoles } from '../lib/user-roles';

async function maybeShowConsolePill() {
  const pill = document.getElementById('header-console-pill');
  if (!pill) return;
  try {
    const { data: { user } } = await getSupabase().auth.getUser();
    if (!user) return;
    const roles = await getUserRoles(user.id);
    if (roles.size > 0) pill.classList.remove('hidden');
  } catch { /* silent */ }
}
maybeShowConsolePill();
```

- [ ] **Step 2: Add the entry to `MobileDrawer.astro`**

Add a similar conditional `<a>` for the mobile drawer with the same client-side gating logic (or call the same helper).

```astro
<a id="mobile-console-link"
   href={getLocalizedPath(lang, routes.console[lang] + '/')}
   class="hidden block px-3 py-2 text-sm rounded hover:bg-zinc-100 dark:hover:bg-zinc-900">
  {tr.console.nav}
</a>
```

In the drawer's existing client-side script, dual-toggle: `document.getElementById('mobile-console-link')?.classList.remove('hidden')` when `roles.size > 0`.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: clean. The pill is hidden by default; visible only after JS hydrates and roles resolve.

- [ ] **Step 4: Commit**

```bash
git add src/components/Header.astro src/components/MobileDrawer.astro
git commit -m "feat(chrome): conditional console pill (header + mobile drawer)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 21: E2E smoke test

**Files:**
- Create: `tests/e2e/console-smoke.spec.ts`

- [ ] **Step 1: Write the smoke test**

```ts
import { test, expect } from '@playwright/test';

test.describe('console — smoke', () => {
  test('/en/console/ redirects unauth user to gate (sign-in required)', async ({ page }) => {
    await page.goto('/en/console/');
    await expect(page.locator('#console-gate')).toContainText(/sign in/i);
  });

  test('/es/consola/ renders with ES locale', async ({ page }) => {
    await page.goto('/es/consola/');
    await expect(page.locator('#console-gate')).toBeVisible();
    // The gate text in ES — depending on the user-state fall-through; both
    // strings are acceptable for the smoke check.
    const txt = await page.locator('#console-gate').textContent();
    expect(txt).toBeTruthy();
  });

  test('/en/profile/admin/experts/ 308-redirects to /en/console/experts/', async ({ page }) => {
    const res = await page.goto('/en/profile/admin/experts/');
    // Astro static redirect renders an HTML meta-refresh → final URL on the page object.
    expect(page.url()).toContain('/en/console/experts/');
  });

  test('Header has no console pill for an unauth visitor', async ({ page }) => {
    await page.goto('/en/');
    const pill = page.locator('#header-console-pill');
    await expect(pill).toHaveClass(/hidden/);
  });
});
```

- [ ] **Step 2: Run the e2e suite**

```bash
npm run test:e2e -- tests/e2e/console-smoke.spec.ts
```

Expected: all 4 tests green on chromium and mobile-chrome projects.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/console-smoke.spec.ts
git commit -m "test(e2e): console chrome + redirect smoke

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 22: Module spec 24

**Files:**
- Create: `docs/specs/modules/24-admin-console.md`
- Modify: `docs/specs/modules/00-index.md`

- [ ] **Step 1: Author the module spec**

Create `docs/specs/modules/24-admin-console.md`. The structure follows the existing module-spec pattern (`07-licensing.md` is the template). Keep this short — it points at the brainstorm spec for design rationale and focuses on the canonical implementation reference.

```markdown
# Module 24 — Admin / Moderator / Expert Console

> **Target:** v1.1 → v1.2 (phased; PR1 = foundation)
> **Status:** Phase 1 (foundation) shipping
> **Design rationale:** [`docs/superpowers/specs/2026-04-27-admin-console-design.md`](../../superpowers/specs/2026-04-27-admin-console-design.md)
> **Implementation plan PR1:** [`docs/superpowers/plans/2026-04-27-admin-console-pr1-foundation.md`](../../superpowers/plans/2026-04-27-admin-console-pr1-foundation.md)

## Overview

A privileged-actions console under a new `'console'` chrome mode. Three role
tiers (admin, moderator, expert), all sharing one shell with role pills.
Reads go through RLS predicates keyed on `has_role(uid, role)`. Writes
route through one `admin` Edge Function dispatcher that atomically inserts
an `admin_audit` row.

## Data model

See `docs/specs/infra/supabase-schema.sql` for canonical SQL. Tables:

- `public.user_roles` — `(user_id, role)` join with audit columns
- `public.admin_audit` — append-style record of every privileged write + sensitive read
- `public.user_role` enum — `admin | moderator | expert | researcher`
- `public.audit_op` enum — see schema for full list
- `public.has_role(uuid, user_role)` SQL function used by every RLS predicate

## API / logic

- Browser → `/functions/v1/admin` via `src/lib/admin-client.ts`
- Edge Function dispatcher at `supabase/functions/admin/index.ts`
- Per-action handlers under `supabase/functions/admin/handlers/`
- Each handler declares `op`, `requiredRole`, `payloadSchema`, `execute`
- The dispatcher re-verifies the JWT, enforces the role, validates the
  payload, runs the handler, inserts the audit row, returns `{ok, audit_id}`.

## Edge cases

- Reason field minimum 5 chars; enforced at the dispatcher (HTTP 400).
- Soft-revoke vs hard-delete: revokes set `revoked_at` to keep history.
  PR2's bulk-archive job is the only path that hard-deletes (TBD).
- The trigger keeps `users.is_expert` and `users.credentialed_researcher`
  in sync; consensus computation and the `obs_credentialed_read` RLS
  policy continue to read those columns hot-path.

## Cost / risk

- Storage: bounded — audit rows are small (≤ 1KB typical) and ops volume
  is tiny at this scale.
- Privacy: sensitive reads are auditable per the privacy promise around
  NOM-059/CITES coords. See `docs/runbooks/admin-audit.md`.

## Data stored

- `user_roles`: one row per active grant per user per role.
- `admin_audit`: one row per privileged write or sensitive read.
- No PII beyond what already exists in `users` / `observations`.

## Phasing

- **PR1 (this):** schema + chrome + Edge Function skeleton + 3 working tabs.
- **PR2:** Users, Credentials, Expert console.
- **PR3:** Sync, API, Cron, Moderator console.
- **PR4+:** Badges editor, Karma tuning, Feature flags, etc. — on demand.

Each PR closes its own documentation deliverables row before merge.
```

- [ ] **Step 2: Add row to `00-index.md`**

In the v1.0 / Public-launch section (or a new v1.1 section), add:

```markdown
| 24 | Admin / Moderator / Expert Console | v1.1 → v1.2 | partial (PR1 foundation shipping) | [`24-admin-console.md`](24-admin-console.md) |
```

- [ ] **Step 3: Commit**

```bash
git add docs/specs/modules/24-admin-console.md docs/specs/modules/00-index.md
git commit -m "docs(spec): module 24 — admin console

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 23: Role-model + admin-audit + admin-ops runbooks

**Files:**
- Create: `docs/runbooks/role-model.md`
- Create: `docs/runbooks/admin-audit.md`
- Create: `docs/runbooks/admin-ops.md`

- [ ] **Step 1: Author `role-model.md`**

```markdown
# Role Model

Four roles live in `public.user_role`:

| Role | What it unlocks | Granted by | Revocable by |
|---|---|---|---|
| `admin` | Console: all admin tabs; user role grants; license overrides; feature flags | bootstrap or another admin | another admin |
| `moderator` | Console: flag queue, comment hide/lock, soft-ban, license disputes | admin | admin |
| `expert` | Consensus 3× weighting; validation queue scoped to `expert_taxa` | admin (via Experts tab) | admin |
| `researcher` | RLS gate to read precise GPS coords on obscured observations | admin (via Credentials tab — PR2) | admin |

## Multi-role

Roles are orthogonal. A single user may hold any subset (e.g., `admin` + `expert` + `researcher`). The console renders one pill per role held; sidebar contents swap based on the active pill.

## Time-bounded grants

A grant's `revoked_at` may be set to a future timestamp at creation time. The role expires automatically (handled in code via `has_role()` filtering on `revoked_at > now()`).

## Soft-revoke

Revoking a role does not delete the row — it sets `revoked_at = now()`. This preserves the historical fact "X held this role from A to B" for audit. Re-granting flips `revoked_at` back to NULL and refreshes `granted_at`.

## Bootstrap

The first admin row is inserted manually via `docs/runbooks/admin-bootstrap.md`. `granted_by IS NULL` is the unambiguous bootstrap signal.

## Denormalised flag sync

`users.is_expert` and `users.credentialed_researcher` are kept in sync with the active state of the corresponding role rows via the `user_roles_sync_flags` trigger. This is purely a hot-path optimization — the source of truth is `user_roles`.
```

- [ ] **Step 2: Author `admin-audit.md`**

```markdown
# Admin Audit Log

Every privileged write and every sensitive read produces an `admin_audit` row.

## Schema (cheat sheet)

```sql
SELECT id, actor_id, op, target_type, target_id, reason, created_at
FROM   public.admin_audit
ORDER BY created_at DESC LIMIT 50;
```

## Common queries

**"What did artemio do today?"**
```sql
SELECT created_at, op, target_type, target_id, reason
FROM   public.admin_audit
WHERE  actor_id = (SELECT id FROM public.users WHERE username = 'artemio')
  AND  created_at > now() - interval '1 day'
ORDER BY created_at DESC;
```

**"Did anyone read user X's audit log?"**
```sql
SELECT created_at, actor_id, reason
FROM   public.admin_audit
WHERE  op = 'user_audit_read' AND target_id = '<user-uuid>';
```

**"All role grants this month"**
```sql
SELECT *
FROM   public.admin_audit
WHERE  op IN ('role_grant', 'role_revoke')
  AND  created_at > date_trunc('month', now());
```

## What each `op` means

See the `audit_op` enum in `docs/specs/infra/supabase-schema.sql`. The mapping from action verb (e.g., `role.grant`) to op (e.g., `role_grant`) lives in the corresponding `supabase/functions/admin/handlers/*.ts` file.

## Retention

Indefinite for v1. If volume grows, partition monthly per `docs/specs/infra/future-migrations.md`.

## RLS

Only `has_role(auth.uid(), 'admin')` may SELECT. Inserts are service-role only (the dispatcher Edge Function).
```

- [ ] **Step 3: Author `admin-ops.md`**

```markdown
# Admin Ops Runbook (PR1)

PR1 ships three actions. Each is exposed via `src/lib/admin-client.ts`.

## role.grant

**Required role:** admin
**Audit op:** `role_grant`

```ts
import { adminClient } from '@/lib/admin-client';
const { data: { session } } = await supabase.auth.getSession();
await adminClient.role.grant(
  { target_user_id: 'uuid', role: 'expert' },
  '6 weeks active community participation',
  session!.access_token,
);
```

**Reversal:** `role.revoke` (preserves history).

## role.revoke

**Required role:** admin
**Audit op:** `role_revoke`
**Note:** sets `revoked_at = now()`. Re-granting later restores the role and clears `revoked_at`.

## sensitive_read.user_audit

**Required role:** admin
**Audit op:** `user_audit_read`
**Returns:** the last N audit rows where the named user is either actor or target.
**Note:** the read itself is logged.

## Future actions (PR2+)

User ban/unban, observation hide/license-override, comment hide/lock, badge award/revoke, token force-revoke, feature-flag toggle, cron force-run, sensitive_read.precise_coords, sensitive_read.user_pii, sensitive_read.token_list. Each lands with its own runbook section.
```

- [ ] **Step 4: Commit**

```bash
git add docs/runbooks/role-model.md docs/runbooks/admin-audit.md docs/runbooks/admin-ops.md
git commit -m "docs(runbook): role model, admin audit, admin ops (PR1 surface)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 24: User-facing Console docs page (EN/ES)

**Files:**
- Create: `src/pages/en/docs/console.md`
- Create: `src/pages/es/docs/console.md`
- Modify: `src/i18n/utils.ts` — add `console` to `docPages`

- [ ] **Step 1: Author EN page**

```markdown
---
title: "Console"
layout: "../../../layouts/DocLayout.astro"
---

# Console

The **Console** is a privileged-actions surface for users who hold an admin, moderator, or expert role. If you don't see a "Console" pill in the header, this page doesn't apply to you.

## What it's for

- **Admins** manage user roles, review researcher credentials, watch sync failures and API quotas, audit every privileged action.
- **Moderators** triage flagged content and manage soft-bans (PR3).
- **Experts** review the validation queue scoped to their taxa and watch their per-taxon expertise score (PR2).

## How it's built

See [Module 24](https://github.com/ArtemioPadilla/rastrum/blob/main/docs/specs/modules/24-admin-console.md) for the implementation reference, and the [design doc](https://github.com/ArtemioPadilla/rastrum/blob/main/docs/superpowers/specs/2026-04-27-admin-console-design.md) for rationale.
```

- [ ] **Step 2: Author ES page (same shape, translated)**

`src/pages/es/docs/console.md` — same content translated.

- [ ] **Step 3: Add to `docPages` in `src/i18n/utils.ts`**

Find the existing `docPages` array and add `'console'`. (The exact location depends on the array's current state; preserve order.)

- [ ] **Step 4: Build**

```bash
npm run build
```

Expected: 2 new doc pages render under `/en/docs/console/` and `/es/docs/console/`.

- [ ] **Step 5: Commit**

```bash
git add src/pages/en/docs/console.md src/pages/es/docs/console.md src/i18n/utils.ts
git commit -m "docs(console): user-facing explainer page (EN/ES)

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 25: Update CLAUDE.md, architecture.md, progress.json, tasks.json

**Files:**
- Modify: `CLAUDE.md`
- Modify: `docs/architecture.md`
- Modify: `docs/progress.json`
- Modify: `docs/tasks.json`

- [ ] **Step 1: Add a "Console / privileged surfaces" section to `CLAUDE.md`**

Insert under the existing **Conventions** section, after the chrome conventions block. Verbatim block:

```markdown
### Console / privileged surfaces

The `'console'` chrome mode (third value of `ChromeMode`) renders the
admin / moderator / expert dashboard at `/{en,es}/{console,consola}/*`.
Three load-bearing rules:

1. **`console-tabs.ts` is the single source of truth.** Sidebar, role
   pills, and the route table are pure projections. Adding a tab = one
   entry. Never hand-roll a route or a sidebar item.
2. **Every privileged write goes through `supabase/functions/admin/`.**
   The dispatcher re-verifies the JWT, enforces the action's required
   role, runs the handler, and inserts an `admin_audit` row in the same
   logical commit. No direct browser-side writes to privileged tables.
3. **`has_role(uid, role)` is the RLS predicate.** Don't check
   `users.is_expert` for new privilege checks — that's a denormalised
   cache for the consensus hot-path. Use `has_role()` in any new
   policy that gates console-relevant data.

The `console` accent rail uses slate-500 (top header pill, sidebar active
state). The classes are safelisted in `tailwind.config.mjs`; adding a
new console-related accent class requires extending the safelist or
production builds will purge it.

Bootstrap docs: `docs/runbooks/admin-bootstrap.md`. Role model:
`docs/runbooks/role-model.md`. Audit log: `docs/runbooks/admin-audit.md`.
```

- [ ] **Step 2: Update `docs/architecture.md`**

Add a new H2 section titled "Console (privileged surfaces)" after the existing Authentication section. Use this content:

```markdown
## Console (privileged surfaces)

Three role tiers — admin, moderator, expert — share one chrome surface
under `/console/`. Privileged writes flow through one Edge Function with
an atomic write+audit transaction:

```
Browser ──POST {action,payload,reason}──▶ /functions/v1/admin
                                              │
                                              ├─ verifyJwtAndLoadRoles()
                                              ├─ requireRole(action.required)
                                              ├─ payloadSchema.parse()
                                              ├─ handler.execute()       ┐
                                              ├─ insertAuditRow()        ├ logical tx
                                              └─ return {audit_id}        ┘
```

RLS predicates use `has_role(auth.uid(), <role>)`. The `users.is_expert`
and `users.credentialed_researcher` columns are denormalised caches kept
in sync via `user_roles_sync_flags` trigger; consensus computation and
the `obs_credentialed_read` RLS policy continue to read those columns
on the hot path.

Phased rollout: foundation (PR1), high-pain (PR2), operator value (PR3),
on-demand (PR4+). See [Module 24](specs/modules/24-admin-console.md).
```

- [ ] **Step 3: Add roadmap item to `docs/progress.json`**

Inside the v1.1 phase `items` array, append:

```json
{
  "id": "admin-console-foundation",
  "label": "Admin/Moderator/Expert console — PR1 foundation (schema + chrome + Edge Function + Overview/Experts/Audit tabs)",
  "label_es": "Consola Admin/Moderador/Experto — PR1 base (esquema + chrome + Edge Function + tabs Resumen/Expertos/Auditoría)",
  "done": false
}
```

(Set `done: true` once this PR ships.)

- [ ] **Step 4: Append subtasks to `docs/tasks.json`**

Find the v1.1 entry (or create one if absent) and append:

```json
{
  "id": "admin-console-foundation",
  "subtasks": [
    { "id": "schema",        "label": "Schema migration: user_roles + admin_audit + has_role + sync trigger + RLS",  "label_es": "Migración: user_roles + admin_audit + has_role + trigger + RLS", "done": false },
    { "id": "chrome",        "label": "Console chrome mode + ConsoleLayout + sidebar + i18n",                          "label_es": "Modo chrome console + ConsoleLayout + sidebar + i18n",       "done": false },
    { "id": "edge-fn",       "label": "admin Edge Function dispatcher + 3 handlers (role.grant/revoke + user_audit)",  "label_es": "Edge Function admin + 3 handlers",                          "done": false },
    { "id": "tabs",          "label": "Three tabs ship: Overview, Experts (moved), Audit log",                         "label_es": "Tres tabs: Resumen, Expertos (movido), Auditoría",         "done": false },
    { "id": "redirect",      "label": "Old /profile/admin/experts/ → 308 redirect",                                    "label_es": "/profile/admin/experts/ → 308 redirect",                    "done": false },
    { "id": "docs",          "label": "Module spec 24, runbooks (bootstrap, role-model, audit, ops), CLAUDE.md update",  "label_es": "Spec módulo 24, runbooks, CLAUDE.md",                       "done": false },
    { "id": "tests",         "label": "Vitest (chrome-mode, console-tabs, admin-client) + Playwright smoke",            "label_es": "Vitest + Playwright smoke",                                "done": false }
  ]
}
```

- [ ] **Step 5: Verify build and rendered docs pages**

```bash
npm run build
```

Expected: roadmap and tasks pages re-render with the new entry visible at `/en/docs/roadmap/` and `/en/docs/tasks/`.

- [ ] **Step 6: Commit**

```bash
git add CLAUDE.md docs/architecture.md docs/progress.json docs/tasks.json
git commit -m "docs(console): CLAUDE.md + architecture + roadmap entries

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

### Task 26: Final verification — typecheck + tests + build + e2e

**Files:** none

- [ ] **Step 1: Typecheck**

```bash
npm run typecheck
```

Expected: zero errors.

- [ ] **Step 2: Unit tests**

```bash
npm run test
```

Expected: all green; the 3 new test files (chrome-mode-console, console-tabs, admin-client) execute and pass.

- [ ] **Step 3: Build**

```bash
npm run build
```

Expected: clean build; new pages listed (Console overview EN+ES, Experts EN+ES, Audit EN+ES, redirects EN+ES, docs/console EN+ES = 10 new pages).

- [ ] **Step 4: E2E**

```bash
npm run test:e2e -- tests/e2e/console-smoke.spec.ts
```

Expected: 4 cases green on chromium and mobile-chrome.

- [ ] **Step 5: Bootstrap a local admin and visit the console**

Follow `docs/runbooks/admin-bootstrap.md` against the local Supabase. Then:

```bash
make dev
```

In a browser, sign in, navigate to `/en/console/`. Expected:
- Console pill appears in header (after JS hydrates).
- `/en/console/` shows the role pills + sidebar + Overview tab with the empty-state alert.
- `/en/console/experts/` shows the moved experts queue (or "no pending applications" if the table is empty).
- `/en/console/audit/` shows audit rows from the bootstrap insert (the bootstrap row itself is not audited, but any subsequent role grant via the SDK will appear).

- [ ] **Step 6: Deploy the Edge Function**

```bash
gh workflow run deploy-functions.yml --ref main -f function=admin
gh run watch <run-id>
```

Expected: deployment succeeds.

- [ ] **Step 7: Final commit (catch-all)**

If any tweaks landed during verification, commit them now with a "polish" message.

---

## Self-review notes

- **Spec coverage:** PR1 closes Decisions table rows for: data model, RLS, audit, chrome integration, mobile, write path, phasing-PR1. PR2/3/4 rows deferred per the phased plan. UI screen 3 (Users master-detail) and screen 4 (slide-over) are *not* implemented in PR1 — those are PR2 work; the chrome shell is ready for them. Screen 5 (audit log layout) is half-implemented in PR1 (basic browse + diff drill-down); filter pills + URL-state + CSV export land in PR3.
- **Type consistency:** `UserRole` exported from `src/lib/types.ts`, imported by `console-tabs.ts`, `user-roles.ts`, `admin-client.ts`, `ConsoleLayout.astro`, `ConsoleSidebar.astro`. Same string-union throughout. Edge-Function side has its own `UserRole` literal-union in `_shared/auth.ts` (no shared file across browser/Deno boundary by convention; this matches existing functions).
- **Naming convention preserved:** Action verbs use dot-namespaced strings (`role.grant`); audit ops use underscore-cased SQL enum values (`role_grant`). Each handler declares both. Documented in the spec and in this plan.
- **Scope:** focused on PR1. PR2/3/4 plans get authored when each becomes next-priority work, per the brainstorm phasing decision.
