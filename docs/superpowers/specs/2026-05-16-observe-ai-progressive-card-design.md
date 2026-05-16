# Observe AI — progressive result card (design)

> Status: design approved via brainstorming 2026-05-16. Spine of the
> observe AI UX redesign. Child specs (gate split, downloads UX, consensus
> hardening R1–R3, review-request queue) are referenced, not specified here.

## Problem

The observe AI experience exposes a heterogeneous identifier roster
(PlantNet, Claude, MegaDetector, EfficientNet, Phi, Gemma, BirdNET) to the
user as a 9-card power panel plus a 3-way `sponsored/own-key/local` mode
toggle. The interactive pipeline depends on the `identify` Edge Function
for cloud runners; an EF outage (incident 2026-05-16) dead-ended identify
with an empty stepper. The product is local-first for capture + storage
but **not** for identification: high-accuracy identifiers are inherently
cloud, on-device options are narrower/weaker and capped, and the
`localAISupported()` gate blocks the lightweight WASM path on phones.

The user must currently never think about *which* model. The roster is a
capability graph the app orchestrates, not a menu the user navigates.
"Local-first" here means: an instant on-device answer that **never blocks
capture**; the cloud is a parallel enhancement that upgrades, not a
prerequisite.

## Decided behavior (brainstorming Q1–Q4)

- **Q1 — Spine:** the progressive result card. Downloads/orchestration/
  consensus feed it; they are child specs with interface contracts to it.
- **Q2 — Role:** confidence-adaptive hybrid. High AI confidence behaves as
  "one-tap, saved"; weak/capped/offline becomes an honest "affirm or ask
  for help" surface.
- **Q3 — Upgrade conflict:** the observer's explicit affirmation is
  sovereign. If the observer did not act, the cloud upgrade fills/improves
  freely. If the observer affirmed, the cloud result is a **parallel
  suggestion** (adopt/dismiss) and never overwrites. The machine never
  overrides the human.
- **Q4 — Audit:** progressive disclosure. An inline source label is always
  shown; "ver traza / view trace" expands a full per-model trail that maps
  1:1 to existing `identifications` rows.

## Card structure

One card that morphs through states. **C-base** (question-framed: the AI
asks the human) + **A's adaptive collapse** (high confidence → compact
"✓ saved" row, zero friction) + **B's provenance strip** (device → cloud →
community) shown while the ID is unconfirmed.

### State machine

| State | Trigger | Card |
|---|---|---|
| **S0 Analyzing** | media added | "Identifying on your device…", cloud in parallel if online; **never blocks** |
| **S1a High confidence** | strong AI result | Collapsed: "✓ saved · PlantNet 94% · view trace". No question. |
| **S1b Weak/uncertain** | capped/low-confidence provisional | Question: *Yes / No, other… / I don't know — ask for review*; provenance strip |
| **S2 Upgrade, no observer action** | cloud result, `observer_affirmed = false` | Primary re-stamped to cloud result ("↑ improved by cloud") |
| **S2′ Upgrade, observer affirmed** | cloud result, `observer_affirmed = true` | Observer's ID stays primary; cloud shown as parallel suggestion (adopt/dismiss) |
| **S3 No model + no network** | worst field case | "Unidentified — will identify on sync"; name-it / ask-review / save-anyway. **Never blocks save.** |

`view trace` is available in every state (audit layer below).

**S1a vs S1b boundary (explicit, no new constants):** S1a (collapse /
auto-save) only when the winning result comes from a **non-capped** source
**and** its confidence ≥ the cascade accept threshold (0.7, the existing
`ACCEPT_THRESHOLD`). Every capped-source result (EfficientNet/Phi/Gemma —
`confidence_ceiling` ≤ 0.40) is **always S1b** by definition (it can never
be authoritative). Anything below 0.7, or any unresolved/offline state, is
S1b. No new tunables — reuses the constants the cascade already defines.

## Two-stage flow + sovereignty (data integration)

```
media → on-device pass (instant, NO Edge Function)
         └─ writes provisional identifications row:
            is_primary, source=<on-device model id>, confidence CAPPED
   ‖ parallel if online, else on sync via existing triggerIdentify()
cloud → authoritative identifications row
```

**Sovereignty resolver.** A boolean `observer_affirmed` is set by any
explicit observer action (Yes / No-other / name-it).
- `observer_affirmed = false` when cloud result arrives → re-stamp the
  primary row (source/confidence) → UI S2.
- `observer_affirmed = true` → store the cloud result as a **non-primary**
  suggestion row; the observer's row stays `is_primary` → UI S2′.

**Consensus integrity (R1–R3, preserved, not implemented here):**
- "Yes, it's that" → observer identification, `source='human'`,
  `validated_by = NULL` (existing self-validation trigger) → seeds primary
  but `recompute_consensus` still requires other human validators.
  Unchanged.
- On-device guesses keep their machine `source` (**R1**: remove the
  `?? 'human'` default in `sync.ts`) and **capped** confidence (**R2**:
  preserve cap end-to-end) so the ≥0.4 research-grade floor keeps them
  out. Unchanged consensus weighting.
- "I don't know — ask for review" → sets observer-set `review_requested`
  flag → routes into the validate/expert queue by kingdom (**R3**). Pure
  routing/visibility; does not touch consensus weight.

**S3 / offline:** save with no primary (or a human-named ID if the
observer names it); `triggerIdentify()` runs the server cascade on sync
(existing plumbing). Save is always available in every state.

## Audit trace layer

Progressive disclosure. Collapsed: inline source label (model +
confidence). Expanded ("view trace"): one row per real attempt — model ·
where (device/cloud) · prediction · confidence · typed outcome
(`pre-filter · provisional · primary · non-primary · replaced · filtered ·
human-affirmed · cloud-suggested`) · timestamp. Capped-confidence rows are
explicitly flagged (why a 0.31 cannot reach research-grade). Consensus
status at the foot. JSON export. **No new data model** — this is UI over
`identifications` rows + cascade filter outcomes the schema already
persists.

## Scope

**In scope (this spec):** the card component + state machine (S0–S3, S2′);
confidence-adaptive collapse; sovereignty resolver; audit-trace UI over
existing `identifications` data; wiring to save/sync. EN/ES parity.

**Consumed, not owned (child specs, interface contracts only):**
- Split `localAISupported()` so the lightweight WASM path
  (EfficientNet/SpeciesNet/BirdNET/MegaDetector) is not gated by
  WebGPU/≥6 GB — structural foundation; first build slice.
- User-controlled downloads (capability chooser) — card degrades per the
  capability graph.
- R1 (kill `?? 'human'`), R2 (preserve confidence cap end-to-end),
  R3 (source/confidence-aware validate/expert queue).
- `review_requested` flag + queue/expert routing.

**Non-goals (YAGNI):** no new ML models; no new identification data model
(reuse `identifications`); no redesign of the validate/expert pages (only
the flag they consume); no offline-map/Llama changes; heavy WebLLM
(Phi/Gemma) stays in "Advanced", out of the card's default path.

## Testing (TDD)

Unit-test the pure logic, isolated from the DOM:
1. **State selector** — confidence + availability → card state.
2. **Sovereignty resolver** — (`observer_affirmed`, cloud result) →
   action (`upgrade-primary` | `parallel-suggestion`).
3. **Trace builder** — `identifications` rows + cascade outcomes →
   ordered, typed trace.

Plus an EN/ES string-parity test. Card DOM behavior covered sparingly by
existing e2e smoke patterns per `docs/qa-policy.md`.

## Recommended build order

1. Child spec **gate split + R1 + R2** (foundation, low risk, TDD).
2. **This card spec** (state machine + sovereignty + audit UI).
3. Downloads UX (capability chooser).
4. R3 + review-request queue routing.
