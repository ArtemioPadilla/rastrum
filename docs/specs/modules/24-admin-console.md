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
| Badges | admin | done | PR #86 + PR8 write actions |
| Taxa & rarity | admin | done | PR #86 + PR8 write actions |
| Karma tuning | admin | done | PR #86 + PR8 DB-backed reads |
| Flags (admin) | admin | done | PR #86 |
| Feature flags | admin | done | PR #86 + PR8 DB-backed + live toggle |
| Bioblitz | admin | stub | deferred (on demand) |
| Overview (mod) | moderator | done | PR #77 |
| Flag queue | moderator | done | PR #77 |
| Comments | moderator | done | PR #77 |
| Soft-bans | moderator | done | PR #77 |
| License disputes | moderator | stub | deferred |
| Overview (expert) | expert | done | PR6 |
| Validation queue | expert | done | PR6 |
| Your expertise | expert | done | PR6 |
| Identification overrides | expert | stub | deferred |
| Taxon notes | expert | stub | deferred |

**Functional: 30 of 32 console tabs after PR15. Deferred stubs: License disputes, Identification overrides, Taxon notes — no concrete users yet.**

### Tabs added in PR9-PR15

| Tab | Role | Status | Shipped in |
|---|---|---|---|
| Appeals | moderator | done | PR10 |
| Anomalies | admin | done | PR12 |
| Forensics | admin | done | PR12 |
| Proposals | admin | done | PR13 |
| Webhooks | admin | done | PR13 |
| Health | admin | done | PR15 |
| Errors | admin | done | PR15 |

## Cron jobs added in PR12-PR14

| Job name | Schedule (UTC) | Function | Shipped in |
|---|---|---|---|
| `admin-anomaly-detect-hourly` | `5 * * * *` | `detect_admin_anomalies()` | PR12 |
| `admin-health-digest-weekly` | `0 9 * * 1` | `compute_admin_health_digest()` | PR12 |
| `auto-revoke-expired-roles-daily` | `15 8 * * *` | `auto_revoke_expired_roles()` | PR13 |
| `expire-stale-proposals-hourly` | `25 * * * *` | `expire_stale_proposals()` | PR13 |
| `reconcile-webhook-deliveries` | `*/2 * * * *` | `reconcile_webhook_deliveries()` | PR14 |
| `admin-observability-dryrun` (GH Actions) | `13 9 * * 1` (+ one-shot 2026-05-06) | psql query suite | PR14 |

## Edge Function handlers (36 deployed after PR15)

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
| badge.award_manual | admin | badge_award_manual | PR8 |
| badge.revoke | admin | badge_revoke | PR8 |
| taxon.recompute_rarity | admin | cron_force_run | PR8 |
| taxon.toggle_conservation | admin | taxon_conservation_set | PR8 |
| feature_flag.toggle | admin | feature_flag_toggle | PR8 |
| appeal.accept | moderator | appeal_accepted | PR10 |
| appeal.reject | moderator | appeal_rejected | PR10 |
| anomaly.acknowledge | admin | anomaly_acknowledge | PR12 |
| audit.export | admin | audit_export | PR12 |
| proposal.create | admin | proposal_create | PR13 |
| proposal.approve | admin | proposal_approve | PR13 |
| proposal.reject | admin | proposal_reject | PR13 |
| webhook.create | admin | webhook_create | PR13 |
| webhook.update | admin | webhook_update | PR13 |
| webhook.delete | admin | webhook_delete | PR13 |
| webhook.test | admin | webhook_test | PR13 |
| webhook.replay_delivery | admin | webhook_replay | PR15 |
| health.recompute | admin | health_recompute | PR15 |
| error.acknowledge | admin | error_acknowledge | PR15 |
| error.acknowledge_bulk | admin | error_acknowledge_bulk | PR15 |

## v1.1 deferred-cleanup primitives (PR14)

The dispatcher gained a server-side enforcement gate, the webhook
pipeline closed its async-status loop, and the trust score moved from
placeholder to real formula:

- **`enforce_two_person_irreversible` feature flag** — when enabled, the
  dispatcher rejects direct calls to ops in `IRREVERSIBLE_OPS` unless
  they originated from `proposal.approve` (which stamps an internal
  `_via_proposal: true` on its inner dispatch). Default off; flip via
  `feature_flag.toggle` once the proposals queue is in active use.
- **Webhook `_meta` envelope + reconcile cron** — every outbound body
  carries `_meta: { event_id, event, timestamp, nonce, version }` (HMAC
  covers it). The reconcile cron joins `admin_webhook_deliveries` against
  `net._http_response` every 2 min so `status_code` flows back into the
  Webhooks tab UI.
- **`compute_moderator_trust_score()` v1.1** — `70 - 8·unack_30d - 25·overturn_rate + 30·min(1, sqrt(active_days_90d/30)) + 5·acted_in_last_7_days`, clamped 0-100. Bumping the formula requires bumping the in-function version comment AND shipping a runbook entry.
- **Per-admin timezone for off_hours** — `users.timezone` (nullable IANA, defaults to UTC). Profile → Edit picker covers UTC + 8 LATAM/EU zones.
- **Durable observability dry-run** — `.github/workflows/admin-observability-dryrun.yml` runs once on 2026-05-06 09:13 UTC and weekly Mondays thereafter. Fails red if any webhook delivery has been pending > 5 minutes — that's the silent-failure tripwire for the whole console subsystem.
