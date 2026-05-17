# Observe AI — progressive result card

Epic **#1129** (PRs #1142–#1146, merged 2026-05-17). Spec:
[`../superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md`](../superpowers/specs/2026-05-16-observe-ai-progressive-card-design.md)
(integration **approach C** — the card subsumes result + taxon + why).

## What it is

`#obs2-card-v2` in `ObserveView2.astro` is now the **only** identification
surface. The legacy `#obs2-id-result` block and the `cardV2Enabled` flag
are gone (C-4). One card morphs through six states; the observer's
explicit affirmation is sovereign over any later cloud upgrade.

## Load-bearing pieces (do not bypass)

| Concern | Module | Invariant |
|---|---|---|
| State selection | `src/lib/observe-card-state.ts` | S1a only when a **non-capped** source ≥ `ACCEPT_THRESHOLD` (0.7). Capped sources are always S1b. No new tunables. |
| Sovereignty | `src/lib/observe-sovereignty.ts` | `observer_affirmed=false` → cloud re-stamps primary (S2). `true` → cloud is a parallel suggestion (S2′), never overwrites. |
| Actions | `src/lib/observe-card-actions.ts` | Pure `cardActions(state)`. Add a state ⇒ extend this, not the renderer. |
| Render | `src/lib/observe-card-render.ts` | Pure string. `data-card-state` / `data-card-action` / `data-card-trace` / `data-card-trace-panel` are the wiring contract `ObserveView2`'s `<script>` binds to. |
| Audit trace | `src/lib/observe-audit-trace.ts` | "ver traza" is UI over real `identifications` rows + cascade outcomes — **no new data model**. Capped rows flagged honestly. |
| Source (R1) | `src/lib/identification-source.ts` | A machine result is NEVER written `source='human'`. Affirm/manual-entry ⇒ `human`. |
| Confidence cap (R2) | `src/lib/confidence-ceiling.ts` | Single source of truth. `capConfidence(source, c)` is applied at **both** `upsert_primary_identification` sites in `sync.ts`. EfficientNet/MegaDetector ≤ 0.4, Phi/Gemma ≤ 0.35 → below the ≥0.4 research-grade floor. |
| Queue routing (R3 + #1126) | `validation_queue` view + `src/lib/source-trust.ts` | View surfaces `review_requested` / `current_kingdom` / `current_source` (append-only). Queue orders review-requested first, then my-expertise, then source-trust (human < cloud < capped on-device). **`recompute_consensus` + the RG floor are untouched** — proven by `tests/unit/consensus-untouched.test.ts`. |
| Downloads UX (#1127) | `src/lib/download-capabilities.ts` + `DownloadChooser.astro` | Curated capability chooser is the default; the raw 9-identifier registry is behind the collapsed `#ai-advanced` `<details>`. "Download selected" clicks the **existing** `#${prefix}-download` controls — `prefixByTarget` must stay in sync with `ON_DEVICE_DL_PREFIX` (`identifier-card-html.ts`), enforced by `tests/unit/download-chooser-prefix-sync.test.ts`. |

## State machine

`S0` analyzing · `S1a` high-confidence collapsed "✓ saved" · `S1b`
weak/capped — Yes / No-other / I-don't-know · `S2` cloud upgrade
(no observer action) · `S2′` cloud parallel suggestion (observer
affirmed) · `S3` offline/no-model. Save is available in every state.

## Gotchas

- **Any change to `ObserveView2.astro`'s client `<script>` MUST be
  e2e-gated.** `tsc`/`vitest`/`build` do not run the page in a browser
  (the `tr is not defined` class). The CI `test` job (Playwright) is the
  real gate; auto-merge enforces it. `tests/e2e/observe-card.spec.ts`
  drives the card seam deterministically; `tests/e2e/ai-tab.spec.ts`
  covers the relocated registry (opens `#ai-advanced` first).
- Local e2e on `/profile/*` needs `.env.local` copied into the worktree
  + a rebuild, or it fails with `supabaseUrl is required` and masks real
  regressions. `bash scripts/e2e-for-changed.sh` maps a diff to the
  specs that cover it.
- i18n namespaces: `observe.card.*` (states + actions), `observe.trace.*`
  (audit panel), `observe.downloads.*` (chooser), `validation.*` (queue
  badges). EN/ES parity is enforced per-namespace.

## Consensus integrity (must stay true)

`recompute_consensus` counts only `validated_by`-non-null human
validations; the research-grade floor is `confidence ≥ 0.4`. The
progressive card path is local-first **and safe** only because R1–R3
hold: machine source preserved, confidence capped end-to-end, queue
ordered by source trust. `tests/unit/consensus-untouched.test.ts` fails
the build if the weighting expression or RG floor ever drifts.
