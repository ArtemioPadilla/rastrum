# Roadmap id ↔ doc map

Bridge from `docs/progress.json` item ids → the primary doc, runbook,
spec, code anchor, or CLAUDE.md section that covers them. Audit-fixing
companion to the runbook + module-spec indexes — written 2026-05-20 to
close the doc-coverage gap surfaced by the post-#1129 sweep (112
shipped items had no runbook/spec mention of their id string).

> **Reading order.** Most rows point you somewhere richer than this
> table. Treat this file as the lookup, not the source of truth — the
> destination doc is. The intent is: given a `progress.json` id, find
> its canonical doc in one hop.

> **Scaffolding items** (Astro/Tailwind setup, CI/CD wiring, unit-test
> scaffold, domain migrations) are honestly labeled "no dedicated doc
> — see <X>" rather than pretending they have a runbook. The link
> still puts you within one click of the load-bearing code or
> convention.

## v0.1 — Alpha MVP

| id | Gloss | Primary doc |
|---|---|---|
| `astro-skeleton` | Astro + Tailwind + i18n base. | CLAUDE.md § Architecture cheatsheet + `src/layouts/BaseLayout.astro`. Scaffolding — no dedicated runbook. |
| `auth-magic-link` | Supabase magic-link auth + guest mode. | [`auth.md`](auth.md), [`resend-smtp.md`](resend-smtp.md). |
| `auth-multi` | Google + GitHub OAuth, email OTP, passkey, sign-out-everywhere. | [`auth.md`](auth.md). |
| `ci-cd` | GitHub Actions: typecheck/test/build/deploy. | CLAUDE.md § Pre-PR checklist + `.github/workflows/`. Scaffolding. |
| `profile-basics` | Profile page + edit + avatar dropdown (M08). | [`social-features.md`](social-features.md), [`auth.md`](auth.md). |
| `gps-observation` | GPS-tagged observation form + EXIF auto-fill. | [`obs-detail-redesign.md`](obs-detail-redesign.md), [`cli-batch-import.md`](cli-batch-import.md) (EXIF-parsing parity contract). |
| `plantnet-id` | PlantNet photo ID integration. | [`add-identifier.md`](add-identifier.md) + `src/lib/identifiers/plantnet.ts`. |
| `claude-haiku-id` | Claude Haiku 4.5 vision cascade. | [`add-identifier.md`](add-identifier.md), [`multi-provider-vision.md`](multi-provider-vision.md). |
| `map-view` | MapLibre clustered observation pins. | [`community-discovery.md`](community-discovery.md) (community map), [`sw-cache.md`](sw-cache.md). |
| `darwin-core-csv` | DwC CSV export + format presets. | [`gbif-ipt.md`](../gbif-ipt.md) + `src/lib/darwin-core.ts`. |
| `pwa-manifest` | PWA manifest + SW shell cache. | [`sw-cache.md`](sw-cache.md), [`sw-pmtiles-verification.md`](sw-pmtiles-verification.md). |
| `offline-queue` | Dexie outbox + sync engine + `triggerIdentify()`. | [`observe-progressive-card.md`](observe-progressive-card.md) (R1–R3 sync invariants) + `src/lib/sync.ts`. |
| `unit-tests` | Vitest scaffold + DwC mapping tests. | CLAUDE.md § Pre-PR checklist. Scaffolding. |

## v0.3 — Offline intelligence + activity

| id | Gloss | Primary doc |
|---|---|---|
| `activity-feed` | Activity feed + server-side triggers (M08). | [`social-features.md`](social-features.md). |
| `unread-badge` | Unread count on avatar dropdown. | [`social-features.md`](social-features.md) (inbox bell pattern). |
| `sensitive-privacy` | NOM-059 / CITES obscuration in obs form. | CLAUDE.md § RLS and privacy invariants, [`deprecate-profile-public.md`](deprecate-profile-public.md). |
| `exif-extraction` | EXIF/XMP/ID3 auto-extraction in obs form. | [`cli-batch-import.md`](cli-batch-import.md) (parity contract). |
| `byo-anthropic-key` | BYO Anthropic key (client-set, never persisted). | [`multi-provider-vision.md`](multi-provider-vision.md), [`vision-providers-secrets.md`](vision-providers-secrets.md). |
| `webllm-text` | WebLLM Llama-3.2-1B for translation + field notes (M11). | [`chat-improvements.md`](chat-improvements.md), [`on-device-vision-fallback.md`](on-device-vision-fallback.md). |
| `onnx-base` | EfficientNet-Lite0 ONNX fallback (~18 MB INT8). | [`add-identifier.md`](add-identifier.md), [`observe-progressive-card.md`](observe-progressive-card.md) (R2 confidence cap). |
| `offline-maps` | pmtiles offline MX download (~48 MB). | [`sw-pmtiles-verification.md`](sw-pmtiles-verification.md), [`sw-cache.md`](sw-cache.md). |
| `webllm-default` | WebLLM as default AI fallback + first-use warning. | [`on-device-vision-fallback.md`](on-device-vision-fallback.md). |
| `identification-block` | ID block in obs form (spinner + chip + manual). | [`observe-progressive-card.md`](observe-progressive-card.md) (now subsumed by the progressive card). |
| `gps-two-pass` | Two-pass GPS (coarse → refinement). | [`obs-detail-redesign.md`](obs-detail-redesign.md). |

## v0.5 — Beta

| id | Gloss | Primary doc |
|---|---|---|
| `eco-evidence` | Evidence fields (track/scat/burrow/nest/feather/bone/sound/camera_trap). | [`obs-detail-redesign.md`](obs-detail-redesign.md), [`camera-stations.md`](camera-stations.md). |
| `discovery-badges` | 39 seed badges + nightly evaluator EF. | [`karma-phase-1-post-merge-verification.md`](karma-phase-1-post-merge-verification.md), [`streak-freezes.md`](streak-freezes.md). |
| `webllm-vision` | WebLLM Phi-3.5-vision (opt-in, capped ≤ 0.4). | [`on-device-vision-fallback.md`](on-device-vision-fallback.md), [`phi-gemma3-evaluation.md`](phi-gemma3-evaluation.md), [`observe-progressive-card.md`](observe-progressive-card.md) (R2). |
| `quality-gates` | Confidence ≥ 0.4 research-grade floor. | [`observe-progressive-card.md`](observe-progressive-card.md) (R2 invariant; `tests/unit/consensus-untouched.test.ts` is the byte-frozen guard). |
| `consensus-workflow` | 2/3 identifier consensus + anti-sybil + expert 3× weight. | [`observe-progressive-card.md`](observe-progressive-card.md) (R1/R3), `docs/specs/infra/supabase-schema.sql` § `recompute_consensus`. |
| `byo-keys-platform` | Per-plugin BYO API keys + guided setup (M13). | [`add-identifier.md`](add-identifier.md), [`multi-provider-vision.md`](multi-provider-vision.md). |
| `token-rest-api` | Token-auth REST: `/api/{observe,identify,observations,export}`. | CLAUDE.md § Useful URLs (API tokens page) + `supabase/functions/api/`. |
| `token-ui` | Token management UI at `/perfil/tokens` + `/profile/tokens`. | Sibling of `token-rest-api`; see CLAUDE.md § Useful URLs. |

## v1.0 — Public Launch

| id | Gloss | Primary doc |
|---|---|---|
| `shareable-cards` | `share/obs/{id}.png` OG card EF + public page. | CLAUDE.md § A new top-level route (with social-share preview), [`obs-detail-redesign.md`](obs-detail-redesign.md). |
| `expert-system` | Expert taxonomic 3× weight in consensus. | [`observe-progressive-card.md`](observe-progressive-card.md) (R3 + consensus-untouched guard). |
| `bioblitz-events-schema` | Bioblitz events schema (table + polygon + RLS). | [`admin-ops.md`](admin-ops.md) (Bioblitz console tab). |
| `institutional-export` | DwC + SNIB + CONANP CSV presets. | [`gbif-ipt.md`](../gbif-ipt.md). |
| `credentialed-access` | `credentialed_researcher` + precise-coord RLS gate. | CLAUDE.md § RLS and privacy invariants. |
| `env-enrichment` | Lunar phase + OpenMeteo EF (auto on sync). | `supabase/functions/enrich-environment/` (no dedicated runbook; cron config in `cron-schedules.sql`). |
| `camera-trap-ingest` | Camera-trap batch importer + on-device MegaDetector v5a. | [`camera-stations.md`](camera-stations.md), [`cli-batch-import.md`](cli-batch-import.md). |
| `follows-comments-ui` | Follows + threaded comments + watchlist alerts UI. | [`social-features.md`](social-features.md). |
| `camera-getUserMedia` | In-app `getUserMedia` camera + capture=environment fallback. | [`obs-detail-redesign.md`](obs-detail-redesign.md) (#18 retest blocked). |
| `batch-exif-importer` | Batch photo importer with EXIF (M19). | [`cli-batch-import.md`](cli-batch-import.md). |
| `rastrum-org-domain` | Canonical domain migration to rastrum.org. | CLAUDE.md § Known pitfalls (media.rastrum.app retired, etc.). |
| `ux-revamp-pr1-ia-chrome` | UX revamp: IA + chrome rebuild. | CLAUDE.md § Chrome / IA conventions + `docs/superpowers/specs/2026-04-26-ux-revamp-design.md`. |

## v1.0.x — Post-launch polish

| id | Gloss | Primary doc |
|---|---|---|
| `arch-diagram-parallel` | Architecture-page cascade SVG → parallel race. | [`../architecture.md`](../architecture.md). |
| `megadetector-hosting-recipe` | One-shot v5a → ONNX conversion under `infra/megadetector/`. | `infra/megadetector/convert.sh` + [`add-identifier.md`](add-identifier.md). |
| `ci-smoke-model-assets` | Post-deploy + nightly URL smoke probe. | [`ci-smoke-checks.md`](ci-smoke-checks.md). |
| `chat-phi-autoload` | Auto-load cached Phi-3.5-vision (no re-prompt). | [`chat-improvements.md`](chat-improvements.md). |
| `chat-improvements-v1-1` | Chat v1.1: Gemma 4 E2B + entity-context + 5 tools. | [`chat-improvements.md`](chat-improvements.md). |
| `install-discoverability` | Earlier PWA install prompt + iOS A2HS walkthrough. | [`ux-backlog.md`](ux-backlog.md), [`onboarding-funnel.md`](onboarding-funnel.md). |
| `smoke-test-nightly` | Nightly cron-fired Playwright vs production. | [`ci-smoke-checks.md`](ci-smoke-checks.md). |
| `explore-recent-ui` | `/explore/recent/` 20-obs grid. | [`explore-ui.md`](explore-ui.md). |
| `explore-species-ui` | `/explore/species/` index + `?slug=` detail. | [`explore-ui.md`](explore-ui.md). |
| `explore-watchlist-ui` | `/explore/watchlist/` + signed-out CTA. | [`explore-ui.md`](explore-ui.md). |
| `posthog-analytics` | Reverse-proxy snippet + 14 capture sites + autocapture. | [`posthog.md`](posthog.md). |
| `observe-ai-progressive-card` | Epic #1129 (already indexed). | [`observe-progressive-card.md`](observe-progressive-card.md). |

## v1.1 — UX polish + admin console

| id | Gloss | Primary doc |
|---|---|---|
| `ux-onboarding-v2` | 4-step onboarding (explain → configure → summary → install). | [`onboarding-events.md`](onboarding-events.md), [`onboarding-funnel.md`](onboarding-funnel.md). |
| `owner-observation-crud` | Manage panel (edit notes / override taxon / change obscure / delete). | [`obs-detail-redesign.md`](obs-detail-redesign.md). |
| `delete-observation-atomic` | Atomic delete EF — wipes R2 + OG card + DB rows. | [`obs-detail-redesign.md`](obs-detail-redesign.md). |
| `suggest-from-share-page` | Suggest ID from any `/share/obs/` (community list visible to all). | [`social-features.md`](social-features.md). |
| `og-pipeline` | Build-time satori PNGs + sync-time client rendering. | CLAUDE.md § A new top-level route. |
| `karma-phase-1-foundation` | Karma engine — schema + computation + UI (Phase 1). | [`karma-phase-1-post-merge-verification.md`](karma-phase-1-post-merge-verification.md). |
| `admin-console-foundation` | PR1: schema + chrome + EF + Overview/Experts/Audit tabs. | [`admin-bootstrap.md`](admin-bootstrap.md), [`admin-audit.md`](admin-audit.md). |
| `admin-console-pr2-users-credentials` | Users + Credentials tabs + role grants UI. | [`admin-ops.md`](admin-ops.md), [`role-model.md`](role-model.md). |
| `admin-console-pr3-ops-tabs` | Sync + API + Cron read-only ops tabs. | [`admin-ops.md`](admin-ops.md). |
| `admin-console-pr4-observations` | Observations admin tab + 4 obs handlers. | [`admin-ops.md`](admin-ops.md), [`admin-entity-browsers.md`](admin-entity-browsers.md). |
| `admin-console-pr5-moderator` | Moderator console: Flag queue + Comments + Soft-bans + 9 handlers. | [`admin-ops.md`](admin-ops.md). |
| `admin-console-pr6-expert` | Expert console: Overview + Validation queue + Your expertise. | [`admin-ops.md`](admin-ops.md). |
| `admin-overview-real-kpis` | Real platform-state KPIs + alerts + recent activity. | [`admin-health-digest.md`](admin-health-digest.md). |
| `admin-console-pr7-remaining-admin` | Badges + Taxa + Karma + Features + Bioblitz tabs. | [`admin-ops.md`](admin-ops.md). |
| `admin-console-pr8-hardening` | CORS tighten + token-bucket + pgTAP RLS + DB-backed feature flags. | [`admin-ops.md`](admin-ops.md), [`security-smoke-test.md`](security-smoke-test.md), [`anon-rate-limit.md`](anon-rate-limit.md). |
| `admin-console-pr9-quick-actions` | Reason templates + URL filter state + g-prefix keybindings + mobile sheet. | [`admin-ops.md`](admin-ops.md). |
| `admin-console-pr10-subject-ux` | Ban banner + appeals + comment lock + hidden-obs owner badge. | [`admin-ops.md`](admin-ops.md). |
| `admin-console-pr11-engineering` | Postgres token-bucket RPC + flash polish + handler-registry test. | [`admin-ops.md`](admin-ops.md). |
| `admin-console-pr12-observability` | Anomaly cron + weekly digest + forensics CSV + structured errors sink. | [`admin-anomalies.md`](admin-anomalies.md), [`admin-function-errors.md`](admin-function-errors.md). |
| `admin-console-pr13-future-proofing` | Time-bounded roles + two-person rule + HMAC webhooks + trust primitive. | [`admin-time-bounded-roles.md`](admin-time-bounded-roles.md), [`admin-two-person-rule.md`](admin-two-person-rule.md), [`admin-webhooks.md`](admin-webhooks.md), [`admin-trust-scores.md`](admin-trust-scores.md). |
| `admin-console-pr14-deferred-cleanup` | Per-admin tz, webhook `_meta` replay, real trust formula, irreversible gate. | [`admin-trust-scores.md`](admin-trust-scores.md), [`admin-webhooks.md`](admin-webhooks.md), [`admin-two-person-rule.md`](admin-two-person-rule.md). |
| `admin-console-pr15-observability-ui` | Health digest cards + Errors browser + per-webhook deliveries drilldown. | [`admin-health-digest.md`](admin-health-digest.md), [`admin-function-errors.md`](admin-function-errors.md), [`admin-webhooks.md`](admin-webhooks.md). |
| `admin-console-pr16-entity-browsers` | 7 read-only browsers on shared `ConsoleEntityBrowser`. | [`admin-entity-browsers.md`](admin-entity-browsers.md). |
| `community-observers-pr17-ux-fixes` | Privacy banner + set-country CTA + GPS Nearby + bug-fix sweep. | [`community-discovery.md`](community-discovery.md). |
| `console-chrome-rendering-fix` | All 70 console pages flipped to `ConsoleLayout`. | [`admin-chrome-rendering.md`](admin-chrome-rendering.md). |

## v1.2 — Privacy + social graph + research workflow

| id | Gloss | Primary doc |
|---|---|---|
| `profile-privacy-matrix` | 19-facet privacy matrix + 3 presets + `can_see_facet()` RPC (M25). | [`deprecate-profile-public.md`](deprecate-profile-public.md) + `docs/specs/modules/25-profile-privacy.md`. |
| `public-profile-route` | `/u/<username>/` hero + map + heatmap + top species. | [`social-features.md`](social-features.md). |
| `profile-widgets-richer` | Taxonomic donut + streak ring + top species + heatmap. | [`social-features.md`](social-features.md). |
| `social-graph-m26` | M26 follows + reactions + blocks + reports + inbox. | [`social-features.md`](social-features.md). |
| `social-graph-m26-ui` | M26 UI: bell → inbox + FollowButton + ReportDialog + ReactionStrip. | [`social-features.md`](social-features.md). |
| `ci-cd-edge-auto-deploy` | Path-filtered EF auto-deploy on push. | [`ef-serving-layer-recovery.md`](ef-serving-layer-recovery.md). |
| `social-graph-m26-v11` | M26 v1.1 polish (reaction count overlay, block-from-list). | [`social-features.md`](social-features.md). |
| `deploy-functions-resilience` | Pin esm.sh imports to versioned URLs. | [`ef-serving-layer-recovery.md`](ef-serving-layer-recovery.md). |
| `visitor-pokedex-route` | Visitor `/u/<handle>/dex/` public pokedex. | [`falta-dex.md`](falta-dex.md), [`social-features.md`](social-features.md). |
| `ci-rls-presence-check` | `db-validate.yml` fails on any public table without RLS. | [`security-smoke-test.md`](security-smoke-test.md), [`accepted-advisor-findings.md`](accepted-advisor-findings.md), CLAUDE.md § Schema security invariants. |
| `m26-v1-1-review-followups` | Bundled review-comment polish (6 small items). | [`social-features.md`](social-features.md). |
| `community-discovery-m28` | Explore MegaMenu split + `/community/observers/` + Nearby + leaderboard. | [`community-discovery.md`](community-discovery.md). |
| `projects-anp-m29` | ANP polygon projects + auto-tag trigger. | [`projects-anp.md`](projects-anp.md). |
| `cli-batch-import-m30` | `rastrum-import` CLI for camera-trap memory cards. | [`cli-batch-import.md`](cli-batch-import.md). |
| `camera-stations-m31` | Camera stations + sampling-effort schema. | [`camera-stations.md`](camera-stations.md). |
| `multi-provider-vision-m32` | Bedrock/OpenAI/Azure/Gemini/Vertex + per-sponsor + platform pool. | [`multi-provider-vision.md`](multi-provider-vision.md), [`sponsor-pools.md`](sponsor-pools.md), [`vision-providers-secrets.md`](vision-providers-secrets.md). |

## v1.1.5 — Persuasive Tech (Fogg) audit

All `fogg-*` items are documented as a single load-bearing pattern in
CLAUDE.md "Persuasive Tech (Fogg) — v1.1.5 conventions" (rules 1–4 cover
algorithms-as-single-source, theme state machine, honest-norms `n<50`
threshold, and EXIF-only photo praise). The per-item docs are below.

| id | Gloss | Primary doc |
|---|---|---|
| `fogg-quick-observation` | One-tap Quick Observation (`?quick=1` / long-press FAB). | CLAUDE.md § Persuasive Tech (Fogg). |
| `fogg-photo-praise` | EXIF-driven photo praise (`pickPraise(exif)`). | CLAUDE.md § Persuasive Tech (rule 4) + `src/lib/photo-praise.ts`. |
| `fogg-triage-sla` | `/docs/status/` triage SLA dashboard. | CLAUDE.md § Persuasive Tech + `scripts/fetch-gh-issue-stats.ts`. |
| `fogg-active-observers-banner` | `community_active_observers_today()` banner on `/observe`. | [`community-discovery.md`](community-discovery.md). |
| `fogg-falta-dex` | Owner-only "Show missing" silhouette cards. | [`falta-dex.md`](falta-dex.md). |
| `fogg-field-theme` | High-contrast Field theme (Campo). | [`themes.md`](themes.md). |
| `fogg-about-humanized` | Humanized About page (team/funding/governance). | CLAUDE.md § Persuasive Tech. |
| `fogg-why-am-i-seeing-this` | Algorithmic disclosure pill on every ranked surface. | CLAUDE.md § Persuasive Tech (rule 1) + `src/lib/algorithms.ts`. |
| `fogg-cleanup-superseded` | Removes superseded banners/cards (#684/#679/#678). | CLAUDE.md § Persuasive Tech. |
| `fogg-seasonal-themes` | `monarca` / `lluvias` / `secas` / `default` variants. | [`themes.md`](themes.md). |
| `fogg-peer-norms` | License + privacy peer-norm bars (`n < 50` honest). | CLAUDE.md § Persuasive Tech (rule 3) + `src/lib/peer-norms.ts`. |
| `fogg-percentile-card` | `tú-vs-promedio MX` 4-metric card on `/profile/`. | CLAUDE.md § Persuasive Tech (rule 3) + `src/lib/percentile.ts`. |
| `fogg-contextual-suggestions` | `probable_taxa_at()` chip strip on `/observe`. | [`contextual-suggestions.md`](contextual-suggestions.md). |
| `fogg-variable-rewards` | Opt-in "sorpresa de campo" overlay (3 kinds). | CLAUDE.md § Persuasive Tech. |
| `fogg-kairos-prompts` | Opt-in golden-hour push (15–30 min pre-sunset). | [`kairos-prompts.md`](kairos-prompts.md), [`vapid-keys-deploy.md`](vapid-keys-deploy.md). |
| `fogg-ecological-impact-viz` | `/profile/impact/` 5-metric "mi impacto ecológico". | CLAUDE.md § Persuasive Tech. |

## How to keep this current

When you ship a `progress.json` item that warrants a runbook or spec
mention, prefer one of:

1. **Add the id string to the dedicated doc** (in a code-block, header,
   or footer note). This is the cheapest — closes the audit row.
2. **Add a row here** if the natural home is a CLAUDE.md section or a
   non-runbook anchor (e.g. a `src/lib/*.ts` module, a script, a
   workflow file).

The audit is mechanical:

```bash
python3 -c "
import json, os
d=json.load(open('docs/progress.json'))
corpus=''.join(open(os.path.join(r,f),encoding='utf-8').read()
  for r in ('docs/runbooks','docs/specs/modules')
  for f in os.listdir(r) if f.endswith('.md'))
miss=[(p,it['id']) for p,o in d['phases'].items()
      for it in o.get('items',[]) if it.get('done') and it['id'] not in corpus]
print(f'unreferenced shipped ids: {len(miss)}')"
```

A passing repo prints `0`.
