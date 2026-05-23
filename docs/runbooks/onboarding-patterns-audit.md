# Onboarding patterns audit — Rastrum vs. Mobbin study

A walkthrough of Rastrum's current onboarding against the patterns
identified in Mobbin's onboarding study (~1000 apps). First drafted
2026-05-22; revised 2026-05-23 after live Chrome verification revealed
the tour itself is partially broken in production.

> **Companion runbooks:** [`onboarding-events.md`](onboarding-events.md)
> (DOM events + replay hook) and [`onboarding-funnel.md`](onboarding-funnel.md)
> (7 milestone events).

---

## TL;DR

The earlier draft of this doc was too generous. Verifying live against
`rastrum.org` on 2026-05-23 (desktop 1440px, signed-in user) showed that
**4 of the tour's 7 steps render with a broken or missing spotlight on
the default homepage.** The accessibility layer (ARIA dialog, focus trap,
cross-device dedupe) does work, but the spotlight feature it's wrapped
around does not. Several "personalization" claims also collapse on
inspection — the privacy preset writes silently, the first-obs demo is
hardcoded `Quercus robur` for everyone, and 3 of the 7 funnel events
have no cron firing them.

The right ordering is to fix the broken foundations before adding new
patterns from the Mobbin study.

---

## Current surface (verified 2026-05-23)

| Piece | Where | Verified state |
|---|---|---|
| Spotlight tour | `src/components/OnboardingTour.astro` | 7 steps. ARIA dialog + focus trap + Esc/Tab/Arrow keys work. **4 of 4 spotlight steps fail** on default desktop homepage (see "Verified broken" below). |
| Trigger gate | `localStorage` flag + server `users.onboarding_completed_at` | Works. Cross-device dedupe is real. |
| Replay | `rastrum:replay-onboarding` event from `ProfileEditForm` | Works. |
| Telemetry | `rastrum:onboarding-event` + PostHog | Tour completion / dismiss fires. **3 of 7 funnel events are not wired** — `onboarding-events` Edge Function doesn't exist on disk; `first_id_accepted`, `7d_return`, `30d_return` cited as "v1.5 follow-up" in [`onboarding-funnel.md`](onboarding-funnel.md). |
| Pre-auth try-the-product | `/{en,es}/{identify,identificar}` → 301 to `/observe?mode=identify` | Page exists, but **the anon homepage CTA points to `/observe` (which requires auth chrome to do anything)**. Nothing surfaces `?mode=identify` to anonymous users. Half-baked: capability exists, discoverability zero. |
| First-obs celebration | `FirstObservationCelebration.astro` | Fires after first sync. No founder note, no handwritten signature — pure system copy. |
| Privacy preset | Tour step 5 → `persistPreset()` (line 415) | Writes `users.profile_privacy` and advances to next step. **No "your profile is ready" preview** — the choice has no visible consequence to the user. |
| First-obs demo | Tour step 3 → `renderFirstObsDemo()` (line 467) | Renders a hardcoded card: PlantNet ✓ → Claude Haiku — → *Quercus robur* 87%. Same content for every user regardless of region, interest, or prior signal. |

---

## Verified broken in production (2026-05-23 Chrome inspection)

Steps reproduced by dispatching `rastrum:replay-onboarding` on
`https://rastrum.org/en/` at desktop viewport (1440px), signed-in user,
and stepping through with `#onb-next` clicks while reading
`#onb-spotlight-ring.getBoundingClientRect()` and the resolved target's
state at each step.

| Step | Tooltip title | Designed selector | Verified outcome |
|---|---|---|---|
| 0 | Welcome to Rastrum | none (center) | ✅ centered modal renders as expected |
| 1 | Start observing | `[data-tour="fab"],[data-tour="observe-nav"]` | ❌ matches FAB (which is `display:none` ancestor `sm:hidden`); ring renders at `(-8, -8, 16, 16)`; tooltip clipped against top-left edge |
| 2 | Identify mode | `[data-tour="fab"]` | ❌ same failure mode as step 1 (FAB hidden on desktop) |
| 3 | See how identification works | none (center) | ✅ centered demo card renders — but content is hardcoded |
| 4 | Explore | `[data-tour="explore-tab"],[data-tour="explore-nav"]` | ❌ **neither selector exists anywhere in the codebase** — MobileBottomBar uses `discover-tab`, Header has no `explore-nav`. Falls back to centered modal, no spotlight |
| 5 | Privacy preset | none (center) | ✅ centered modal + 3-button picker renders. Selection has no visible effect. |
| 6 | Settings / BYO key | `[data-tour="profile-tab"],[data-tour="avatar-btn"]` | ❌ **neither selector exists anywhere in the codebase**. Falls back to centered modal, no spotlight |

### Root cause #1 — `resolveTarget` ignores visibility

```ts
// OnboardingTour.astro:290–298
function resolveTarget(selector: string | null): Element | null {
  if (!selector) return null;
  const parts = selector.split(',').map(s => s.trim());
  for (const sel of parts) {
    const el = document.querySelector(sel);
    if (el) return el;   // ← returns first match, even if display:none
  }
  return null;
}
```

`document.querySelector('[data-tour="fab"]')` matches the FAB element
even when its ancestor `<nav id="mobile-bottom-bar">` is `display:none`
(the `sm:hidden` Tailwind class hides the whole bottom bar at ≥640px).
`getBoundingClientRect()` then returns `0, 0, 0, 0`, the ring lands at
`(-PAD, -PAD, 2·PAD, 2·PAD)` = `(-8, -8, 16, 16)`, and the tooltip
placement logic (lines 357–365) snaps to the top-left corner because
"prefer below the spotlight" puts y = 0 + margin.

**Fix:** filter by `offsetParent !== null` before returning.

```ts
const el = document.querySelector(sel);
if (el && (el as HTMLElement).offsetParent !== null) return el;
```

One-liner; preserves the comma-separated fallback semantics.

### Root cause #2 — selectors that do not exist

```bash
$ grep -rn 'data-tour=' src --include='*.astro'
src/components/MobileBottomBar.astro:68: data-tour="fab"
src/components/MobileBottomBar.astro:85: data-tour="discover-tab"
src/components/Header.astro:155:         data-tour="observe-nav"
```

The tour expects `explore-tab`, `explore-nav`, `profile-tab`, and
`avatar-btn`. **None of these are in the codebase.** This was probably
a chrome rename (Discover → Explore landed in #?) where the tour
selectors weren't migrated. Steps 4 and 6 have been silently broken
since.

**Fix:** add the missing attributes to existing elements:
- `data-tour="explore-nav"` on the Explore link in `Header.astro`
- `data-tour="explore-tab"` on the existing Discover/Explore button in `MobileBottomBar.astro` (or rename the tour selector to `discover-tab`)
- `data-tour="avatar-btn"` on the avatar button in `Header.astro`
- `data-tour="profile-tab"` on the profile tab in `MobileBottomBar.astro`

### Root cause #3 — no regression test for selector→DOM linkage

The tour has unit tests (`tests/unit/onboarding-*.test.ts`) but none
verify that every `target` selector in `STEPS` resolves to a visible
element on the rendered page. An e2e test that drives the tour through
all 7 steps on `/en/` and asserts `#onb-spotlight-ring` is positioned
over a real element (not at `(-8, -8)`) would have caught both bugs.

---

## Pattern-by-pattern audit

Patterns are grouped by leverage. The earlier draft had a generous
"✅ already strong" column; live verification collapsed most of it into
"exists but doesn't deliver the pattern".

### ⚠️ Things that technically exist but don't deliver the pattern

These are the items I previously called strengths. Each needs work
before it actually counts.

| Pattern | What "exists" | Why it doesn't deliver | What would close it |
|---|---|---|---|
| **Try before signup** (Arc) | `/identify` route 301s to `/observe?mode=identify`. Cascade runs anonymously. | Anon homepage CTA points to `/observe` (no auth needed to land there, but the obvious UX path is sign-in). Nothing on the anon homepage advertises "try the AI without an account". | Add a second hero CTA on anon homepage: "Try identifying a photo — no account needed →". Wire to `/observe?mode=identify`. ~10 minutes. |
| **Education in context** (Cake Equity, Todoist) | Spotlight tooltips on real DOM elements (FAB, header nav). | (1) 4 of 4 spotlight steps are broken (see "Verified broken"). (2) Even when fixed, this is still the **pop-up overlay** pattern Mural REPLACED to get +10% week-1 retention. Calling it "context" was generous. | Fix the spotlights first. Then add a real "education in context": empty-state hints inside Observe / Explore / Profile when the user lands there for the first time. |
| **Personalization with effect** (privacy preset) | Step 5 writes `users.profile_privacy` immediately on click. | The user clicks "Researcher" and the tour just advances. No "your profile shows: real name, location, streak" preview. The write is invisible. | After preset selection, render a 2-row preview of what's now public/signed-in/private. ~20 LOC. |
| **First-obs demo within tour** (Endel / Bitepal "your plan is ready") | Tour step 3 renders a fake cascade card. | Card is hardcoded *Quercus robur — Oak 87%* (lines 60–61). Same content for a birder, a herpetologist, a marine biologist. Endel/Bitepal show YOUR data; this is a screenshot. | Use the user's `interests` (does not exist yet — see "Multi-intent picker" below) to pick a species the user actually cares about. Until interests exist, at least vary by detected device locale: oak for EN, encino for ES-MX, etc. |
| **Funnel instrumentation** | `onboarding:signed_up`, `:first_observation`, `:first_follow`, `:first_comment` fire from client code. | Per [`onboarding-funnel.md`](onboarding-funnel.md) line 86: `first_id_accepted`, `7d_return`, `30d_return` → "cron not yet created — v1.5 follow-up". Verified: `supabase/functions/onboarding-events/` does not exist. **4 of 7 events fire; 3 silently don't.** | Create the EF + cron schedule. The SQL queries to find new accepted IDs, 7-day returns, and 30-day returns are straightforward. |

### ✅ Things that genuinely work

The honest list.

| Pattern | Why it counts |
|---|---|
| Accessibility primitives | ARIA dialog + focus trap + Esc/Tab/Arrow keys + `aria-modal` + step indicator `aria-live`. This part is solid and shouldn't be touched while fixing the rest. |
| Cross-device dedupe | `users.onboarding_completed_at` server-side flag prevents the tour from re-running after `localStorage` is cleared (incognito, ITP, new device). Most of the apps in the study didn't do this. |
| Replay path | `rastrum:replay-onboarding` event reopens the tour from anywhere (currently wired from `ProfileEditForm`). Documented + tested. |
| 4 funnel events that DO fire | `signed_up`, `first_observation`, `first_follow`, `first_comment` are wired correctly. |

### ❌ Missing — highest expected leverage

Same as before; these are net-new patterns from the study, not
pre-existing surfaces.

| Pattern | Why it matters for Rastrum | Concrete intervention |
|---|---|---|
| **Persistent onboarding checklist** (Mural — +10% week-1 retention) | The 4 working funnel events are already tracked. A checklist is the UI render of that data. The tour fires once; the checklist survives dismissal. | Dismissable checklist card on profile/home: 5 items mapped to existing events. Persisted via `users.onboarding_checklist_dismissed_at`. |
| **Pre-permission priming screen** (Brilliant) | Rastrum cold-prompts 3 OS permissions (camera, GPS, notifications) + a 2.4 GB model download. Highest-friction step. | One custom screen per permission before the OS prompt. Pair notifications with existing Kairos copy. |
| **Multi-intent goal picker** (Headspace — +10% trial conversion) | Rastrum users are heterogeneous (birders, citizen-science, casual, researchers). Currently treated identically. | 1-screen "Why are you here?" multi-select. Drives: default Explore tab, default region, default Kairos taxa. New `users.interests text[]` column. |
| **Founder's touch at aha moment** (Airbnb, Basecamp, One Year) | Rastrum is solo-developed in MX with LatAm focus — highly on-brand. | Spanish handwritten note + signature in `FirstObservationCelebration.astro`. Two i18n strings, no schema change. |
| **Value-before-cost on heavy ask** | The 2.4 GB WebLLM download is Rastrum's equivalent of "show value before price". | Before the download prompt: "Your offline cascade will recognize ~12,000 species. Works without internet." |

---

## Recommended sequencing (revised 2026-05-23)

The earlier draft put a new checklist at #1. After Chrome verification,
**fixing the broken tour comes first**. There's no point adding new
patterns on top of a spotlight system whose 4 spotlight steps don't
work.

0. **Fix the tour itself** — tracked in [#1160](https://github.com/ArtemioPadilla/rastrum/issues/1160):
   - `resolveTarget` visibility check (1 line)
   - Add the 4 missing `data-tour` attributes
   - Add e2e regression test that asserts each step's spotlight lands on a visible non-corner element
1. **Wire the 3 missing funnel events** — create `supabase/functions/onboarding-events/` + cron schedule. Until this lands, retention analysis can't see past day 0.
2. **Personalize what's already half-personalized** — first-obs demo picks a species from device locale; privacy preset shows a preview after selection.
3. **Onboarding checklist** (Mural pattern).
4. **Pre-permission priming** (Brilliant pattern).
5. **Multi-intent picker** (Headspace pattern).
6. **Founder note** (Airbnb / Basecamp / One Year pattern).
7. **Anon homepage CTA for `/identify`** (Arc pattern) — currently the capability exists but is hidden.

Items 0 and 1 are bug-fix work. Items 2–7 are net-new.

---

## What we deliberately won't copy

- **Long onboarding for its own sake.** Duolingo's 60-step flow works because the product IS the flow. Rastrum's product happens after the first photo — extra screens just delay the aha.
- **Notifications-first onboarding.** Fitness/finance apps frame onboarding around a habit contract. Rastrum's notification model is Kairos (seasonal nudges), not daily streak shaming.
- **Personalized paywall plans.** Free product; not relevant in v1.

---

## References

- Mobbin onboarding study (YouTube, 2026-05) — source of the patterns.
- [`onboarding-events.md`](onboarding-events.md) — DOM event contract.
- [`onboarding-funnel.md`](onboarding-funnel.md) — 7-event PostHog funnel
  (note: 3 events not yet wired despite the runbook).
- [`../specs/modules/18-onboarding.md`](../specs/modules/18-onboarding.md) — original spec.
- CLAUDE.md *"Persuasive Tech (Fogg) — v1.1.5 conventions"* — adjacent
  pattern guidance.
