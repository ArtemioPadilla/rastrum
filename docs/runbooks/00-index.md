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
| [`admin-chrome-rendering.md`](admin-chrome-rendering.md) | Why every `/console/*` and `/consola/*` page MUST use `ConsoleLayout` (sidebar + role pills + keybindings invariant). |

## Auth (Module 04)

| Runbook | Covers |
|---|---|
| [`auth.md`](auth.md) | Magic link, Google/GitHub OAuth, email OTP, passkey, sign-out-everywhere — supported methods table + load-bearing invariants (`flowType:'pkce'`, `resolveObserverRef()`, `onAuthChange`) + cross-refs to known pitfalls. |
| [`resend-smtp.md`](resend-smtp.md) | Custom SMTP setup (Resend) for magic-link + sponsor threshold emails (also indexed under Operator hygiene). |

## Research workflow (Modules 28-32, v1.2)

| Runbook | Covers |
|---|---|
| [`community-discovery.md`](community-discovery.md) | M28 — `recompute-user-stats` cron, dual privacy-gated views, country picker. |
| [`projects-anp.md`](projects-anp.md) | M29 — ANP polygons, auto-tag trigger, `upsert_project` SECURITY DEFINER. |
| [`cli-batch-import.md`](cli-batch-import.md) | M30 — `rastrum-import` CLI for camera-trap memory cards. |
| [`camera-stations.md`](camera-stations.md) | M31 — camera station schema + `station_trap_nights()` for sampling effort. |
| [`multi-provider-vision.md`](multi-provider-vision.md) | M32 — six vision providers (Anthropic, Bedrock, OpenAI, Azure, Gemini, Vertex). |
| [`sponsor-pools.md`](sponsor-pools.md) | M27/M32 — platform-wide call pool + `consume_pool_slot` RPC. |
| [`taxa-enrichment.md`](taxa-enrichment.md) | `enrich-taxon` EF + GBIF lineage backfill (kingdom→genus). |
| [`range-outlier-alert.md`](range-outlier-alert.md) | M35 — submit-time outlier alert, `taxon_range_index`, weekly `refresh-taxon-ranges` cron, modal copy. |
| [`vision-providers-secrets.md`](vision-providers-secrets.md) | M32 — `vision-providers-smoke.yml` workflow: which secrets the six providers need and where to set them. |
| [`taxonomy-references.md`](taxonomy-references.md) | Authoritative taxonomy sources for Mexico (CONABIO/GBIF/NOM-059/CITES) and how Rastrum reconciles them (#347). |
| [`conservation-status-etl.md`](conservation-status-etl.md) | `refresh-conservation-status` EF + `backfill-conservation-status.mjs` — NOM-059/IUCN/CITES ingestion (#550). |

## Observation flow (Modules 02 / 03)

| Runbook | Covers |
|---|---|
| [`obs-detail-redesign.md`](obs-detail-redesign.md) | Two-column layout, manage panel, atomic photo delete via `delete_photo_atomic` RPC. |
| [`observe-progressive-card.md`](observe-progressive-card.md) | Epic #1129 — progressive result card (S0–S3/S2′), sovereignty + R1–R3 consensus invariants, `review_requested` queue routing, downloads-by-capability chooser. |

## Explore + browsing

| Runbook | Covers |
|---|---|
| [`explore-ui.md`](explore-ui.md) | `/explore/{recent,species,watchlist}/` surfaces — components, locale-pair invariants, locale-neutral `share/obs/?id=` rule, `mv_recent_species` column-name pitfall, sign-in gating, MegaMenu wiring. |

## Identifier registry (Module 13)

| Runbook | Covers |
|---|---|
| [`add-identifier.md`](add-identifier.md) | Three-step recipe to add a new model / service to the cascade. |
| [`on-device-vision-fallback.md`](on-device-vision-fallback.md) | Phi (MLC) + Gemma (transformers.js) dual-runtime resilience story; opt-in flags; what to do when one crashes. |
| [`contextual-suggestions.md`](contextual-suggestions.md) | Issue #723 — `probable_taxa_at()` RPC + chip strip on `/observe`. |
| [`chat-improvements.md`](chat-improvements.md) | M01 chat redesign — Gemma 4 text backbone + entity-context (observation/species/project/camera_station/observer/self_profile) + 5 read-only tools + 1-round tool-call loop. |
| [`phi-gemma3-evaluation.md`](phi-gemma3-evaluation.md) | Evaluation of swapping Phi-3.5-vision for Gemma 4 E2B as the on-device vision backbone (#638) — recommendation: adopt Gemma 4 (already deployed). |

## Karma + reputation (Module 23)

| Runbook | Covers |
|---|---|
| [`karma-phase-1-post-merge-verification.md`](karma-phase-1-post-merge-verification.md) | Phase 1 deploy verification — schema + cache + recompute cron. |
| [`falta-dex.md`](falta-dex.md) | M08 — taxonomic gaps panel + region pool baseline (Option A: own data) + showMissing localStorage. |
| [`streak-freezes.md`](streak-freezes.md) | Auto-consumed credits that preserve streaks on missed days (+1 per 7-day milestone, hard cap 2) (#866). |

## Social graph (Module 26)

| Runbook | Covers |
|---|---|
| [`social-features.md`](social-features.md) | Inbox polling, reactions self-hydration, ReportDialog, FollowButton states. |
| [`deprecate-profile-public.md`](deprecate-profile-public.md) | Deprecation plan for the legacy `users.profile_public` boolean superseded by the M25 `profile_privacy` matrix (#251). |

## Notifications (Modules ux-streak-push + 34)

| Runbook | Covers |
|---|---|
| [`kairos-prompts.md`](kairos-prompts.md) | M34 — golden-hour push, `kairos-fire` 15-min cron, hard 1-per-day cap, manual fire instructions, VAPID prod-deploy checklist. |
| [`vapid-keys-deploy.md`](vapid-keys-deploy.md) | VAPID keys standalone runbook — what they are, one-time setup (4 steps), key rotation, SW registration, failure modes, secrets inventory. Closes #815. |
| [`weekly-digest.md`](weekly-digest.md) | `weekly-digest` + `email-unsubscribe` Edge Functions — Monday digest schedule, opt-out flow, secrets (#868). |

## Security audit + hardening

| Runbook | Covers |
|---|---|
| [`accepted-advisor-findings.md`](accepted-advisor-findings.md) | Rationale + suppression list for Supabase Database Advisor findings we accept (post #828/#829). |
| [`anon-rate-limit.md`](anon-rate-limit.md) | Postgres-backed per-IP rate limit for unauthenticated Edge Function callers (replaces the in-memory `globalThis` map). |
| [`leaked-password-protection.md`](leaked-password-protection.md) | Enabling Supabase Auth HIBP breach-detection for sign-up + password change. |
| [`per-function-grant-audit.md`](per-function-grant-audit.md) | Per-`SECURITY DEFINER`-function grant audit replacing the blanket grant (#834). |
| [`security-smoke-test.md`](security-smoke-test.md) | Production smoke test for the Security Advisor remediation (#828 view flips + #829 grants). |
| [`storage-security.md`](storage-security.md) | RLS on the `media` bucket — preventing anonymous bulk LIST while keeping signed reads working. |
| [`supabase-spatial-ref-sys-ticket.md`](supabase-spatial-ref-sys-ticket.md) | Open Supabase support ticket — `spatial_ref_sys` RLS false-positive in the advisor (#839). |

## Operator hygiene + ops

| Runbook | Covers |
|---|---|
| [`roadmap-id-map.md`](roadmap-id-map.md) | Bridge from `progress.json` ids → the primary doc/runbook/spec/CLAUDE.md section that covers them. The single-hop lookup for "where is the doc for feature X?". |
| [`onboarding-events.md`](onboarding-events.md) | DOM events + Anthropic-key probe + first-run telemetry. |
| [`posthog.md`](posthog.md) | PostHog snippet wiring, captured events, reverse-proxy verification, token rotation. |
| [`themes.md`](themes.md) | Seasonal + regional theme variants (`monarca` / `lluvias` / `secas` / `default`) — auto-resolution, manual override, and how to add a new season. |
| [`ci-smoke-checks.md`](ci-smoke-checks.md) | `infra/smoke-model-assets.sh` post-deploy + nightly probe. |
| [`ef-serving-layer-recovery.md`](ef-serving-layer-recovery.md) | Edge Function 404 despite ACTIVE — Supabase serving-layer drop, the CLI `No change found` no-op trap, bundle-hash-bust recovery + post-deploy runtime gate. |
| [`sw-cache.md`](sw-cache.md) | Service-worker cache layout, invalidation, debugging stale assets. |
| [`resend-smtp.md`](resend-smtp.md) | Custom SMTP setup (Resend) for magic-link + sponsor threshold emails. |
| [`rotate-secret.md`](rotate-secret.md) | Secret rotation playbook — Supabase, R2, sponsor pool credentials. |
| [`post-launch-improvements.md`](post-launch-improvements.md) | Post-launch backlog of operational hardening items. |
| [`stripe-pro-tier.md`](stripe-pro-tier.md) | (Future) Stripe pro tier — design notes, deferred to v2.0. |
| [`tauri-android.md`](tauri-android.md) | Tauri v2 Android wrapper — local toolchain prereqs, dev/build workflow, signing keystore, Play Store internal-track upload. |
| [`ux-backlog.md`](ux-backlog.md) | Per-item rationale for v1.1 UX polish items. |
| [`cron-secret-rotation.md`](cron-secret-rotation.md) | `CRON_SECRET` rotation playbook — Vault first, then GitHub Secret, then re-run `db-apply`. |
| [`mcp-proxy.md`](mcp-proxy.md) | `mcp.rastrum.org` Cloudflare routing for the MCP Edge Function (header + path manipulation, no Worker runtime). |
| [`onboarding-funnel.md`](onboarding-funnel.md) | First-30-days onboarding-funnel telemetry — drop-off cliffs + retention interventions (#878). |
| [`onboarding-patterns-audit.md`](onboarding-patterns-audit.md) | 2026-05-22 audit of the current tour against Mobbin's 1000-app onboarding study — strengths, gaps, recommended v1.2 sequencing. |
| [`tours.md`](tours.md) | All 3 tour surfaces (OnboardingTour, JourneySpotlight + 6 guides, ConsoleOnboarding) — current status, replay events, known issues. |
| [`tours-backlog.md`](tours-backlog.md) | Surfaces that should have guided tours but don't, ranked by impact. |
| [`performance-audit.md`](performance-audit.md) | Cache + performance optimization workflow — `npm run analyze` bundle visualiser, Lighthouse budgets (#713). |
| [`sw-pmtiles-verification.md`](sw-pmtiles-verification.md) | Post-deploy verification that SW pmtiles caching works in the browser (#639). |
