# Admin / Moderator / Expert Console

**Date:** 2026-04-27
**Status:** Design — pending user review
**Owner:** Artemio Padilla
**Supersedes:** the inline `AdminExpertsView` page at `/profile/admin/experts/` (its functionality moves into the new console as the "Experts" tab) and the `expert-app-admin-ui` v1.0.x roadmap item (this spec subsumes it).
**Related modules:** 04 (auth), 07 (licensing), 08 (profile/activity/gamification), 14 (user API tokens), 22 (community validation), 23 (karma + expertise).

---

## Goals

1. Replace the lone `/profile/admin/experts/` page with a **dedicated console** that surfaces every privileged action across three role tiers (admin, moderator, expert), navigable from a single conditional pill in the global header.
2. Establish a **schema-first authorization model** (`user_roles` join table + `has_role()` SQL helper) that survives feature growth without a migration each time a role is added or refined.
3. Make **every privileged write atomic with an audit row** by routing all writes through one `admin` Edge Function — RLS on its own is necessary but not sufficient because the audit insert and the mutation must commit together.
4. Capture **sensitive reads** (precise GPS coords on obscured observations, user PII, token lists) in the same audit log so the platform can answer "did anyone snoop on user X?" with evidence rather than assertion.
5. Close two concrete gaps that today require a psql shell: granting `credentialed_researcher` status, and reviewing/retrying `sync_failures`.
6. Ship as **four documented PRs** over weeks, not one omnibus PR. Foundation first; high-pain tabs second; everything else when there's a concrete user need.

## Non-goals

- A B2G dashboard for CONANP / state agencies. That's the deferred v2.0 `b2g-dashboard` item with its own audience and access model.
- A user-management surface for the operator's own personal account (token creation, profile edit). Self-serve already exists at `/profile/*`; the console only handles other-user actions.
- Realtime push to the console (e.g., live flag arrival). Polling on tab focus is sufficient for v1.
- Cross-platform admin (Android/iOS native admin views). The console is web-only; the existing PWA covers mobile usage via responsive layout.
- Replacing the Supabase Studio for ad-hoc SQL. The console is product-scoped; SQL escape hatch stays in Supabase Dashboard.

---

## Decisions captured (brainstorming outcome)

| Axis | Decision | Rationale |
|---|---|---|
| Role scope | All three roles designed at once (option A) | Single coherent shell; per-role tabs swap inside; phased rollout still possible |
| Authz model | `user_roles` join table with audit columns (option C) | Multi-role native; built-in `granted_at`/`granted_by`/`revoked_at`; soft-revoke preserves history; time-bounded grants free |
| Audit scope | Writes + sensitive reads, single table with `op` enum (option B) | Defends the privacy promise to NOM-059/CITES species; volume bounded; one schema is simpler than two |
| Chrome integration | New `console` chrome mode + role pills + per-role sidebar (option C in section 2 / option B in screen 1) | Reuses existing `chrome-mode.ts` primitive; multi-role users get one-click hat-switching; mirrors Supabase Studio mental model |
| Mobile treatment | Full responsive console with collapsible drawer (option B) | Moderator-on-phone is a real flow; reuses `MobileDrawer.astro` |
| Privileged write path | Single `admin` Edge Function with action dispatcher + atomic audit insert (option B) | Atomic write+audit is structural, not behavioural; matches the existing `mcp` / `delete-observation` pattern |
| Phasing | Foundation + highest-pain-now (option B) | Pays off the schema migration immediately by closing the credentialed_researcher psql gap |
| Overview content | Action-primary alerts + slim KPI rail (screen 2 option D) | Daily 30-second triage flow dominates over weekly deep-audit |
| Users tab pattern | Master-detail split (screen 3 option C) | Role grants need context; removes "open → action → close → next" loop |
| Action surface | Slide-over with reason + expiry (screen 4 option C) | Two-tier action language: slide-over default, modal+typing for irreversible |
| Audit log layout | Hybrid timeline + filter pills + JSONB diff drill-down (screen 5 option C) | Serves both passive scan and active investigation |
| Document everything | Every column, RLS policy, Edge Function action, console route, runbook gets a documented home | Hard rule: nothing ships without its documentation row in the deliverables list |

---

## Role model

Four roles live in the `public.user_role` enum:

| Role | Issued by | Revocable by | What it unlocks |
|---|---|---|---|
| `admin` | bootstrap (manual SQL) or another admin | another admin | Everything in the console; user role grants; license overrides; feature flags |
| `moderator` | admin | admin | Flag queue, comment hide/lock, soft-ban, license disputes |
| `expert` | admin (via experts tab) | admin | 3× weighting in consensus; validation queue scoped to `expert_taxa`; identification overrides; taxon notes |
| `researcher` | admin (via credentials tab) | admin | RLS gate to read precise GPS coords on `obscure_level > 0` observations |

Notes:
- Roles are **orthogonal**, not hierarchical. An admin must hold `admin` explicitly to act as one; admin does *not* imply expert or researcher. This avoids the trap of an admin accidentally getting 3× weighting in consensus on taxa they have no expertise in.
- Multi-role is native: a single user can hold `admin` + `expert` + `researcher` simultaneously and the console shows all three pills.
- Every grant is time-bounded-capable via `revoked_at` set to a future timestamp. Soft-revoke preserves history.
- The deprecated `users.is_expert` and `users.credentialed_researcher` boolean columns stay as denormalised caches kept in sync via trigger (so the consensus computation and the `obs_credentialed_read` RLS policy don't need to JOIN `user_roles` on every read).

---

## Data model

### New enum: `user_role`

```sql
CREATE TYPE public.user_role AS ENUM ('admin', 'moderator', 'expert', 'researcher');
```

### New table: `user_roles`

```sql
CREATE TABLE IF NOT EXISTS public.user_roles (
  user_id     uuid NOT NULL REFERENCES public.users(id) ON DELETE CASCADE,
  role        public.user_role NOT NULL,
  granted_at  timestamptz NOT NULL DEFAULT now(),
  granted_by  uuid REFERENCES public.users(id),     -- nullable for the bootstrap row
  revoked_at  timestamptz,                           -- soft-revoke; NULL = active; future ts = scheduled
  notes       text,
  PRIMARY KEY (user_id, role)
);

-- Partial index restricted to permanently-active rows (NULL revoked_at). Future-dated revocations are rare; has_role() handles the > now() check at query time.
CREATE INDEX IF NOT EXISTS user_roles_active_idx
  ON public.user_roles (role)
  WHERE revoked_at IS NULL;
```

The partial index on `(role)` lets `has_role()` short-circuit cheaply. The compound primary key means each `(user_id, role)` pair exists at most once — re-granting after a revoke is a soft-update (clear `revoked_at`, refresh `granted_at`).

### New helper: `has_role()`

```sql
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
```

`SECURITY DEFINER` so the function runs with table owner privileges, allowing RLS predicates on other tables to call it without granting `user_roles` SELECT to anon. `SET search_path = public` defends against schema-injection style attacks. Same defensive pattern Supabase uses for its own helpers.

### New enum: `audit_op`

```sql
CREATE TYPE public.audit_op AS ENUM (
  -- writes
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
  -- sensitive reads (op suffix '_read')
  'precise_coords_read',
  'user_pii_read',
  'token_list_read',
  'user_audit_read'
);
```

Adding a new auditable action = one ALTER TYPE plus one Edge Function handler. The enum keeps the audit table queryable by op without joining a lookup table.

### New table: `admin_audit`

```sql
CREATE TABLE IF NOT EXISTS public.admin_audit (
  id          bigserial PRIMARY KEY,
  actor_id    uuid NOT NULL REFERENCES public.users(id),
  op          public.audit_op NOT NULL,
  target_type text,                  -- 'user', 'observation', 'comment', 'token', 'flag', 'badge', 'cron'
  target_id   text,                  -- text so it fits uuid OR bigint OR slug
  before      jsonb,                 -- pre-mutation state; NULL for read ops
  after       jsonb,                 -- post-mutation state; NULL for read ops
  reason      text NOT NULL,         -- mandatory; enforced at Edge Function layer
  ip          inet,
  user_agent  text,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS admin_audit_actor_idx
  ON public.admin_audit (actor_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_target_idx
  ON public.admin_audit (target_type, target_id, created_at DESC);
CREATE INDEX IF NOT EXISTS admin_audit_op_idx
  ON public.admin_audit (op, created_at DESC);
```

Three indices match the three primary query shapes: "what did actor X do," "what happened to target Y," "show me all `op = 'precise_coords_read'`." `before` / `after` are JSONB so any target shape fits without schema gymnastics.

### Triggers keeping denormalised flags in sync

```sql
-- users.is_expert mirrors any active 'expert' role
CREATE OR REPLACE FUNCTION sync_user_role_flags() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
  IF (TG_OP = 'INSERT' OR TG_OP = 'UPDATE') THEN
    UPDATE public.users
       SET is_expert = has_role(NEW.user_id, 'expert'),
           credentialed_researcher = has_role(NEW.user_id, 'researcher')
     WHERE id = NEW.user_id;
  ELSIF (TG_OP = 'DELETE') THEN
    UPDATE public.users
       SET is_expert = has_role(OLD.user_id, 'expert'),
           credentialed_researcher = has_role(OLD.user_id, 'researcher')
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
FOR EACH ROW EXECUTE FUNCTION sync_user_role_flags();
```

The trigger runs on revoke (UPDATE of `revoked_at`) too, so soft-revoke flips the flag back. Existing hot paths (consensus computation reading `users.is_expert`, `obs_credentialed_read` RLS policy reading `users.credentialed_researcher`) remain untouched.

### RLS policies

```sql
-- user_roles: admins read all; users read their own
ALTER TABLE public.user_roles ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS user_roles_admin_read ON public.user_roles;
CREATE POLICY user_roles_admin_read ON public.user_roles
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin') OR user_id = auth.uid());

DROP POLICY IF EXISTS user_roles_self_no_write ON public.user_roles;
-- INSERT/UPDATE/DELETE: blocked from anon and authenticated; only service_role (admin Edge Function) writes
CREATE POLICY user_roles_no_self_write ON public.user_roles
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- admin_audit: admins read all; never writes via client
ALTER TABLE public.admin_audit ENABLE ROW LEVEL SECURITY;
DROP POLICY IF EXISTS admin_audit_admin_read ON public.admin_audit;
CREATE POLICY admin_audit_admin_read ON public.admin_audit
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS admin_audit_no_client_write ON public.admin_audit;
CREATE POLICY admin_audit_no_client_write ON public.admin_audit
  FOR ALL TO authenticated
  USING (false) WITH CHECK (false);

-- api_usage and sync_failures: refactor predicate from is_expert to has_role(admin)
--    Note: the original policies were named with a different convention; we drop
--    both the historical and the new name for idempotency.
DROP POLICY IF EXISTS "api_usage_read_admin"     ON public.api_usage;
DROP POLICY IF EXISTS api_usage_expert_read       ON public.api_usage;
DROP POLICY IF EXISTS api_usage_admin_read        ON public.api_usage;
CREATE POLICY api_usage_admin_read ON public.api_usage
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));

DROP POLICY IF EXISTS "sync_failures_read_admin" ON public.sync_failures;
DROP POLICY IF EXISTS sync_failures_expert_read   ON public.sync_failures;
DROP POLICY IF EXISTS sync_failures_admin_read    ON public.sync_failures;
CREATE POLICY sync_failures_admin_read ON public.sync_failures
  FOR SELECT TO authenticated
  USING (has_role(auth.uid(), 'admin'));
```

### Bootstrap

A one-shot SQL block (run manually once, documented in `docs/runbooks/admin-bootstrap.md`):

```sql
INSERT INTO public.user_roles (user_id, role, granted_by, notes)
VALUES ('<operator-user-id>', 'admin', NULL, 'bootstrap')
ON CONFLICT (user_id, role) DO NOTHING;
```

`granted_by IS NULL` is the unambiguous signal "this is the bootstrap row."

---

## Authorization layers

Three layers, each with a distinct responsibility:

```
                ┌───────────────────────────────────────────┐
                │  UI gate (sidebar + route + chrome pill)  │  ← visibility only
                └───────────────────────────────────────────┘
                ┌───────────────────────────────────────────┐
                │  RLS predicates (`has_role(uid, role)`)   │  ← reads
                └───────────────────────────────────────────┘
                ┌───────────────────────────────────────────┐
                │  admin Edge Function (re-verify + audit)  │  ← writes + sensitive reads
                └───────────────────────────────────────────┘
```

- **UI gate** does not protect data — it only hides things the user shouldn't be tempted to click. A user who manually navigates to `/console/users` without a role gets an empty 403 view; the data was never fetched.
- **RLS** is the read-time backstop. Every privileged table has a policy keyed on `has_role(auth.uid(), <role>)`. Reading `admin_audit` from the Supabase JS client just works; no Edge Function call needed for browse views.
- **`admin` Edge Function** is the write-time gate. The browser never holds the service role key. The function re-verifies the JWT, looks up roles, validates the action's required role, performs the mutation and the audit insert in one transaction, and returns the audit_id.

This three-layer design means a single bug in one layer doesn't become a privilege escalation. RLS bug → audit log catches it. Audit log bug → RLS prevents the read. Edge Function bug → both layers behind it still gate.

---

## `admin` Edge Function contract

`supabase/functions/admin/index.ts`. Single endpoint, JSON-RPC-shaped to match the `mcp` pattern.

### Request

```http
POST /functions/v1/admin
Authorization: Bearer <user-supabase-jwt>
Content-Type: application/json

{
  "action": "role.grant" | "role.revoke" | "user.ban" | "user.unban"
          | "user.delete" | "observation.hide" | "observation.unhide"
          | "observation.obscure" | "observation.force_unobscure"
          | "observation.license_override" | "observation.hard_delete"
          | "comment.hide" | "comment.lock" | "comment.unlock"
          | "badge.award_manual" | "badge.revoke"
          | "token.force_revoke" | "feature_flag.toggle"
          | "cron.force_run"
          | "sensitive_read.precise_coords"
          | "sensitive_read.user_pii"
          | "sensitive_read.token_list"
          | "sensitive_read.user_audit",
  "payload": { /* per-action shape, validated with zod */ },
  "reason": "string (mandatory; minimum length enforced; surfaces in admin_audit.reason)"
}
```

### Per-request flow

```ts
// pseudocode in supabase/functions/admin/index.ts
async function handle(req: Request): Promise<Response> {
  const { action, payload, reason } = await parseAndValidate(req);
  const actor = await verifyJwt(req);                       // throws 401 if invalid
  if (!reason || reason.length < 5) return error(400, 'reason required');

  const handler = handlers[action];                          // lookup table
  if (!handler) return error(400, 'unknown action');
  if (!await hasRoleVia(supabase, actor.id, handler.requiredRole)) {
    return error(403, `requires ${handler.requiredRole}`);
  }

  return await db.transaction(async (tx) => {
    const { before, after, target } = await handler.execute(tx, payload, actor.id);
    const auditId = await tx.insert('admin_audit', {
      actor_id: actor.id, op: handler.op,
      target_type: target.type, target_id: target.id,
      before, after, reason,
      ip: req.headers.get('x-forwarded-for'),
      user_agent: req.headers.get('user-agent'),
    });
    return ok({ audit_id: auditId, after });
  });
}
```

The transaction wrap is non-negotiable: if the mutation succeeds but the audit insert fails, the whole transaction rolls back. **No mutation goes unaudited, ever.**

### Naming convention: action verbs vs audit ops

Two parallel string spaces deliberately use different syntax so they never get confused:

- **Action verbs** (sent in the request `action` field): dot-namespaced — `role.grant`, `observation.hide`, `sensitive_read.precise_coords`. They describe an *intent*.
- **Audit ops** (stored in `admin_audit.op`): underscore-cased SQL enum values — `role_grant`, `observation_hide`, `precise_coords_read`. They describe a *recorded fact*.

The handler declares both so the mapping lives in one place (the handler file), and TypeScript guards the relationship via `satisfies AuditOp` and `satisfies ActionVerb`.

### Per-action handlers

`supabase/functions/admin/handlers/*.ts` — one file per action group. Each handler exports:

```ts
export const handler = {
  op: 'role_grant' satisfies AuditOp,
  requiredRole: 'admin' satisfies UserRole,
  payloadSchema: z.object({
    target_user_id: z.string().uuid(),
    role: z.enum(['admin','moderator','expert','researcher']),
    expires_at: z.string().datetime().optional(),
  }),
  async execute(tx, payload, actorId) {
    const before = await tx.from('user_roles').select('*').eq('user_id', payload.target_user_id);
    await tx.from('user_roles').upsert({
      user_id: payload.target_user_id, role: payload.role,
      granted_by: actorId, granted_at: new Date(),
      revoked_at: payload.expires_at ?? null,
    }, { onConflict: 'user_id,role' });
    const after = await tx.from('user_roles').select('*').eq('user_id', payload.target_user_id);
    return { before, after, target: { type: 'user', id: payload.target_user_id } };
  },
};
```

`handlers/index.ts` re-exports all handlers as a lookup table keyed by the action verb. Adding a new privileged action = one new file + one entry. Tests live alongside (`handlers/role-grant.test.ts`).

### Sensitive read handlers

Distinct from writes: these don't mutate, but they *do* return data the caller wouldn't otherwise see, and they log the read.

```ts
// handlers/sensitive-read-precise-coords.ts
export const handler = {
  op: 'precise_coords_read' satisfies AuditOp,
  requiredRole: 'admin' satisfies UserRole,  // researcher role can use the RLS-backed direct read; admin uses this for audit purposes
  payloadSchema: z.object({ observation_id: z.string().uuid() }),
  async execute(tx, payload, actorId) {
    const obs = await tx.from('observations').select('lat_precise, lng_precise')
      .eq('id', payload.observation_id).single();
    return {
      before: null, after: null,
      target: { type: 'observation', id: payload.observation_id },
      result: obs,  // returned to caller separately from audit columns
    };
  },
};
```

The Edge Function returns `{audit_id, result}` for sensitive reads.

### Frontend SDK

`src/lib/admin-client.ts` wraps the Edge Function in typed actions:

```ts
export const adminClient = {
  role: {
    grant: (p: GrantPayload, reason: string) => call('role.grant', p, reason),
    revoke: (p: RevokePayload, reason: string) => call('role.revoke', p, reason),
  },
  user: {
    ban: (p: BanPayload, reason: string) => call('user.ban', p, reason),
    unban: (p: UnbanPayload, reason: string) => call('user.unban', p, reason),
    delete: (p: DeletePayload, reason: string) => call('user.delete', p, reason),
  },
  // …
  sensitiveRead: {
    preciseCoords: (obsId: string, reason: string) =>
      call('sensitive_read.precise_coords', { observation_id: obsId }, reason),
    // …
  },
};
```

Console pages call `adminClient.role.grant(...)` rather than hand-rolling JSON. Test boundary is the SDK; mock at that layer in component tests.

---

## Console chrome

### New chrome mode

`src/lib/chrome-mode.ts` extends:

```ts
export type ChromeMode = 'app' | 'read' | 'console';

export function resolveChromeMode(path: string): ChromeMode {
  if (/^\/(en|es)\/(console|consola)(\/|$)/.test(path)) return 'console';
  // existing app/read rules unchanged
}
```

`console` mode means: no Header/MegaMenu/MobileBottomBar, no marketing footer. `BaseLayout.astro` switches to a new `ConsoleLayout.astro` chrome.

### Layout (locked: screen 1 option B)

```
┌─────────────────────────────────────────────────────────────────────┐
│  Rastrum     [Admin · Moderation · Expert]    artemio  [↩ Exit]    │  ← role pills (active in emerald)
├──────────────┬──────────────────────────────────────────────────────┤
│              │  ┌──── Overview ────────────────┬── At a glance ──┐ │
│ Overview     │  │                               │  Obs    12,847  │ │
│ Users        │  │  ⚑ 7 flagged obs    →         │  RG     62%     │ │
│ Credentials  │  │  ⏳ 3 pending experts →        │  DAU    87      │ │
│ Experts      │  │  📊 PlantNet 82%              │  Tokens 39      │ │
│ Observations │  │                               │  R2     14.2GB  │ │
│ API & quotas │  │  Last 7 days ↗ +18%           │  Users  234     │ │
│ Sync         │  │  ╱╲╱─╱╲╱╱╲╱─╱╲╱─╱╲╱╲          │                 │ │
│ Cron         │  └───────────────────────────────┴─────────────────┘ │
│ Badges       │                                                       │
│ Taxa         │                                                       │
│ Karma        │                                                       │
│ Flags        │                                                       │
│ Audit log    │                                                       │
│              │                                                       │
└──────────────┴──────────────────────────────────────────────────────┘
```

- **Top bar**: Rastrum wordmark (links to `/`), role pills (only those held; active pill is emerald-on-zinc), user identity, "Exit console" → returns to last non-console page or `/profile`.
- **Sidebar**: tabs filtered to the active role's set, derived from `console-tabs.ts`. Sidebar accent rail colour matches the role pill: admin = emerald, moderator = amber, expert = sky.
- **Content**: per-tab. The tab below the sidebar's Overview row is a count badge for unread/needs-attention items (e.g., `Flags 7`).

### Mobile (locked: screen 1 option B + responsive)

```
┌──────────────────────────────────┐
│ ☰  Rastrum  [Admin▾]  artemio    │  ← hamburger collapses sidebar; pills become a single dropdown
├──────────────────────────────────┤
│  Overview · Admin                │
│                                   │
│  ⚑ 7 flagged obs                 │
│  ⏳ 3 pending experts            │
│  📊 PlantNet 82%                 │
│  ─────────────                   │
│  Obs 12,847 · RG 62% · DAU 87    │  ← KPI rail flattens to inline
└──────────────────────────────────┘
```

The hamburger reuses `MobileDrawer.astro`'s slide-from-right pattern. Role-pill dropdown shows only roles the user holds.

### Routes

EN/ES paired per the project's hard rule. Slugs added to `src/i18n/utils.ts` `routes`:

```ts
export const routes = {
  // …existing routes
  console:                   { en: '/console',                es: '/consola' },
  consoleUsers:              { en: '/console/users',          es: '/consola/usuarios' },
  consoleCredentials:        { en: '/console/credentials',    es: '/consola/credenciales' },
  consoleExperts:            { en: '/console/experts',        es: '/consola/expertos' },
  consoleObservations:       { en: '/console/observations',   es: '/consola/observaciones' },
  consoleApi:                { en: '/console/api',            es: '/consola/api' },
  consoleSync:               { en: '/console/sync',           es: '/consola/sync' },
  consoleCron:               { en: '/console/cron',           es: '/consola/cron' },
  consoleBadges:             { en: '/console/badges',         es: '/consola/insignias' },
  consoleTaxa:               { en: '/console/taxa',           es: '/consola/taxa' },
  consoleKarma:              { en: '/console/karma',          es: '/consola/karma' },
  consoleFlags:              { en: '/console/flags',          es: '/consola/banderas' },
  consoleAudit:              { en: '/console/audit',          es: '/consola/auditoria' },
  consoleFeatureFlags:       { en: '/console/features',       es: '/consola/caracteristicas' },
  consoleBioblitz:           { en: '/console/bioblitz',       es: '/consola/bioblitz' },
  consoleModFlagQueue:       { en: '/console/flag-queue',     es: '/consola/cola-banderas' },
  consoleModComments:        { en: '/console/comments',       es: '/consola/comentarios' },
  consoleModBans:            { en: '/console/bans',           es: '/consola/suspensiones' },
  consoleModDisputes:        { en: '/console/disputes',       es: '/consola/disputas' },
  consoleExpertValidation:   { en: '/console/validation',     es: '/consola/validacion' },
  consoleExpertOverrides:    { en: '/console/overrides',      es: '/consola/correcciones' },
  consoleExpertExpertise:    { en: '/console/expertise',      es: '/consola/experiencia' },
  consoleExpertTaxonNotes:   { en: '/console/taxon-notes',    es: '/consola/notas-taxon' },
};
```

Old `/profile/admin/experts/` → 308 redirect to `/console/experts/` (and ES counterpart). Redirect ships in the same PR that retires the old page; no half-shipped state.

### `console-tabs.ts` — single source of truth

```ts
// src/lib/console-tabs.ts
import type { UserRole } from './types';

export interface ConsoleTab {
  id: string;
  role: UserRole;            // which role this tab belongs to
  routeKey: keyof typeof routes;
  i18nKey: string;           // resolves to nav.<key> in en.json/es.json
  icon: string;              // lucide icon name
  phase: 1 | 2 | 3 | 4;      // shipping phase per phasing plan
  stub?: boolean;            // if true, renders "coming soon" panel
  countQuery?: () => Promise<number>;  // optional badge count (e.g., open flags)
}

export const CONSOLE_TABS: ConsoleTab[] = [
  // Admin
  { id: 'overview',       role: 'admin',     routeKey: 'console',                 i18nKey: 'console.overview',     icon: 'gauge',     phase: 1 },
  { id: 'users',          role: 'admin',     routeKey: 'consoleUsers',            i18nKey: 'console.users',        icon: 'users',     phase: 2 },
  { id: 'credentials',    role: 'admin',     routeKey: 'consoleCredentials',      i18nKey: 'console.credentials',  icon: 'shield-check', phase: 2 },
  { id: 'experts',        role: 'admin',     routeKey: 'consoleExperts',          i18nKey: 'console.experts',      icon: 'award',     phase: 1 },
  { id: 'observations',   role: 'admin',     routeKey: 'consoleObservations',     i18nKey: 'console.observations', icon: 'leaf',      phase: 4 },
  { id: 'api',            role: 'admin',     routeKey: 'consoleApi',              i18nKey: 'console.api',          icon: 'plug',      phase: 3 },
  { id: 'sync',           role: 'admin',     routeKey: 'consoleSync',             i18nKey: 'console.sync',         icon: 'refresh',   phase: 3 },
  { id: 'cron',           role: 'admin',     routeKey: 'consoleCron',             i18nKey: 'console.cron',         icon: 'clock',     phase: 3 },
  { id: 'badges',         role: 'admin',     routeKey: 'consoleBadges',           i18nKey: 'console.badges',       icon: 'star',      phase: 4 },
  { id: 'taxa',           role: 'admin',     routeKey: 'consoleTaxa',             i18nKey: 'console.taxa',         icon: 'tree',      phase: 4 },
  { id: 'karma',          role: 'admin',     routeKey: 'consoleKarma',            i18nKey: 'console.karma',        icon: 'sparkles',  phase: 4 },
  { id: 'flags',          role: 'admin',     routeKey: 'consoleFlags',            i18nKey: 'console.flags',        icon: 'flag',      phase: 4 },
  { id: 'audit',          role: 'admin',     routeKey: 'consoleAudit',            i18nKey: 'console.audit',        icon: 'scroll',    phase: 1 },
  { id: 'features',       role: 'admin',     routeKey: 'consoleFeatureFlags',     i18nKey: 'console.features',     icon: 'toggle',    phase: 4 },
  { id: 'bioblitz',       role: 'admin',     routeKey: 'consoleBioblitz',         i18nKey: 'console.bioblitz',     icon: 'calendar',  phase: 4, stub: true },
  // Moderator
  { id: 'mod-overview',   role: 'moderator', routeKey: 'console',                 i18nKey: 'console.modOverview',  icon: 'gauge',     phase: 3 },
  { id: 'mod-flag-queue', role: 'moderator', routeKey: 'consoleModFlagQueue',     i18nKey: 'console.modFlagQueue', icon: 'flag',      phase: 3 },
  { id: 'mod-comments',   role: 'moderator', routeKey: 'consoleModComments',      i18nKey: 'console.modComments',  icon: 'message',   phase: 3 },
  { id: 'mod-bans',       role: 'moderator', routeKey: 'consoleModBans',          i18nKey: 'console.modBans',      icon: 'user-x',    phase: 4 },
  { id: 'mod-disputes',   role: 'moderator', routeKey: 'consoleModDisputes',      i18nKey: 'console.modDisputes',  icon: 'gavel',     phase: 4, stub: true },
  // Expert
  { id: 'exp-overview',   role: 'expert',    routeKey: 'console',                 i18nKey: 'console.expOverview',  icon: 'gauge',     phase: 2 },
  { id: 'exp-validation', role: 'expert',    routeKey: 'consoleExpertValidation', i18nKey: 'console.expValidation', icon: 'check-circle', phase: 2 },
  { id: 'exp-expertise',  role: 'expert',    routeKey: 'consoleExpertExpertise',  i18nKey: 'console.expExpertise', icon: 'badge-check', phase: 2 },
  { id: 'exp-overrides',  role: 'expert',    routeKey: 'consoleExpertOverrides',  i18nKey: 'console.expOverrides', icon: 'edit',      phase: 4, stub: true },
  { id: 'exp-taxon-notes',role: 'expert',    routeKey: 'consoleExpertTaxonNotes', i18nKey: 'console.expTaxonNotes', icon: 'sticky-note', phase: 4, stub: true },
];

export function tabsForRoles(activeRole: UserRole, allRoles: Set<UserRole>): ConsoleTab[] {
  return CONSOLE_TABS.filter(t => t.role === activeRole && allRoles.has(t.role));
}

export function rolePillsFor(allRoles: Set<UserRole>): UserRole[] {
  // Order: admin → moderator → expert → researcher
  const order: UserRole[] = ['admin', 'moderator', 'expert', 'researcher'];
  return order.filter(r => allRoles.has(r));
}
```

Adding a tab = one entry. Removing one = delete the entry. The sidebar, the role pills, and the route table are all pure projections of this list — no drift possible.

The `researcher` role does not appear in the sidebar tabs (it's a data-access role, not a console role). It surfaces only as a chip in Users / Credentials.

### Header surface

`Header.astro` adds one conditional pill, only when the user holds any role:

```astro
---
const { user } = Astro.locals;
const roles = user ? await getUserRoles(user.id) : new Set();
const hasConsoleAccess = roles.size > 0;
const consolePath = getLocalizedPath(lang, routes.console[lang] + '/');
---
{hasConsoleAccess && (
  <a href={consolePath} class={railClass('console')}>{tr.console.nav}</a>
)}
```

`railClass('console')` returns the slate-500 accent rail class (newly added to the safelist in `tailwind.config.mjs` — without that, Tailwind purges the class in prod builds, per CLAUDE.md's chrome convention). Mobile bottom bar: console gets no slot (not a primary action). Mobile drawer adds a "Console" entry visible only when `hasConsoleAccess`.

---

## UI patterns (canonical templates)

### Master-detail (Users tab, locked: screen 3 option C)

```
┌──── Console › Users ────────────────────────────────────────────┐
│ 🔍 Search…                                                       │
│ ┌─────────────────┬───────────────────────────────────────────┐ │
│ │ • artemio       │  ┌─ eugenio ──────────────────────────┐   │ │
│ │   admin · expert│  │ 👤 eugenio                         │   │ │
│ │ ► eugenio       │  │ eugenio@…  · joined 2026-04-25     │   │ │
│ │   expert        │  │ ┌── Roles ──────────────────────┐  │   │ │
│ │ • maria.lopez   │  │ │ [expert ✕]                    │  │   │ │
│ │   moderator     │  │ │ [+ admin] [+ mod] [+ res]     │  │   │ │
│ │ • carlos.r      │  │ └───────────────────────────────┘  │   │ │
│ │   —             │  │ ┌── Recent activity ─────────────┐ │   │ │
│ │ • ana.bio       │  │ │ 87 obs · 12 RG · 3 pending     │ │   │ │
│ │   expert · res  │  │ │ granted expert · 3d by artemio │ │   │ │
│ │ • juan.dev      │  │ │ 0 flags · no soft-bans         │ │   │ │
│ │   —             │  │ └────────────────────────────────┘ │   │ │
│ │ … 228 more      │  └────────────────────────────────────┘   │ │
│ └─────────────────┴───────────────────────────────────────────┘ │
└──────────────────────────────────────────────────────────────────┘
```

The same pattern applies to: Credentials (researcher grants), Experts (queue), Observations (admin view), Comments (mod).

### Slide-over action (Tier 1, locked: screen 4 option C)

Triggered by clicking any dashed `+ <role>` chip or any "[Hide]" / "[Ban]" button. Opens a right-side panel sliding over the detail pane (not the list — list stays visible).

Required fields:
- **Reason** (textarea, min 5 chars; suggestion chips for common reasons: "Promoted after community participation", "Spam reporter accumulator", "Policy violation — see ticket #")
- **Expires** (select for grants: Never / 30d / 90d / 1yr / custom date)
- The function that will be called and the audit op are named explicitly at the bottom of the panel ("This will be logged to admin_audit as `role_grant`")

On submit: SDK call → spinner → success toast (with audit_id link to the audit log entry) → panel closes → master row updates optimistically.

### Modal + type-to-confirm (Tier 2 — irreversible only)

For: `user.delete`, `observation.hard_delete`, `observation.force_unobscure_logged`. Full-screen modal blur. Required: reason + typed username/id. The "Confirm" button is disabled until the typed value matches.

### Hybrid audit log (locked: screen 5 option C)

```
┌──── Console › Audit log ────────────────────────────────────────┐
│ [actor: any▾] [op: any▾] [last 7d ✕] [target: user/eugenio ✕]   │
│                                                  5 entries · CSV │
│                                                                  │
│ Today                                                            │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ artemio → role_grant user/eugenio              14:32 ▾  │   │
│ │ "6 weeks active community participation"                  │   │
│ └──────────────────────────────────────────────────────────┘   │
│ ┌──────────────────────────────────────────────────────────┐   │
│ │ artemio → role_grant user/eugenio              14:32 ▴  │   │
│ │ ┌── before ──┐                                           │   │
│ │ │ - roles: ["expert"]                                    │   │
│ │ ├── after ───┤                                           │   │
│ │ │ + roles: ["expert", "moderator"]                       │   │
│ │ │ + granted_at: 2026-04-27T14:32:08Z                     │   │
│ │ └────────────┘                                           │   │
│ └──────────────────────────────────────────────────────────┘   │
└──────────────────────────────────────────────────────────────────┘
```

- Filter pills on top compress current query into a single line. Each pill has an `✕` to remove that filter.
- Filters serialise to URL query params (`?actor=artemio&op=role_grant&since=7d&target=user/eugenio`). Deep-linking an investigation result is one copy.
- Timeline rows group by day. Click expands to show JSONB diff (red `-` removed, green `+` added).
- "CSV" downloads the current filter result for compliance.

---

## Per-role tab inventory

### Admin (15 tabs)

| # | Tab | What | Role behind RLS | Phase |
|---|---|---|---|---|
| 1 | Overview | Action-primary alerts + KPI rail | admin | 1 |
| 2 | Users | Master-detail; role grants/revokes | admin | 2 |
| 3 | Credentials | `researcher` grants; replaces psql | admin | 2 |
| 4 | Experts | `expert_applications` queue (moved from `/profile/admin/experts/`) | admin | 1 |
| 5 | Observations | Global table; hide / obscure / license override / re-identify | admin | 4 |
| 6 | API & quotas | `api_usage` view + PlantNet quota burn-down + per-user rate-limit overrides | admin | 3 |
| 7 | Sync failures | `sync_failures` triage + retry button + group-by-error | admin | 3 |
| 8 | Cron / Edge fns | Last-run status of `award-badges`, `recompute-streaks`, `enrich-environment`, `delete-observation`; one-shot fire | admin | 3 |
| 9 | Badges | Catalogue editor (criteria, icon, i18n labels); preview which users would auto-earn; manual one-off awards | admin | 4 |
| 10 | Taxa & rarity | View `taxon_rarity`; manual recompute; flag NOM-059/CITES; common-name aliases | admin | 4 |
| 11 | Karma tuning | Module 23 phase-2/3 multipliers (rarity, conservation, validation reward); live-impact preview | admin | 4 |
| 12 | Flags | All flagged content overview (admin view; mods see the queue separately) | admin | 4 |
| 13 | Audit log | Hybrid timeline + filters + JSONB diff | admin | 1 |
| 14 | Feature flags | Per-env toggles (parallel cascade, server-side bbox crop, MegaDetector preflight, push notifications) | admin | 4 |
| 15 | Bioblitz events | Create/edit events when an organizer requests; surfaces the deferred v1.0 UI | admin | 4 (stub initially) |

### Moderator (5 tabs declared, 4 active in v1)

| # | Tab | What | Role behind RLS | Phase |
|---|---|---|---|---|
| 1 | Overview | Mod-flavoured: open flags, queue depth, response-time SLO | moderator | 3 |
| 2 | Flag queue | Observations/comments/users flagged by community; accept/reject/escalate | moderator | 3 |
| 3 | Comments | Threaded view; hide/lock/soft-delete | moderator | 3 |
| 4 | Soft-bans | 24h/7d/30d suspensions; unmute | moderator | 4 |
| 5 | License disputes (stub) | Triage when an observer claims a wrongly-applied CC license | moderator | 4 (stub) |

("Reports out" is bumped — no concrete user yet.)

### Expert (5 tabs declared, 3 active in v1)

| # | Tab | What | Role behind RLS | Phase |
|---|---|---|---|---|
| 1 | Overview | Taxonomic-flavoured: queue items in your taxa, your weighted-vote impact | expert | 2 |
| 2 | Validation queue (your taxa) | Pre-filtered Module 22 queue scoped to `expert_taxa ∩ observation taxa` | expert | 2 |
| 3 | Your expertise | Module 23 per-taxon expertise score, rarity-weighted contributions, leaderboard | expert | 2 |
| 4 | Identification overrides (stub) | Propose primary_id swap with rationale (auto-accept at 3× weight if no other expert disagrees within 48h) | expert | 4 (stub) |
| 5 | Taxon notes (stub) | Per-taxon "expert tips" surfaced on `/explore/species/?slug=…` | expert | 4 (stub) |

(Stubs render a "coming soon" panel + GitHub-issue link. They occupy a sidebar slot so the surface is honest about future scope.)

---

## Phasing plan (locked: option B — foundation + highest-pain-now)

### PR 1 — Foundation (no user-visible features beyond moving the experts page)

- Schema migration: `user_role` enum, `user_roles` table, `audit_op` enum, `admin_audit` table, `has_role()` function, sync trigger, bootstrap row docs.
- RLS refactor: `api_usage` and `sync_failures` predicates flip from `is_expert` to `has_role(admin)`.
- Console chrome mode (`'console'` added to `chrome-mode.ts`, `ConsoleLayout.astro`, role pills, sidebar shell, mobile drawer).
- `console-tabs.ts` with all 25 tabs declared (most marked `stub: true`).
- `admin` Edge Function dispatcher skeleton + first three handlers (`role.grant`, `role.revoke`, `sensitive_read.user_audit`).
- `src/lib/admin-client.ts` SDK.
- Tabs that ship live: Overview (action cards rendering empty state), Experts (moved from `/profile/admin/experts/`), Audit log (browse-only, the three dispatcher actions are the only ones logging).
- Old `/profile/admin/experts/` 308-redirects to `/console/experts/`.
- Tailwind safelist updated for `console` accent rail.
- EN/ES i18n for all sidebar labels (even stub tabs).
- **Documentation:** `docs/specs/modules/24-admin-console.md`, `docs/runbooks/admin-bootstrap.md`, `docs/runbooks/role-model.md`, schema doc updates, `00-index.md` row.

### PR 2 — Close the highest-pain gaps

- **Users** tab (master-detail). Role-grant slide-over. Searchable list. Adds handlers for nothing new (uses PR 1's `role.grant`/`role.revoke`).
- **Credentials** tab. Grant/revoke `researcher` role. **Replaces the psql workaround** documented in CLAUDE.md.
- **Expert console** (Overview, Validation queue, Your expertise). Reuses Module 22 `validation_queue` table; the queue tab is a filtered projection. The Expertise tab pulls from Module 23 `user_expertise`.
- **Documentation:** `docs/runbooks/admin-ops.md` (role grant, researcher grant, audit verification recipes), expansion of `24-admin-console.md` with the per-tab specs.

### PR 3 — Operator value (data already exists, no UI)

- **Sync failures** tab. Read `sync_failures` table; group by error type; retry button calls a new `admin.sync.retry_failure` handler.
- **API & quotas** tab. Read `api_usage`; PlantNet quota burn-down chart; per-user rate-limit override (new column `users.api_rate_limit_override` if needed).
- **Cron / Edge fns** tab. Last-run status (read from a new `cron_runs` table populated by each cron Edge Function); one-shot fire button → `admin.cron.force_run` handler that calls `gh workflow run` via the GitHub API or directly invokes the function URL.
- **Moderator console** (Overview, Flag queue, Comments). Requires `flags` and `comment_moderation_log` tables (additive schema). Queue UI mirrors Users master-detail pattern.
- **Documentation:** `docs/runbooks/admin-audit.md`, `docs/runbooks/sync-triage.md`, `docs/runbooks/cron-runbook.md`.

### PR 4+ — On-demand

Everything else (Badges editor, Taxa & rarity, Karma tuning, Feature flags, Bioblitz, Soft-bans, License disputes, Identification overrides, Taxon notes) ships when there's a concrete user need. Stubs render "coming soon" + a link to the GitHub issue requesting the feature.

---

## Documentation deliverables

Hard rule (from user feedback "+ document everything"): nothing ships without its documentation row. Every PR closes its row before merge.

| # | Doc | What | Phase |
|---|---|---|---|
| 1 | `docs/specs/modules/24-admin-console.md` | Module spec — data model, RLS, Edge Function contract, per-role tabs, phasing | 1 |
| 2 | `docs/specs/modules/00-index.md` | Add row 24 | 1 |
| 3 | `docs/architecture.md` | Console as new top-level surface; sequence diagram for privileged write | 1 |
| 4 | `docs/specs/infra/supabase-schema.sql` | Schema for all new tables/enums/functions/triggers/policies (idempotent) | 1 |
| 5 | `docs/runbooks/admin-bootstrap.md` | One-shot bootstrap SQL + how to grant the operator the first admin role | 1 |
| 6 | `docs/runbooks/role-model.md` | Definitive guide to the four roles, who grants what, time-bounded grants | 1 |
| 7 | `docs/runbooks/admin-audit.md` | How to read audit log; retention; sample queries; what each `audit_op` means | 3 |
| 8 | `docs/runbooks/admin-ops.md` | Per-action runbook — what it does, what it logs, how to roll back | 2 |
| 9 | `docs/runbooks/sync-triage.md` | Reading and retrying `sync_failures` | 3 |
| 10 | `docs/runbooks/cron-runbook.md` | Cron status surface; force-run procedure; failure triage | 3 |
| 11 | `docs/progress.json` | Add `admin-console-foundation`, `admin-console-high-pain`, `admin-console-ops` items | each phase |
| 12 | `docs/tasks.json` | Subtasks per phase | each phase |
| 13 | `CLAUDE.md` | New "Console / privileged surfaces" section under Conventions; document `'console'` chrome mode + `has_role()` invariant | 1 |
| 14 | `src/pages/{en,es}/docs/console.md` | High-level explainer for users who see the "Console" pill and wonder what it is | 1 |
| 15 | Inline JSDoc on `has_role`, `admin` Edge Function actions, `console-tabs.ts`, every new component | continuous | each PR |

---

## Open questions / future cleanup

1. **`delete-observation` Edge Function fold-in.** Once `admin` ships, the existing standalone `delete-observation` function could be folded in as `observation.hard_delete`. Defer; refactor not feature.
2. **Admin notifications.** Should sensitive_read events trigger an out-of-band Slack ping for the operator? Out of scope for v1; revisit if a team forms.
3. **Bulk operations.** Phase 4 may want a bulk-action surface (grant `researcher` to 20 verified accounts at once). Schema supports it; UI doesn't until there's a use case.
4. **Time-bounded grant expiry job.** `revoked_at` set to a future timestamp doesn't auto-expire — the trigger only fires on row mutations. A nightly cron `expire_role_grants()` that no-ops a row at expiry time would close this. Add when first time-bounded grant is issued.
5. **Append-only audit log.** Today `admin_audit` is RLS-locked but technically deletable by service role. For true append-only, drop `DELETE` and `UPDATE` privilege from all roles. Defer until first compliance ask.
6. **Researcher self-service application.** Today researcher status requires admin grant (in person). A user-facing application form (mirroring `expert_applications`) would let users request the role with credential evidence. Deferred to v2.0.
7. **Audit log retention.** Keep forever for v1. If volume grows, add monthly partitioning per `infra/future-migrations.md` pattern.

---

## Risk register

| Risk | Likelihood | Impact | Mitigation |
|---|---|---|---|
| RLS bug allows non-admin to read `user_roles` | Low | High | RLS is one layer of three; Edge Function re-verifies. Add pgTAP test in `infra/testing.md`. |
| Edge Function transaction commits mutation but audit insert fails silently | Low | High | Transaction wraps both; failure rolls back. Integration test must verify rollback path. |
| Trigger desyncs `users.is_expert` from `user_roles` | Low | Medium | Trigger is the only writer; idempotent. Add reconciliation script `scripts/reconcile-role-flags.ts`. |
| Operator forgets to bootstrap and locks themselves out | Medium | Medium | `admin-bootstrap.md` runbook; bootstrap SQL is the first step. |
| Mobile responsive layout fails on small screens | Medium | Low | Reuse existing `MobileDrawer.astro`; add Playwright mobile-chrome test. |
| `console-tabs.ts` drift from i18n keys | Medium | Low | TypeScript: `i18nKey` is keyed against the i18n schema type. Build-time error if missing. |
| Stub tabs feel broken to first-time admin | Medium | Low | Each stub renders an explicit "coming soon" panel + link to the tracking GitHub issue. |

---

## Success criteria

The v1 console (PRs 1–3) ships when:

- [ ] An admin can grant `researcher` role through the UI without ever opening psql (closes the documented gap in CLAUDE.md).
- [ ] Every privileged write produces an `admin_audit` row visible in the audit log within 1 second.
- [ ] The 25-tab declaration in `console-tabs.ts` is the single source of truth for sidebar, role pills, and routes — no drift, no duplicate string in the codebase.
- [ ] Mobile-chrome Playwright smoke test passes (sidebar drawer collapses, role pills work).
- [ ] `npm run typecheck`, `npm run test`, `npm run build`, and `npm run test:e2e` all pass.
- [ ] All 15 documentation deliverables marked complete in their respective PR descriptions.
- [ ] An RLS pgTAP test verifies that a non-admin authenticated user cannot SELECT from `admin_audit`.
- [ ] The `admin` Edge Function rejects a request with `requiredRole: 'admin'` from a moderator-only user with HTTP 403.
