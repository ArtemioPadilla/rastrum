# Rastrum Tasks — Phase Summary

> **Skim-friendly view of [`docs/tasks.json`](tasks.json) + [`docs/progress.json`](progress.json).**
> Source of truth for both surfaces; renders the live page at
> [/docs/tasks/](https://rastrum.org/en/docs/tasks/).
> 
> **Updated:** 2026-04-27 (post-launch + v1.1 UX brainstorm shipped).

---

## At a glance

| Phase | Name | Status | Done / Total |
|---|---|---|---|
| v0.1 | Alpha MVP (online-first) | done | 14 / 14 |
| v0.3 | Offline intelligence + activity | done | 11 / 11 |
| v0.5 | Beta | shipped (partial) | 11 / 13 |
| v1.0 | Public Launch | shipped (partial) | 18 / 21 |
| v1.0.x | Post-launch polish | in_progress | 6 / 22 |
| v1.1 | UX polish (post-launch brainstorm) | planned | 13 / 15 |
| **v0.1 → v1.0** | **Public launch** | **shipped 2026-04-26** | **54 / 59** |

Phases v1.5, v2.0, v2.5 are tracked in [`progress.json`](progress.json) but have no shipped code yet — they are planned scope only.

Rationale for each v1.1 UX item lives in [`docs/runbooks/ux-backlog.md`](runbooks/ux-backlog.md).

---

## v0.1 — Alpha MVP (online-first) — done

**14 of 14 items done.**

All items shipped. ✅

## v0.3 — Offline intelligence + activity — done

**11 of 11 items done.**

All items shipped. ✅

## v0.5 — Beta — in progress / planned

**11 of 13 items done.**

Remaining:

- `gbif-ipt` — GBIF IPT pilot publish (Darwin Core Archive ZIP)  _(! blocked: GBIF publisher account + IPT host (DwC-A generator landed))_
- `local-contexts` — Local Contexts BC/TK Notice integration  _(! blocked: Governance track — community consent before code)_

## v1.0 — Public Launch — in progress / planned

**18 of 21 items done.**

Remaining:

- `bioblitz-events-ui` — Bioblitz events — UI (event detail page, live aggregates, participation badges)  _(! blocked: Build when first community organizer requests one — speculative without a pilot event)_
- `capacitor-ios` — Capacitor iOS App Store wrapper (v1.2)  _(! blocked: Apple Developer Program ($99/yr) + Capacitor build pipeline)_
- `oauth-custom-domain` — Custom auth domain on Supabase OAuth (auth.rastrum.org instead of raw Supabase URL)  _(! blocked: Supabase Pro plan ($25/mo) — deferred for zero-cost target)_

## v1.0.x — Post-launch polish — in_progress

**6 of 22 items done.**

Remaining:

- `megadetector-bbox-cascade-server` — Server-side bbox crop on the identify Edge Function so Claude + PlantNet also receive an animal-only crop  _(· planned — Phi-side already shipped via the client cascade in `megadetector-bbox-cascade`)_
- `speciesnet-distilled` — Distilled SpeciesNet for on-device animal classification (~100 MB ONNX, iWildCam categories) so common camera-trap species don't need cloud LLMs  _(· planned)_
- `arch-diagram-parallel` — Update architecture page cascade SVG to show parallel race (currently shows serial waterfall)  _(· planned)_
- `identify-server-cascade` — Move runParallelIdentify to identify Edge Function for server-side parity (currently client-only)  _(· planned)_
- `inapp-camera-secondary` — Re-introduce in-app getUserMedia camera as secondary 'preview' path with system camera staying primary  _(! blocked: Awaits feedback from real users — deferred from v1.0 because system camera is more reliable on test devices. GitHub issue #18)_
- `expert-app-admin-ui` — Admin review UI for expert_applications (schema shipped v1.0; admin approve/reject UX missing)  _(· planned)_
- `bioblitz-events-ui-poll` — Bioblitz event detail UI — build when first community organizer requests one  _(! blocked: Speculative without a pilot event. Reshelved here from v1.0 alongside its schema sibling.)_
- `plantnet-quota-monitor` — Alerting / dashboard for PlantNet daily-quota usage (500/day shared); fall through gracefully when exhausted  _(· planned)_
- `oauth-logo-google` — Upload Rastrum logo + privacy/terms URLs at Google Cloud Console OAuth consent screen  _(! blocked: Manual operator action — see GitHub issue #3)_
- `oauth-logo-github` — Upload Rastrum logo at GitHub Developer Settings OAuth app  _(! blocked: Manual operator action — see GitHub issue #3)_
- `tasks-json-deepfill` — Deepen tasks.json subtask granularity where 3-subtask backfill is thin (esp. v1.0 social + tokens items)  _(· planned)_
- `issue-5-gps-retest` — GPS auto-fill retest on Eugenio's Android device — fix shipped, awaiting confirmation  _(! blocked: Awaits real-device retest — see GitHub issue #5)_
- `issue-18-camera-retest` — 'Tomar foto' retest on Eugenio's Android — Android-specific hint shipped, awaiting confirmation  _(! blocked: Awaits real-device retest — see GitHub issue #18)_
- `smoke-test-nightly` — Nightly cron-fired Playwright smoke test against production rastrum.org (currently only PR-triggered)  _(· planned)_
- `license-per-record-ui` — UI for per-observation license selection (CC-BY default; CC0, CC-BY-NC, all-rights-reserved options)  _(· planned)_
- `docs-toc-mobile` — Sticky scrollspy TOC pill row on mobile doc pages (auto-extracts h2s, IntersectionObserver active state)  _(! blocked: Open PR #23 — pending rebase + aria-current fix; reviewed and approved-with-comments)_

## v1.1 — UX polish (post-launch brainstorm) — planned

**13 of 15 items done.**

Remaining:

- `ux-indigenous-taxa-search` — Indigenous-language taxon search (Zapoteco / Náhuatl / Maya / Mixteco / Tseltal → scientific name); requires corpus + governance per local-contexts  _(! blocked: Needs corpus partnership (CONABIO + community Co-PIs) and governance review before code lands)_
- `ux-streak-push` — Web Push notification at 8 PM local when a streak is 1 day from breaking — opt-in only, single nightly notification  _(· planned)_
