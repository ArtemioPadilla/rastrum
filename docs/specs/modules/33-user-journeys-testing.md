# Module 33 — User Journeys: Comprehensive Testing, Guided Tours & Feedback Loop

**Version target:** v1.2 (E2E journey tests) → v1.3 (interactive guides) → v1.4 (feedback loop)
**Status:** shipped (all three layers implemented)
**Depends on:** modules 02 (observation), 04 (auth), 08 (gamification), 18 (onboarding), 22 (validation), 26 (social)

---

## Overview

Three layers that reinforce each other:

1. **Layer 1 — E2E Journey Tests (Playwright):** 10 journey specs covering every persona (guest, observer, offline observer, expert, moderator, admin, social user, researcher, sponsor, mobile). Auth fixtures inject mock Supabase sessions; data fixtures seed Dexie. Two new Playwright projects (journey-chromium, journey-mobile) with 60s timeouts. Lighthouse CI expanded from 5 to 13 URLs.

2. **Layer 2 — Interactive Journey Guides:** 6 contextual spotlight tours (observe, explore, validate, export, community, console) that auto-show on first visit. Reusable JourneySpotlight engine extracted from OnboardingTour pattern. "?" replay button on every guided page. All text bilingual EN/ES.

3. **Layer 3 — Feedback Loop:** 5 micro-surveys (emoji scale, thumbs, multiple choice) triggered after journey completions and key actions. localStorage-backed storage with admin dashboard at /console/feedback/ (CSV export). Telemetry unified with existing rastrum:onboarding-event system.

## Files created

- `src/lib/journey-guides.ts` — Guide registry (6 guides, 24 steps)
- `src/lib/feedback.ts` — Survey registry (5 surveys) + localStorage helpers
- `src/components/JourneySpotlight.astro` — Reusable spotlight overlay engine
- `src/components/JourneyGuideLoader.astro` — BaseLayout auto-loader
- `src/components/JourneyReplayButton.astro` — "?" replay trigger
- `src/components/MicroSurvey.astro` — Feedback widget
- `src/components/console/ConsoleFeedbackView.astro` — Admin feedback dashboard
- `src/pages/{en,es}/console/feedback/` — Console feedback routes
- `tests/e2e/fixtures/auth.ts` — Mock auth session fixtures
- `tests/e2e/fixtures/data.ts` — Dexie data seeding
- `tests/e2e/journey-*.spec.ts` — 10 journey test files
- `tests/e2e/journey-guides.spec.ts` — Guide E2E tests
- `tests/e2e/feedback.spec.ts` — Feedback E2E tests

## Files modified

- `playwright.config.ts` — Added journey-chromium + journey-mobile projects
- `package.json` — Added test:e2e:journeys, test:e2e:all scripts
- `lighthouserc.cjs` — Expanded from 5 to 13 audited URLs
- `src/layouts/BaseLayout.astro` — Mounts JourneyGuideLoader
- `src/lib/console-tabs.ts` — Added feedback tab
- `src/i18n/utils.ts` — Added consoleFeedback route + routeTree entry
- `src/i18n/{en,es}.json` — Added guides + feedback i18n blocks
- `tests/lib/console-tabs.test.ts` — Updated tab counts
- `docs/specs/modules/00-index.md` — Registered module 33
