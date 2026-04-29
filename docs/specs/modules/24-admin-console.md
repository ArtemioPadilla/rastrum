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

## Implementation status

| Tab | Role | Status | Shipped in |
|---|---|---|---|
| Overview (admin) | admin | done | PR #42 |
| Users | admin | done | PR #66 |
| Credentials | admin | done | PR #66 |
| Experts | admin | done | PR #42 |
| Observations | admin | done | PR #74 |
| API & quotas | admin | done | PR #70 |
| Sync failures | admin | done | PR #70 |
| Cron / Edge fns | admin | done | PR #70 |
| Audit log | admin | done | PR #42 |
| Badges | admin | stub | PR7 |
| Taxa & rarity | admin | stub | PR7 |
| Karma tuning | admin | stub | PR7 |
| Flags (admin) | admin | stub | PR7 |
| Feature flags | admin | stub | PR7 |
| Bioblitz | admin | stub | PR7 (on demand) |
| Overview (mod) | moderator | done | PR #77 |
| Flag queue | moderator | done | PR #77 |
| Comments | moderator | done | PR #77 |
| Soft-bans | moderator | done | PR #77 |
| License disputes | moderator | stub | deferred |
| Overview (expert) | expert | done | PR6 |
| Validation queue | expert | done | PR6 |
| Your expertise | expert | done | PR6 |
| Identification overrides | expert | stub | PR7+ |
| Taxon notes | expert | stub | PR7+ |

**Functional: 17 of 25 console tabs after PR6 merges.**

## Edge Function handlers (16 deployed after PR5)

| Action verb | Required role | Audit op | Shipped in |
|---|---|---|---|
| role.grant | admin | role_grant | PR #42 |
| role.revoke | admin | role_revoke | PR #42 |
| sensitive_read.user_audit | admin | user_audit_read | PR #42 |
| observation.hide | admin | observation_hide | PR #74 |
| observation.unhide | admin | observation_unhide | PR #74 |
| observation.obscure | admin | observation_obscure | PR #74 |
| observation.license_override | admin | observation_license_override | PR #74 |
| report.triage | moderator | report_triaged | PR #77 |
| report.resolve | moderator | report_resolved | PR #77 |
| report.dismiss | moderator | report_dismissed | PR #77 |
| comment.hide | moderator | comment_hide | PR #77 |
| comment.unhide | moderator | comment_unhide | PR #77 |
| comment.lock | moderator | comment_lock | PR #77 |
| comment.unlock | moderator | comment_unlock | PR #77 |
| user.ban | moderator | user_ban | PR #77 |
| user.unban | moderator | user_unban | PR #77 |
