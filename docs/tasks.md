# Rastrum Tasks — Phase Summary

> **Skim-friendly view of [`docs/tasks.json`](tasks.json).** The JSON is
> the source of truth for the per-phase progress bars rendered at
> [`/{lang}/docs/tasks/`](https://rastrum.org/en/docs/tasks/). This
> markdown is regenerated when JSON drifts and is intentionally short —
> open the JSON for full subtask detail.
>
> Last sync: 2026-04-27 (post-launch cleanup + chrome revamp). Roadmap source:
> [`docs/progress.json`](progress.json).

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

| Item | Status | Note |
|---|---|---|
| `bioblitz-events-ui` | blocked | Build when first community organizer requests one — speculative without a pilot event |
| `camera-trap-ingest` | partial | UI shipped at `/profile/import/camera-trap`; `camera_trap_megadetector` plugin stub registered; weights operator-hosted (env: `PUBLIC_MEGADETECTOR_ENDPOINT`) |
| `capacitor-ios` | blocked | Apple Developer Program ($99/yr) |
| `oauth-custom-domain` | deferred | Supabase Pro plan ($25/mo) — out of scope for zero-cost target |

Newly closed in this phase:

- **UX revamp PR 1 — IA + chrome rebuild** (2026-04-26): verb-first header, mobile bottom-bar with camera FAB, /explore/{recent,watchlist,species} placeholders, watchlist 301.
- Schema, RLS, Edge Functions: `streaks`, `shareable-cards`,
  `social-features`, `expert-system`, `bioblitz-events`,
  `institutional-export`, `credentialed-access`, `env-enrichment`,
  `video-support`.
- New v1.0 modules: `mcp-server` (module 15), `map-location-picker`
  (module 15 — duplicate prefix), `my-observations` (module 16),
  `camera-getUserMedia` (module 17), `batch-exif-importer` (module 19),
  `follows-comments-ui`.
- Domain migration: `rastrum-org-domain` —
  `rastrum.artemiop.com` → `rastrum.org`.

## v1.5 — Territory Layer — planned

Roadmap: 0 / 5. All five items live as named subtasks in `tasks.json`
but no module spec exists yet. Items: `biodiversity-trails`, `pits-qr`,
`spatial-analysis`, `diversity-indices`, `trail-pdf-export`.

## v2.0 — Institutional — planned

Roadmap: 0 / 5. Items: `camera-trap-advanced`, `gbif-publisher`,
`regional-ml`, `b2g-dashboard`, `inat-bridge`. The `b2g-dashboard` work
requires the Cornell BirdNET commercial license (governance track).

## v2.5 — AI + AR — planned

Roadmap: 0 / 4. Items: `scout-full`, `ar-overlay`, `voice-indigenous`,
`conabio-api`.

---

## Governance track (parallel to all phases)

Tracked in `progress.json` under `governance_track`. Status:

- `license-framework` — done (CC BY / BY-NC / CC0 propagated through DwC export).
- `zapoteco-fpic` — community-led, no shipping date.
- `local-contexts` — community-consent gated.
- `data-sovereignty` — policy draft pending CARI advisory input.
- `birdnet-cornell` — only required for v2.0 commercial use.

---

## Where to look

- **Live progress UI:** [/en/docs/tasks/](https://rastrum.org/en/docs/tasks/)
  · [/es/docs/tareas/](https://rastrum.org/es/docs/tareas/)
- **Roadmap:** [/en/docs/roadmap/](https://rastrum.org/en/docs/roadmap/)
- **Per-item subtasks:** [`docs/tasks.json`](tasks.json) (edit there;
  the page rerenders automatically).
- **Module specs:** [`docs/specs/modules/`](specs/modules/00-index.md).
