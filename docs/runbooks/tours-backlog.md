# Tours backlog

Surfaces that would benefit from a guided tour but don't have one
today, plus existing guides that need redesign. Pair with
[`tours.md`](tours.md) for the live status of what already exists.

Ranked roughly by impact (most-affected user × most-confusing surface).

---

## Tier 1 — redesign existing broken guides

These shipped but are auto-disabled (`activation: 'manual-only'`) because
the surface they target no longer matches the guide's design. Either
redesign or remove.

### `guide-observe` — needs progressive-disclosure-aware redesign

The guide expects to point at `#obs2-post-form`, `#obs2-id-card`, and
`#obs2-save-btn` in sequence. After epic #1129 the obs page is a state
machine (`#obs2-card-v2` morphing through S0/S1a/S1b/S2/S2′/S3), so the
targets only exist after the user posts a photo. Two redesign options:

1. **Two-phase guide:** auto-fire on `/observe` for step 1 (target =
   FAB / file input), then re-fire on `obs2-card-v2` state change for
   steps 2–4. Requires the loader to listen for a `rastrum:obs2-card-state` event.
2. **Drop the guide:** the OnboardingTour already has a demo card
   showing the cascade. A second guide on `/observe` may be redundant.

Recommendation: option 2 unless usability research surfaces confusion.

### `guide-explore` — needs hub-layout retargeting

The current `/explore` is a hub of cards (Map, Recent, Watchlist,
Species, Validate) — not a tabbed surface. Steps should point at the
cards directly:

- s1: target the Map card (currently works via the s2 fallback)
- s2: target the Recent card
- s3: drop or target Watchlist

Lower priority since the hub is largely self-explanatory.

---

## Tier 2 — high-impact surfaces with NO guide

### `/sponsoring` — sponsor pool UI (M27/M32)

Multi-provider AI sponsoring (Anthropic-direct, Bedrock, OpenAI, Azure,
Gemini, Vertex) is configurable here. New users won't know what a
"pool" is. A 3-step guide:

1. Spotlight the provider radio (which proxy backs your usage)
2. Spotlight the "Donate to platform pool" toggle (the altruistic option)
3. Spotlight the pool progress bar (where you can see daily caps)

### `/perfil/ajustes/ai` — BYO API keys

7+ providers, each with different key formats. The current screen has
no in-context help beyond labels. A 2-step guide:

1. Spotlight the provider picker — explain the auto-detect-from-prefix behavior
2. Spotlight the endpoint field — when it appears (Azure/Bedrock/Vertex) and why

### `?mode=identify` (anon try-before-signup) — Arc pattern

Anon users can identify a photo without signing up via
`/observe?mode=identify`. The capability is completely undiscoverable —
no homepage CTA, no chrome affordance. A guide here would be premature;
fix discoverability first (separate issue), then add a 2-step guide that
runs once on first identify success and pitches sign-up.

---

## Tier 3 — moderate-impact surfaces

### `/falta-dex` (M08)

The taxonomic gaps panel is conceptually novel. A 3-step guide:

1. Spotlight the missing-taxa list with a 1-line "these are species
   recorded in your region but not yet by you" explainer.
2. Spotlight the region pool baseline toggle.
3. Spotlight the "show missing" localStorage opt-out.

### `/projects` (M29)

Project creation requires drawing a polygon, picking a privacy level,
inviting members. A 3-step guide could ease the polygon-drawing surface
which is the steepest part.

### `/chat` (M01)

The new chat surface has 5 read-only tools the LLM can call
(observation, species, project, camera_station, observer, self_profile).
Users don't know what they can ask. A single-step "what can I ask?" tip
with examples would help.

### `/share/obs/?id=` — public observation viewer

Mostly self-explanatory but has a hidden "edit after IDs" badge and a
photo-gallery with keyboard shortcuts (←/→/Esc). A one-time tip on
first view would surface these.

---

## Tier 4 — auth-gated guides needing signed-in audit

### `guide-validate` and `guide-export`

Both are `activation: 'first-visit'` but anon visitors never reach the
auth-gated DOM. Need a signed-in pass to confirm:

- `#validation-queue` exists when signed-in
- `.suggest-id-btn` exists in the validation row
- `#taxon-autocomplete` is the right selector for the modern taxon search
- `#export-format`, `#export-preset`, `#export-download` are still the
  current IDs after recent export flow rewrites

Tracked separately from this PR because it requires a fixture session.

---

## Tier 5 — ConsoleOnboarding extensions

The console walkthrough is a static modal. Adding a "?" replay button
in the console header would match the JourneyReplayButton UX. Lower
priority because the console audience is operators who learned the
shortcuts the first time.

---

## How to ship a guide from this backlog

Per [`tours.md`](tours.md) § "Adding a new guide":

1. Append a `JourneyGuide` entry to `src/lib/journey-guides.ts`.
2. Add bilingual i18n strings under `guides.<id>.*`.
3. Verify each step's target resolves to a visible element on the
   trigger route — the live-audit script in `tours.md` is the fastest
   check.
4. If the surface is auth-gated, set `activation: 'first-visit'` and
   rely on `waitForTarget`'s 4s timeout to silently no-op for anon.
5. If the surface has progressive disclosure, set
   `activation: 'manual-only'` and wire a deliberate replay button.
