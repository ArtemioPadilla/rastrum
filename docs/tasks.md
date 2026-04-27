# Rastrum Tasks — Phase Summary

> **Skim-friendly view of [`docs/tasks.json`](tasks.json).** The JSON is
> the source of truth and renders the live page at [/docs/tasks/](https://rastrum.org/en/docs/tasks/).
> 
> **Updated:** 2026-04-27 (post-launch cleanup).

---

## At a glance

| Phase | Name | Status | Done / Total |
|---|---|---|---|
| v0.1 | Alpha MVP (online-first) | done | 14 / 14 |
| v0.3 | Offline intelligence + activity | done | 11 / 11 |
| v0.5 | Beta | shipped (partial) | 11 / 13 |
| v1.0 | Public Launch | shipped (partial) | 17 / 20 |
| **v0.1 → v1.0** | **Public launch** | **shipped 2026-04-26** | **53 / 58** |

Phases v1.5, v2.0, v2.5 are tracked in [`progress.json`](progress.json) but have no shipped code yet — they are planned scope only.

---

## v0.1 — Alpha MVP (online-first) — done

**14 of 14 items done.**

All items shipped. ✅

## v0.3 — Offline intelligence + activity — done

**11 of 11 items done.**

All items shipped. ✅

## v0.5 — Beta — shipped (engineering); some items deferred to operator action

**11 of 13 items done.**

Remaining:

- `gbif-ipt` — GBIF IPT pilot publish (Darwin Core Archive ZIP)  _(! blocked: GBIF publisher account + IPT host (DwC-A generator landed))_
- `local-contexts` — Local Contexts BC/TK Notice integration  _(! blocked: Governance track — community consent before code)_

## v1.0 — Public Launch — shipped (engineering); some items deferred to operator action

**17 of 20 items done.**

Remaining:

- `bioblitz-events-ui` — Bioblitz events — UI (event detail page, live aggregates, participation badges)  _(! blocked: Build when first community organizer requests one — speculative without a pilot event)_
- `capacitor-ios` — Capacitor iOS App Store wrapper (v1.2)  _(! blocked: Apple Developer Program ($99/yr) + Capacitor build pipeline)_
- `oauth-custom-domain` — Custom auth domain on Supabase OAuth (auth.rastrum.org instead of raw Supabase URL)  _(! blocked: Supabase Pro plan ($25/mo) — deferred for zero-cost target)_
