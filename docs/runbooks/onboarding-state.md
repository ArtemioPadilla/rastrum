# Onboarding state runbook

> Sibling to [`onboarding-events.md`](onboarding-events.md). That doc covers
> the DOM events the tour emits / accepts. This one covers the **storage
> layer** that backs the user's onboarding journey.

## Why this exists

Audited 2026-05-24: the codebase had grown to **18+** distinct
`localStorage` keys under the `rastrum.*` / `rastrum_*` prefix to track
"one-time UX flags" — tour completion, per-feature guide views, visit
counts, install hints, console onboarding, observe2 onboarding, identify
mode notice, etc.

Each surface owned its own key with its own value vocabulary (`'true'`,
`'1'`, `'done'`, `'v1'`, ISO timestamps…). No shared schema, no single
"is the user new?" predicate, no dump-everything helper for debugging or
support.

`src/lib/onboarding-state.ts` centralises all of this under a single
JSON document while remaining backwards-compatible with the legacy keys.

## What's in scope

The helper covers UX-state flags that fit a single user-journey model:

| Field | Type | Migrates from |
|---|---|---|
| `version` | `1` | n/a (forward-compat marker) |
| `tourCompletedAt` | ISO string \| null | `rastrum.onboarding.seen` |
| `consoleOnboardingDone` | boolean | `rastrum.console.onboardingDone` |
| `obs2OnboardingShown` | boolean | `rastrum.obs2.onboarding_shown` |
| `firstObsCelebrated` | boolean | `rastrum.firstObservationCelebrated` |
| `firstObsSyncedAt` | ISO string \| null | `rastrum.obs.firstSyncedAt` (#1186) |
| `privacyPreset` | enum \| null | `rastrum.onboarding.privacyPreset` |
| `visitCount` | number | `rastrum.visitCount` |
| `installHintDismissed` | boolean | `rastrum.installHintDismissed` |
| `pwaInstalled` | boolean | `rastrum.pwaInstalled` |
| `guidesSeen` | `Record<id, value>` | every `rastrum.guide.*` key |
| `identifyModeNoticeShown` | boolean | `rastrum_identify_mode_notice_v1` |

## What's out of scope

These intentionally do NOT belong to this helper because they hold
**operational state**, not journey progress:

- `rastrum.byoKeys` — BYO API key store, owned by `src/lib/byo-keys.ts`
- `rastrum.lang` — language preference (not "onboarding")
- `rastrum.theme.seasonal` — theme picker
- `rastrum.community.gps` — session-only; sessionStorage, never localStorage
- `rastrum.feedback.responses` / `rastrum.survey.*` — survey responses
- `rastrum.pendingObservation` — outbox handoff
- `rastrum.formAutoSave.v1` — draft autosave (large payload)
- `rastrum.headerName` / `rastrum.headerAvatar` — first-paint cache
- `rastrum.lastSyncAt` — sync clock
- `rastrum.audio.volume`, `rastrum.chat.modelPicker`, etc. — feature prefs

Those can graduate later if a clear "user state" model justifies it; the
helper's shape is intentionally narrow today.

## API

```ts
import {
  getOnboardingState,        // read full state (default + migration on first call)
  setOnboardingState,        // merge a partial patch + persist
  markTourCompleted,         // sugar for tourCompletedAt = now()
  markConsoleOnboarded,
  markObs2OnboardingShown,
  markFirstObsCelebrated,
  markFirstObsSynced,        // idempotent: only stamps the first time
  setPrivacyPreset,
  incrementVisitCount,       // accepts a step (default 1)
  markInstallHintDismissed,
  markPwaInstalled,
  markGuideSeen,             // accepts bare 'observe' or 'rastrum.guide.observe'
  hasSeenGuide,
  markIdentifyModeNoticeShown,
  dumpLegacyKeys,            // debug: snapshot of every legacy key
  clearOnboardingState,      // wipe the central key (leaves legacy keys alone)
} from '../lib/onboarding-state';
```

All accessors are **SSR-safe**: they short-circuit when `localStorage`
is undefined (Astro static build, Node test runners without a shim) and
never throw. The first call to `getOnboardingState()` performs a
one-time, non-destructive migration from the legacy keys and persists
the resulting JSON under `rastrum.user.onboardingState`. Subsequent
reads come from memory.

## Migration strategy

This PR is **additive only**:

1. The new helper exists and is fully tested.
2. The 18 legacy call-sites continue to read/write their own keys —
   nothing was rewritten.
3. The migration is non-destructive: legacy keys are read once, mirrored
   into the new JSON, then **left in place**. Any call-site that still
   writes its own key continues to work; the next migration sweep will
   pick up the new value.

Why not rewrite the call-sites in this PR?

- Each surface has its own subtleties (the OnboardingTour's preset write
  also PATCHes Supabase, the InstallDiscoveryHint reads visitCount on
  every page load to drive the cycle, JourneySpotlight uses a templated
  storage key per guide id, etc.). One PR per surface keeps reviews
  scoped and reversible.
- The legacy-key reads in this helper are deliberately tolerant so the
  port can land surface-by-surface without coordinating a flag day.

Recommended migration order (one PR each, no rush):

1. `InstallDiscoveryHint.astro` — visitCount + installHintDismissed
2. `ConsoleOnboarding.astro` — consoleOnboardingDone
3. `FirstObservationCelebration.astro` — firstObsCelebrated
4. `ObserveView2.astro` — obs2OnboardingShown (also identifyModeNotice)
5. `OnboardingTour.astro` — tourCompletedAt + privacyPreset
6. `JourneySpotlight.astro` + `journey-guides.ts` — guidesSeen map

When the last call-site is ported, a separate sweep can delete the
legacy keys from existing users' storage with a one-shot cleanup. Until
then, both halves coexist.

## Debugging

For support: paste this into the browser console.

```js
JSON.parse(localStorage.getItem('rastrum.user.onboardingState') ?? 'null')
```

For diffing centralised vs legacy state, the helper exports
`dumpLegacyKeys()` for the operator console / "export my state" affordance.

## Schema versioning

`version: 1` is the wire-format marker. Bumping it means a future
migration step ran (e.g. dropping the legacy fallback once the last
call-site is ported). `setOnboardingState` always normalises back to
`1` regardless of the patch so downstream code can rely on the field.

## See also

- `src/lib/onboarding-state.ts` — implementation
- `tests/unit/onboarding-state.test.ts` — coverage
- [`onboarding-events.md`](onboarding-events.md) — DOM events the tour emits
- [`onboarding-funnel.md`](onboarding-funnel.md) — what we measure on top
- [`onboarding-patterns-audit.md`](onboarding-patterns-audit.md) — the audit that motivated the helper
