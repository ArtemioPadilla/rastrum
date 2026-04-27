# Module 21 — Identify (quick-probe surface)

**Status:** v1.0 (shipped 2026-04-25, redesigned 2026-04-27)
**Code:** `src/components/IdentifyView.astro` (thin wrapper) →
`src/components/ObservationForm.astro` mounted with `mode="identify-only"`
**Routes:** `/{en,es}/identify/` (`/en/identify/`, `/es/identificar/`)

The `/identify` page is the lowest-friction "what is this?" surface in
Rastrum. The user picks a photo and an identification appears within
seconds. The same photo can be promoted to a full observation with one
tap; the GPS / habitat / notes fields stay collapsed until they are.

After 2026-04-27 the page is no longer a separate component — it is
the **observation form** mounted in identify-only mode. This collapses
two surfaces that were drifting apart and lets the user move from
"just identify" to "save observation" without losing context.

---

## Architecture

### Parallel cascade

`/identify` calls **`runParallelIdentify(file, { runners })`** from
[`src/lib/identify-cascade-client.ts`](../../../src/lib/identify-cascade-client.ts).
All available runners race in parallel — first responder with
`confidence ≥ 0.5` wins; the others are aborted via `AbortController`.

Available runners (see `src/lib/identify-runners.ts`):

| Runner | Source | When it fires | Cost |
|---|---|---|---|
| `makePlantNetRunner` | PlantNet HTTP API | Always (key resolves from project secret + BYO chain) | Free quota (500/day shared) |
| `makeClaudeRunner` | Claude Haiku 4.5 vision | When `resolveAnthropicKey()` returns a key | Per-token; only fires if user has BYO key (zero-cost target keeps the project key unset) |
| `makePhiRunner` | WebLLM Phi-3.5-vision on-device | When the model is already cached | Free, offline; ~2.4 GB one-time download |

If the cascade's best response is `< 0.5` confidence, the result still
renders with an "Uncertain" pill instead of a hard failure.

If PlantNet 403/404s (= no plant detected) and Phi-vision is not yet
cached, the user sees an inline offer card to download Phi-vision once
on Wi-Fi. The card frames the trade-off honestly: ~2.4 GB once, then
forever offline, photos never leave the device. Skipping the offer
hides the message; the user can still type the species name manually
or retry with a different photo.

### Result rendering

The result card shows:
- **Top match** (scientific name, common name)
- A single confidence pill (e.g. `87%`)
- An info `i` icon — tapping it surfaces the source identifier
  (PlantNet / Claude / Phi-vision / etc.) and license
- **Alternates collapsed** behind `+ N alternatives` when top
  confidence ≥ 0.85; visible when 0.5–0.85; expanded by default when
  < 0.5 (uncertain) so the user can pick from options.

Below the card sits an emerald **"Save as observation →"** link that
expands the previously hidden form fields (GPS, habitat, evidence,
notes) and switches the primary CTA from "Just identify" to "Save
observation". The photo and identification are preserved across the
mode toggle.

---

## Comparison vs other surfaces

| Surface | Saves obs | Identifiers | LLM interpreter | Default reveal |
|---|---|---|---|---|
| `/identify` | optional (one-tap reveal) | parallel: PlantNet + Claude (BYO) + Phi (cached) | none | photo + result only |
| `/chat` | optional (sessionStorage handoff) | full cascade incl. BirdNET + audio | Llama-3.2-1B narrates the cascade | photo / audio + chat history |
| `/observe` | yes (Dexie outbox + sync) | full cascade | none | every form field visible |

`/identify` is the right surface when the user just wants the answer.
`/chat` is the right surface when they want to ask follow-up questions
about the photo or recording. `/observe` is the right surface when
they intend to log the observation with location + metadata.

---

## Mode prop on ObservationForm

The form takes a `mode?: 'observe' | 'identify-only'` prop. Pure helpers
in [`src/lib/observation-form-mode.ts`](../../../src/lib/observation-form-mode.ts)
encode the mode contract:

- `pickModeLabels(mode, lang)` — primary CTA copy
- `submitIntent(mode)` — `'identify' | 'save'`
- `shouldAutoStartGPS(mode)` — false in identify-only (don't trigger
  the geolocation permission prompt unless the user has signaled
  intent to save)
- `hiddenBlocks(mode)` — array of block ids to hide in identify-only
  (gps, habitat, evidence, notes, sensitive-warning)

When the user clicks "Save as observation →" inline, the form switches
mode to `observe` at runtime, reveals the hidden blocks, and triggers
GPS resolution. The photo + identification chip stay populated.

---

## Tests

- `src/lib/identify-cascade-client.test.ts` — 16 race-outcome cases
  (PlantNet wins, Claude wins, Phi wins, all-failed, all-uncertain,
  AbortController cleanup, JSON parse for Claude/Phi prose)
- `src/lib/anthropic-key.test.ts` — 5 cases for the runtime → project →
  BYO resolver chain
- `src/lib/observation-form-mode.test.ts` — 9 cases for the mode-prop
  contract (label picking, GPS auto-start gating, hidden-block list)

Run via `npm test`. Total identify-related coverage: 30 cases.

---

## Source-of-truth files

```
src/components/IdentifyView.astro            # thin wrapper, sets mode
src/components/ObservationForm.astro         # the actual surface
src/lib/identify-cascade-client.ts           # runParallelIdentify orchestrator
src/lib/identify-runners.ts                  # PlantNet / Claude / Phi runners
src/lib/anthropic-key.ts                     # resolver chain (runtime → project → BYO)
src/lib/observation-form-mode.ts             # mode-prop contract
```

---

## Why parallel beats serial

The original v1.0 design ran identifiers serially: PlantNet first,
Claude/Phi only on rejection. For a non-plant photo (e.g. a dog) the
user waited ~5 s for PlantNet to fail before any vision LLM started,
total ~10 s. Parallel cascade collapses that: median for non-plant
photos drops to ~3 s, with no UX change other than the spinner not
morphing labels mid-wait. The trade-off is a small extra API call when
PlantNet would have succeeded anyway — acceptable because Claude /
Phi are cheap-or-free and the latency win on the failure path is large.
