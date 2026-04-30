# Runbooks index

Operator playbooks for shipped modules. Each runbook covers a specific
oncall / deploy / incident scenario; see the Module specs at
[`../specs/modules/00-index.md`](../specs/modules/00-index.md) for design
rationale and [`../architecture.md`](../architecture.md) for the
high-level system view.

## Admin console (Module 24)

| Runbook | Covers |
|---|---|
| [`admin-bootstrap.md`](admin-bootstrap.md) | First-time operator onboarding to `/console/`. |
| [`admin-audit.md`](admin-audit.md) | Reading the `admin_audit` log; queries by actor, action, time. |
| [`admin-ops.md`](admin-ops.md) | Per-action playbook for every privileged Edge Function handler. |
| [`admin-entity-browsers.md`](admin-entity-browsers.md) | Reading the 7 read-only browsers (Identifications, Notifications, Media, Follows, Watchlists, Projects, Taxon changes). |
| [`admin-anomalies.md`](admin-anomalies.md) | Hourly `detect_admin_anomalies()` cron + investigating the Anomalies tab. |
| [`admin-function-errors.md`](admin-function-errors.md) | `function_errors` sink + bulk acknowledgement workflow. |
| [`admin-health-digest.md`](admin-health-digest.md) | Weekly health snapshot + manual `health.recompute`. |
| [`admin-time-bounded-roles.md`](admin-time-bounded-roles.md) | Time-bounded role grants + `auto_revoke_expired_roles()` cron. |
| [`admin-trust-scores.md`](admin-trust-scores.md) | Moderator trust score formula (anomaly + overturn + active-days + recency). |
| [`admin-two-person-rule.md`](admin-two-person-rule.md) | `admin_action_proposals` table + `enforce_two_person_irreversible` flag. |
| [`admin-webhooks.md`](admin-webhooks.md) | Outbound HMAC-SHA256 webhooks + `_meta` envelope replay protection + reconcile cron. |
| [`role-model.md`](role-model.md) | `has_role()` RLS predicate + admin/moderator/expert hierarchy. |

## Research workflow (Modules 28-32, v1.2)

| Runbook | Covers |
|---|---|
| [`community-discovery.md`](community-discovery.md) | M28 — `recompute-user-stats` cron, dual privacy-gated views, country picker. |
| [`projects-anp.md`](projects-anp.md) | M29 — ANP polygons, auto-tag trigger, `upsert_project` SECURITY DEFINER. |
| [`cli-batch-import.md`](cli-batch-import.md) | M30 — `rastrum-import` CLI for camera-trap memory cards. |
| [`camera-stations.md`](camera-stations.md) | M31 — camera station schema + `station_trap_nights()` for sampling effort. |
| [`multi-provider-vision.md`](multi-provider-vision.md) | M32 — six vision providers (Anthropic, Bedrock, OpenAI, Azure, Gemini, Vertex). |
| [`sponsor-pools.md`](sponsor-pools.md) | M27/M32 — platform-wide call pool + `consume_pool_slot` RPC. |

## Observation flow (Modules 02 / 03)

| Runbook | Covers |
|---|---|
| [`obs-detail-redesign.md`](obs-detail-redesign.md) | Two-column layout, manage panel, atomic photo delete via `delete_photo_atomic` RPC. |

## Identifier registry (Module 13)

| Runbook | Covers |
|---|---|
| [`add-identifier.md`](add-identifier.md) | Three-step recipe to add a new model / service to the cascade. |

## Karma + reputation (Module 23)

| Runbook | Covers |
|---|---|
| [`karma-phase-1-post-merge-verification.md`](karma-phase-1-post-merge-verification.md) | Phase 1 deploy verification — schema + cache + recompute cron. |

## Social graph (Module 26)

| Runbook | Covers |
|---|---|
| [`social-features.md`](social-features.md) | Inbox polling, reactions self-hydration, ReportDialog, FollowButton states. |

## Operator hygiene + ops

| Runbook | Covers |
|---|---|
| [`onboarding-events.md`](onboarding-events.md) | DOM events + Anthropic-key probe + first-run telemetry. |
| [`ci-smoke-checks.md`](ci-smoke-checks.md) | `infra/smoke-model-assets.sh` post-deploy + nightly probe. |
| [`sw-cache.md`](sw-cache.md) | Service-worker cache layout, invalidation, debugging stale assets. |
| [`resend-smtp.md`](resend-smtp.md) | Custom SMTP setup (Resend) for magic-link + sponsor threshold emails. |
| [`rotate-secret.md`](rotate-secret.md) | Secret rotation playbook — Supabase, R2, sponsor pool credentials. |
| [`post-launch-improvements.md`](post-launch-improvements.md) | Post-launch backlog of operational hardening items. |
| [`stripe-pro-tier.md`](stripe-pro-tier.md) | (Future) Stripe pro tier — design notes, deferred to v2.0. |
| [`ux-backlog.md`](ux-backlog.md) | Per-item rationale for v1.1 UX polish items. |
