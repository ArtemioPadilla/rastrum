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

- `public.user_roles` — `(user_id, role)` join with audit columns (`granted_at`, `granted_by`, `revoked_at`, `notes`)
- `public.admin_audit` — append-style record of every privileged write + sensitive read
- `public.user_role` enum — `admin | moderator | expert | researcher`
- `public.audit_op` enum — see schema for full list (23 values)
- `public.has_role(uuid, user_role)` SECURITY DEFINER function used by every RLS predicate

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
- The `user_roles_sync_flags` trigger keeps `users.is_expert` and
  `users.credentialed_researcher` in sync; consensus computation and the
  `obs_credentialed_read` RLS policy continue to read those columns hot-path.

## Cost / risk

- Storage: bounded — audit rows are small (≤ 1KB typical).
- Privacy: sensitive reads are auditable per the privacy promise around
  NOM-059/CITES coords. See `docs/runbooks/admin-audit.md`.

## Data stored

- `user_roles`: one row per (user, role) pair.
- `admin_audit`: one row per privileged write or sensitive read.

## Phasing

- **PR1 (foundation, this):** schema + chrome + Edge Function skeleton + 3 working tabs (Overview, Experts moved, Audit log).
- **PR2:** Users, Credentials, Expert console.
- **PR3:** Sync, API, Cron, Moderator console.
- **PR4+:** Badges editor, Karma tuning, Feature flags, etc. — on demand.
