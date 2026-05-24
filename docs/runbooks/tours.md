# Tours runbook

Rastrum has three discrete tour systems. They serve different purposes,
fire at different times, and have different bug histories. This runbook
documents what's live today; pair with module spec
[`../specs/modules/33-user-journeys-testing.md`](../specs/modules/33-user-journeys-testing.md)
for original design rationale and
[`onboarding-patterns-audit.md`](onboarding-patterns-audit.md) for
strengths/gaps against the Mobbin onboarding study.

---

## 1. `OnboardingTour.astro` — first-run welcome

**Trigger:** signed-in users without `users.onboarding_completed_at` see it
~600ms after auth resolves. Manual replay via `rastrum:replay-onboarding`
event (wired from `ProfileEditForm`).

**Steps:** 7 (welcome → FAB/observe-nav → camera FAB → demo card →
explore → privacy preset → settings/avatar).

**Spotlight engine:** in-component, uses `resolveFirstVisible` from
`src/lib/onboarding-target.ts` (#1161).

**Recent history:** epic #1160/#1161 — 4 of 7 spotlights were broken
(2 hidden-blind, 2 dead selectors). Fixed by extracting the helper +
adding the missing `data-tour` attrs on `Header.astro` /
`MobileBottomBar.astro`.

**Known issue (not yet fixed):** step 4 first-obs demo card is hardcoded
to "Quercus robur — Oak / PlantNet / Claude Haiku / 87% confidence" for
every user regardless of region or interest — flagged in
[`onboarding-patterns-audit.md`](onboarding-patterns-audit.md) as
half-baked personalization.

## 2. `JourneySpotlight.astro` + `journey-guides.ts` — contextual tours

**Trigger:** `JourneyGuideLoader` (mounted in `BaseLayout`) matches the
current route against the registry. If `activation === 'first-visit'`
and the user hasn't seen the guide, it auto-fires; otherwise users
trigger via the "?" replay button (`JourneyReplayButton.astro`).

**Spotlight engine:** `JourneySpotlight.astro` — uses the same
`resolveFirstVisible` helper after the #1162 fix; positionTooltip has
a defensive `width > 0 || height > 0` check that degrades to a centered
tooltip if the resolved element happens to be hidden.

**Live status as of 2026-05-23:**

| Guide | Activation | Live status | Notes |
|---|---|---|---|
| `guide-observe` | `manual-only` | broken-by-design | s1–s4 targets exist but `display:none` until card-v2 state machine reveals them. Tracked in tours-backlog.md for redesign. |
| `guide-explore` | `manual-only` | broken-by-design | Current `/explore` is a hub of cards; the s1 (tabs) + s3 (filters) selectors don't match. Tracked for redesign. |
| `guide-validate` | `first-visit` | auth-gated | Anon visitors silently no-op via the 4s `waitForTarget` timeout. Signed-in audit deferred. |
| `guide-export` | `first-visit` | auth-gated | Same shape as validate. |
| `guide-community` | `first-visit` | works | 2 steps (down from 3 — dropped step 3 "Follow"; the observers listing has no follow surface, follow lives on per-observer profile). |
| `guide-console` | `first-visit` | works | 2 steps (down from 3 — dropped the keyboard-shortcut step; no DOM anchor for it). Signed-in. |

**Replay events:**
- `rastrum:journey-guide-start` (consumer → spotlight) with `detail: { guideId, steps, lang }`
- `rastrum:journey-guide-stop`  (consumer → spotlight)
- `rastrum:replay-guide` (consumer → loader) with `detail: { guideId }`
- `rastrum:onboarding-event` (spotlight → analytics) — shared with OnboardingTour

**Adding a new guide:**

1. Append a `JourneyGuide` entry to `src/lib/journey-guides.ts`.
2. Add the bilingual title/body strings under `guides.<id>.stepN_*` in
   both i18n files.
3. Verify each step's target selector resolves to a visible element on
   the trigger route — running the [tours backlog](tours-backlog.md)
   audit script is the fastest check.

## 3. `console/ConsoleOnboarding.astro` — admin console first-run

**Trigger:** signed-in console users without
`localStorage.rastrum.console.onboardingDone === 'true'` see a centered
modal walkthrough.

**Steps:** 5 (welcome → sidebar → roles → keyboard shortcuts → ready).

**Spotlight engine:** NONE — pure modal. No `data-target` selectors, no
`resolveTarget` logic, no positionTooltip. Immune to the bug class that
affected OnboardingTour + JourneySpotlight.

**Replay:** not wired today. Closest UX is clearing
`localStorage.rastrum.console.onboardingDone` then reloading
`/console/`. Adding a "?" replay button is a backlog item.

**Status:** copy reflects current admin/moderator/expert role model
(M24, role-model.md). No known issues.

---

## Cross-cutting

**Visibility filter (`isDisplayed`):** lives in
`src/lib/onboarding-target.ts`. Used by `resolveFirstVisible`. Walks
ancestor chain checking `getComputedStyle().display !== 'none'`. Used
in both OnboardingTour and JourneySpotlight after #1162. `visibility:
hidden` is intentionally NOT filtered (the element still occupies
layout, so spotlighting it is geometrically valid).

**Analytics:** `rastrum:onboarding-event` is the unified event for both
OnboardingTour and JourneySpotlight. Operators attach a listener in
`BaseLayout.astro` to wire whatever analytics backend (PostHog,
Plausible, internal beacon). See
[`onboarding-events.md`](onboarding-events.md) for the event schema.

**Mobile breakpoint:** `OnboardingTour` step 1+2's selector
`[data-tour="fab"],[data-tour="observe-nav"]` is designed for the FAB
to win on mobile and `observe-nav` to win on desktop, via the visibility
filter. Manually verified at both breakpoints.

**Replay event reference:**

| Event | Direction | Detail | Consumed by |
|---|---|---|---|
| `rastrum:replay-onboarding` | consumer → tour | none | `OnboardingTour.astro` |
| `rastrum:replay-guide` | consumer → loader | `{ guideId }` | `JourneyGuideLoader.astro` |
| `rastrum:journey-guide-start` | consumer → spotlight | `{ guideId, steps, lang }` | `JourneySpotlight.astro` |
| `rastrum:journey-guide-stop` | consumer → spotlight | none | `JourneySpotlight.astro` |
| `rastrum:onboarding-event` | spotlight → analytics | `{ type, step, … }` | operator-wired |
