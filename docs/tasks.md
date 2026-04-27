# Rastrum Tasks — Phase Summary

> **Skim-friendly view of [`docs/tasks.json`](tasks.json).** The JSON is
> the source of truth for the per-phase progress bars rendered at
> [`/{lang}/docs/tasks/`](https://rastrum.org/en/docs/tasks/). This
> markdown is regenerated when JSON drifts and is intentionally short —
> open the JSON for full subtask detail.
>
> Last sync: 2026-04-26 (v1.0 shipped). Roadmap source:
> [`docs/progress.json`](progress.json).

---

## At a glance

| Phase | Name | Status | Roadmap items done |
|---|---|---|---|
| v0.1 | Alpha MVP (online-first) | shipped | 14 / 14 |
| v0.3 | Offline intelligence + activity | in progress | 9 / 11 |
| v0.5 | Beta | in progress | 10 / 15 |
| v1.0 | Public Launch | shipped | 16 / 19 |
| v1.5 | Territory Layer | planned | 0 / 5 |
| v2.0 | Institutional | planned | 0 / 5 |
| v2.5 | AI + AR | planned | 0 / 4 |

The two open v0.3 items (`onnx-base`, `offline-maps`), three open v0.5
items (`scout-v0`, `onnx-regional`, `local-contexts`), and three open
v1.0 items (`camera-trap-ingest` — partial, `capacitor-ios`,
`oauth-custom-domain`) are all blocked on external dependencies (model
training pipelines, community consent, paid platform tiers) rather than
engineering capacity.

---

## v0.1 — Alpha MVP (online-first) — shipped

All 14 roadmap items done. Two trailing UX nudges remain
(see `tasks.json` for subtasks):

- `auth-magic-link`: guest-mode hard-cap UI nudge after the 3rd guest
  observation (planned).
- `auth-multi`: WebAuthn MFA toggle in Supabase dashboard (operator action).
- `claude-haiku-id`: `ANTHROPIC_API_KEY` server-side secret (optional —
  users BYO).
- `map-view`: pmtiles offline tiles (deferred to v0.3 / v1.0 — pmtiles
  MX archive now hosted on R2 per `PUBLIC_PMTILES_MX_URL`).
- `unit-tests`: pgTAP RLS suite + Playwright suite (Playwright is wired
  but kept intentionally minimal).

## v0.3 — Offline intelligence + activity — in progress

Roadmap: 9 / 11 done. The two open items are blocked:

- `onnx-base` — EfficientNet-Lite0 ONNX shipped (weights hosted on R2 via
  `PUBLIC_ONNX_BASE_URL`); the original blocker is partially resolved.
- `offline-maps` — pmtiles MX archive now hosted on R2 via
  `PUBLIC_PMTILES_MX_URL`; map view auto-uses it when set.

Done in this phase: `activity-feed`, `unread-badge`, `sensitive-privacy`,
`exif-extraction`, `byo-anthropic-key` (subsumed by `byo-keys-platform`),
`webllm-text`, `webllm-default`, `identification-block`, `gps-two-pass`.

## v0.5 — Beta — in progress

Roadmap: 10 / 15 done. The five open items:

| Item | Status | Note |
|---|---|---|
| `birdnet-audio` | partial | BirdNET-Lite ONNX shipped, weights on R2; spectrogram preprocessing wired; UI integration in progress |
| `scout-v0` | blocked | pgvector + embedding budget |
| `onnx-regional` | blocked | training pipeline (deferred to v2.0 effort) |
| `gbif-ipt` | partial | DwC-A generator shipped; GBIF publisher account pending |
| `local-contexts` | blocked | community consent before code |

Done: `multi-image`, `eco-evidence`, `discovery-badges`, `webllm-vision`,
`quality-gates`, `consensus-workflow`, `byo-keys-platform`,
`user-api-tokens`, `token-rest-api`, `token-ui`.

## v1.0 — Public Launch — shipped

Roadmap: 16 / 19 done. Three open items:

| Item | Status | Note |
|---|---|---|
| `camera-trap-ingest` | partial | UI shipped at `/profile/import/camera-trap`; `camera_trap_megadetector` plugin stub registered; weights operator-hosted (env: `PUBLIC_MEGADETECTOR_ENDPOINT`) |
| `capacitor-ios` | blocked | Apple Developer Program ($99/yr) |
| `oauth-custom-domain` | deferred | Supabase Pro plan ($25/mo) — out of scope for zero-cost target |

Newly closed in this phase:

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
