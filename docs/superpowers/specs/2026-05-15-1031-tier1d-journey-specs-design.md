# Tier 1d — Per-feature journey e2e specs (Epic #1031)

> Spec for the 10 missing Playwright journey specs called out in epic
> [#1031](https://github.com/ArtemioPadilla/rastrum/issues/1031) Tier 1d.
> Implementation plan: `docs/superpowers/plans/2026-05-15-1031-tier1d-journey-specs-plan.md`.

## Goal

Add 10 `journey-*.spec.ts` Playwright specs covering the user flows that
have **zero e2e regression coverage today**, so a class of "shipped clean,
broke prod" bug (the exact failure mode that produced the PlantNet/identify
multi-hour debug session on 2026-05-15) is caught before merge.

## Non-goals (read this first — it is the load-bearing decision)

These are **UI-flow regression specs, NOT integration tests.**

- They run against the static `astro preview` build with a **mock Supabase
  session injected into localStorage** (`tests/e2e/fixtures/auth.ts`). There
  is no real backend.
- **Do NOT `page.route`-mock Supabase RPC/Edge-Function calls.** Epic #1031's
  explicit anti-pattern: mocked integration is what *ships* the bugs (the
  #1015 lesson). Integration at the EF seam is covered by Tier 1a EF
  contract tests (already shipped, #1053–#1057), not here.
- Therefore each spec asserts only what is deterministic without a backend:
  the route renders, the locale pair renders, the documented client-side
  flow fires (events, deep-link querystrings, localStorage gating), and
  known regression-vector elements are present. This is exactly the
  assertion vocabulary already proven in
  `tests/e2e/journey-observer-first-obs.spec.ts`.
- "Does the RPC return the right rows" is **out of scope here by design.**

## Harness contract (already exists — do not reinvent)

| Concern | Mechanism | Source of truth |
|---|---|---|
| Auth | `import { test, expect } from './fixtures/auth'`; `authedPage` / `expertPage` / `adminPage` / `modPage` inject a mock `sb-…-auth-token` localStorage session | `tests/e2e/fixtures/auth.ts` |
| Guest flows | plain `import { test, expect } from '@playwright/test'` | `tests/e2e/journey-guest-browse.spec.ts` |
| Consent banner (z-9000, intercepts clicks) | `page.addInitScript(() => localStorage.setItem('rastrum_analytics_consent','false'))` | `tests/e2e/journey-guides.spec.ts:17` |
| WebLLM model-cache gate | wrap `caches.open('webllm/model')` to pre-seed a fake shard | `mockChatModelCached` in `tests/e2e/chat-deep-link.spec.ts:72` |
| Client events | `page.evaluate(() => window.dispatchEvent(new CustomEvent('rastrum:…')))` | `journey-observer-first-obs.spec.ts:11` |
| Project / file naming | File **must** be `tests/e2e/journey-<name>.spec.ts` to match the `journey-chromium` Playwright project (`testMatch: /journey-(?!mobile).*\.spec\.ts/`, 60 s timeout) | `playwright.config.ts` |
| Retry / flake budget | journeys get 2 retries; a persistent flake is renamed `*.flaky.spec.ts` (excluded from the required check) and fixed/deleted within 7 days | `docs/qa-policy.md` §2–3 |
| CI time budget | PR CI p50 5 min / p95 8 min — each spec keeps to a handful of fast `goto` + presence assertions, no long waits | `docs/qa-policy.md` §1 |

A shared helper `tests/e2e/fixtures/journey-helpers.ts` is added to DRY the
two cross-cutting init steps (consent dismissal + optional WebLLM cache
seed) so each spec stays ~30–60 lines.

## The 10 journeys

Routes verified against `src/i18n/utils.ts` and `src/pages/`. `/share/obs/`
and `/auth/callback/` are **locale-neutral single pages** (no `/en|/es`
prefix — regression-tested as such per the CLAUDE.md pitfall).

| # | Spec file | Route(s) | Fixture | Guards regression vector |
|---|---|---|---|---|
| 1 | `journey-photo-id-cascade.spec.ts` | `/en/observe/` `/es/observar/` | `authedPage` | The 2026-05-15 saga: observe form renders, dropzone present, pipeline stepper element exists, `obs2-identify-error` banner element exists in DOM, locale pair parity |
| 2 | `journey-magic-link-pkce-callback.spec.ts` | `/auth/callback/` (locale-neutral) | plain | PR #350 magic-link loop: callback page renders without throwing, shows a verifying/redirect state, no infinite spinner element stuck |
| 3 | `journey-onboarding-tour-replay.spec.ts` | `/en/` | `authedPage` | PR #993: `rastrum:replay-onboarding` opens `#onboarding-tour`, all 7 steps advance, closes; replay event is idempotent |
| 4 | `journey-share-observation-public.spec.ts` | `/share/obs/?id=<uuid>` (no locale prefix) | plain | CLAUDE.md `/es/share/obs/` 404 trap: locale-neutral page renders for a synthetic id, does not 404, og/meta present |
| 5 | `journey-watchlist-rare-species-alert.spec.ts` | `/en/explore/watchlist/` `/es/explorar/seguimiento/` | `authedPage` | Watchlist page renders authed, locale pair parity |
| 6 | `journey-chat-find-species-and-observe.spec.ts` | `/en/chat/` `/es/chat/` | `authedPage` + `mockChatModelCached` | Chat renders past the model-cache gate, composer present, deep-link `?attach=` chip path (reuses chat-deep-link proven flow) |
| 7 | `journey-projects-create-and-join.spec.ts` | `/en/projects/` `/en/projects/new/` `/es/proyectos/` | `authedPage` | M29: projects index + new-project form render authed, locale pair parity |
| 8 | `journey-camera-station-import.spec.ts` | `/en/projects/detail/?slug=<s>` | `authedPage` | M31: project-detail renders for a slug, camera-station section element present (UI-flow only — the CLI is Node, out of browser scope; noted explicitly) |
| 9 | `journey-falta-dex-region-pool.spec.ts` | `/en/profile/dex/` `/es/perfil/dex/` | `authedPage` | v1.1.5 Fogg: PokedexView renders authed; honest-norms `n<50` "not enough data" fallback element present (never raw-rank) |
| 10 | `journey-passkey-enroll-then-verify.spec.ts` | profile settings/edit (ProfileSecurityForm) | `authedPage` | Passkey UI renders; `navigator.credentials` absent in headless → graceful unsupported state, not a thrown error |

## Per-spec assertion floor (the safe vocabulary)

Every spec asserts, at minimum:
1. `await expect(page.locator('main').first()).toBeVisible()` after `goto`.
2. For localized routes: the `/en` and `/es` (or `/observar`, `/perfil`,
   `/proyectos`, `/explorar/seguimiento`) pair both render `main`.
3. The **named regression-vector element** for that journey is present via
   `expect(await page.locator(SEL).count()).toBeGreaterThan(0)` —
   presence, not exact text (lowest-flake; matches house style).
4. No uncaught page error: attach `page.on('pageerror', …)` and assert the
   collected list is empty at test end (catches the "throws and stalls"
   class directly — this is the single highest-value assertion for the
   2026-05-15 bug class).

Specs do **not** assert RPC results, exact copy, pixel layout, or anything
requiring a live backend. Anything needing those is Tier 1a (done) or Tier
4 (human/PostHog, can't automate).

## Rollout

One PR per spec is too chatty for a solo repo at p50-5-min CI; the epic's
own guidance is "shipped PR-by-PR" but bundling is acceptable when CI-coupled
(per the team's bundling rule). **Two PRs**:

- PR A: shared helper + journeys 1–5 (the highest-impact half; #1 is the
  proven gap).
- PR B: journeys 6–10.

Each PR is independently green and revertable. If any single spec proves
flaky under the 2-retry budget, it ships renamed `*.flaky.spec.ts` with a
tracking note rather than blocking the PR (qa-policy §3).

## Success criteria

- 10 new specs, all green on `journey-chromium` locally and in CI.
- `npx playwright test --project=journey-chromium` total added wall-time
  **< 90 s** (keeps PR CI inside the p95 8-min budget).
- Epic #1031 Tier 1d checklist fully ticked with PR refs.
- Zero `page.route` Supabase mocks introduced (grep-assertable).

## Out of scope / explicitly deferred

- True ephemeral-Supabase integration journeys (#1031 open question) —
  separate spike, not this spec.
- Camera-station **CLI** coverage (Node, `cli/test/` native runner) — the
  browser journey only covers the project-detail station UI.
- Mobile variants of these 10 — `journey-mobile-core.spec.ts` already
  covers the mobile shell; per-journey mobile is Tier 3.
