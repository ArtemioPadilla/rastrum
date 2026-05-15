# Tier 1d Journey Specs — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Add the 10 missing `journey-*.spec.ts` Playwright specs from epic #1031 Tier 1d, as UI-flow regression coverage (not integration) against the static preview build.

**Architecture:** Each spec uses the existing `tests/e2e/fixtures/auth.ts` mock-session fixtures + a new shared `journey-helpers.ts` (consent dismissal, WebLLM cache seed, pageerror collector). Assertions are the proven-safe vocabulary from `journey-observer-first-obs.spec.ts`: route renders, locale pair parity, named regression-vector element present, zero uncaught page errors. No `page.route` Supabase mocking (epic anti-pattern).

**Tech Stack:** Playwright (`@playwright/test`), Astro static preview (`npm run preview` on port 4329), the `journey-chromium` project (`testMatch: /journey-(?!mobile).*\.spec\.ts/`).

**Spec:** `docs/superpowers/specs/2026-05-15-1031-tier1d-journey-specs-design.md`

---

## Note on TDD framing

These specs test **already-shipped** features, so the classic "write a
failing test, then implement" loop does not apply. The adapted loop per
task is:

1. Write the spec.
2. Run it against the real preview build.
3. **Expected: PASS** (the feature exists). If it FAILS, you have found a
   real regression — that is the entire point of the spec; investigate
   with `superpowers:systematic-debugging` before adjusting the assertion.
   Never weaken an assertion to make a real failure green.
4. Commit.

## File Structure

| File | Responsibility |
|---|---|
| `tests/e2e/fixtures/journey-helpers.ts` | CREATE — `dismissConsent(page)`, `seedWebLLMCache(page)`, `collectPageErrors(page)` |
| `tests/e2e/journey-photo-id-cascade.spec.ts` | CREATE — observe form + pipeline + identify-error banner |
| `tests/e2e/journey-magic-link-pkce-callback.spec.ts` | CREATE — `/auth/callback/` no-loop |
| `tests/e2e/journey-onboarding-tour-replay.spec.ts` | CREATE — replay event 7-step + idempotent |
| `tests/e2e/journey-share-observation-public.spec.ts` | CREATE — locale-neutral `/share/obs/` |
| `tests/e2e/journey-watchlist-rare-species-alert.spec.ts` | CREATE — watchlist authed + locale pair |
| `tests/e2e/journey-chat-find-species-and-observe.spec.ts` | CREATE — chat past model gate + deep-link |
| `tests/e2e/journey-projects-create-and-join.spec.ts` | CREATE — projects index + new form |
| `tests/e2e/journey-camera-station-import.spec.ts` | CREATE — project-detail station UI |
| `tests/e2e/journey-falta-dex-region-pool.spec.ts` | CREATE — dex + honest-norms fallback |
| `tests/e2e/journey-passkey-enroll-then-verify.spec.ts` | CREATE — passkey graceful-unsupported |

---

### Task 0: Shared journey helpers

**Files:**
- Create: `tests/e2e/fixtures/journey-helpers.ts`

- [ ] **Step 1: Write the helper module**

```typescript
/**
 * Shared journey-spec helpers. DRY for the two cross-cutting init steps
 * (consent banner dismissal, WebLLM cache seed) plus a pageerror collector
 * — the single highest-value assertion for the "throws and stalls" bug
 * class (the 2026-05-15 identify saga). See
 * docs/superpowers/specs/2026-05-15-1031-tier1d-journey-specs-design.md.
 */
import type { Page } from '@playwright/test';

/** The analytics consent banner sits at z-9000 and intercepts clicks.
 *  Suppress it before any navigation. */
export async function dismissConsent(page: Page): Promise<void> {
  await page.addInitScript(() => {
    try { localStorage.setItem('rastrum_analytics_consent', 'false'); } catch { /* noop */ }
  });
}

/** Pre-seed the WebLLM model cache so chat renders past its cache gate.
 *  Mirrors mockChatModelCached in chat-deep-link.spec.ts. */
export async function seedWebLLMCache(page: Page): Promise<void> {
  await page.addInitScript(() => {
    if (typeof caches === 'undefined') return;
    const FAKE_URL = 'https://e2e.fixture/Llama-3.2-1B-Instruct-q4f16_1-MLC/shard.bin';
    const realOpen = caches.open.bind(caches);
    (caches as unknown as { open: typeof caches.open }).open = async (name: string) => {
      const c = await realOpen(name);
      if (name === 'webllm/model') {
        const existing = await c.match(FAKE_URL);
        if (!existing) {
          await c.put(FAKE_URL, new Response(new Uint8Array(0), { headers: { 'content-length': '0' } }));
        }
      }
      return c;
    };
  });
}

/** Collect uncaught page errors. Assert the returned array is empty at
 *  test end — directly catches the "feature throws, pipeline stalls,
 *  nothing shown" regression class. */
export function collectPageErrors(page: Page): string[] {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(e.message));
  return errors;
}
```

- [ ] **Step 2: Typecheck**

Run: `npx tsc --noEmit`
Expected: exit 0 (no errors).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/fixtures/journey-helpers.ts
git commit -m "test(e2e): shared journey helpers — consent, webllm cache, pageerror collector (#1031 Tier 1d)"
```

---

### Task 1: journey-photo-id-cascade

**Files:**
- Create: `tests/e2e/journey-photo-id-cascade.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — Photo-ID cascade. Guards the 2026-05-15 regression class
 * (HEIC silent-fail, verify_jwt gateway reject, taxa upsert): the observe
 * form, pipeline stepper, and the identify-error banner element (PR #1062)
 * must render, the locale pair must be structurally identical, and the
 * page must not throw. UI-flow only — no backend (epic #1031 non-goal).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: photo-ID cascade', () => {
  test.beforeEach(async ({ authedPage: page }) => { await dismissConsent(page); });

  test('observe form + pipeline + identify-error banner render (EN)', async ({ authedPage: page }) => {
    const errs = collectPageErrors(page);
    await page.goto('/en/observe/');
    await expect(page.locator('main').first()).toBeVisible();

    // Dropzone / file input present
    expect(await page.locator('[data-dropzone], #obs-dropzone, input[type="file"]').count())
      .toBeGreaterThan(0);
    // Pipeline stepper element exists in the DOM (hidden until files added)
    expect(await page.locator('#pipeline-stepper, #obs2-pipeline-section').count())
      .toBeGreaterThan(0);
    // The identify-error banner (PR #1062) must exist so failures are visible
    expect(await page.locator('#obs2-identify-error').count()).toBeGreaterThan(0);

    expect(errs).toEqual([]);
  });

  test('ES locale route renders the same shell', async ({ authedPage: page }) => {
    const errs = collectPageErrors(page);
    await page.goto('/es/observar/');
    await expect(page.locator('main').first()).toBeVisible();
    expect(await page.locator('#obs2-identify-error').count()).toBeGreaterThan(0);
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-photo-id-cascade`
Expected: PASS (3 assertions × 2 tests). If `#obs2-identify-error` count is 0, PR #1062 regressed — stop and investigate, do not delete the assertion.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-photo-id-cascade.spec.ts
git commit -m "test(e2e): journey-photo-id-cascade — observe pipeline + error banner (#1031 Tier 1d)"
```

---

### Task 2: journey-magic-link-pkce-callback

**Files:**
- Create: `tests/e2e/journey-magic-link-pkce-callback.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — Magic-link / PKCE callback. Guards PR #350 (callback looped
 * forever on "Verificando tu enlace"). The locale-neutral /auth/callback/
 * page must render a terminal verifying/redirect state and must not throw
 * or hang on a permanently-visible spinner. No real token exchange (no
 * backend) — we assert the page boots and resolves its UI, not auth success.
 */
import { test, expect } from '@playwright/test';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: magic-link PKCE callback', () => {
  test('callback page renders without throwing or hanging', async ({ page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);

    await page.goto('/auth/callback/');
    await expect(page.locator('main, body').first()).toBeVisible();

    // It must reach a terminal state within the page's own 8 s timeout
    // (PR #350 added an 8 s guard). Give margin; assert the doc settled.
    await page.waitForLoadState('networkidle');
    // No locale prefix variant should exist — /en/auth/callback must 404-ish
    // (regression guard for the locale-neutral contract).
    const resp = await page.goto('/en/auth/callback/');
    expect(resp?.status() ?? 200).toBeGreaterThanOrEqual(400);

    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-magic-link-pkce-callback`
Expected: PASS. If `/en/auth/callback/` returns < 400, the locale-neutral contract regressed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-magic-link-pkce-callback.spec.ts
git commit -m "test(e2e): journey-magic-link-pkce-callback — no loop, locale-neutral (#1031 Tier 1d)"
```

---

### Task 3: journey-onboarding-tour-replay

**Files:**
- Create: `tests/e2e/journey-onboarding-tour-replay.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — Onboarding tour replay. Guards PR #993. The
 * rastrum:replay-onboarding event must open #onboarding-tour, all 7 steps
 * advance, and it must close. Re-firing the event must be idempotent
 * (reopens cleanly, not double-mounted).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: onboarding tour replay', () => {
  test('replay opens, walks 7 steps, closes, and is idempotent', async ({ authedPage: page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);

    await page.goto('/en/');
    const dialog = page.locator('#onboarding-tour');

    for (let round = 0; round < 2; round++) {
      await page.evaluate(() => window.dispatchEvent(new CustomEvent('rastrum:replay-onboarding')));
      await expect(dialog).toBeVisible();
      for (let i = 0; i < 7; i++) {
        await expect(page.locator('#onb-step-label')).toContainText(`${i + 1} of 7`);
        await page.locator('#onb-next').click();
      }
      await expect(dialog).toBeHidden();
    }
    // Idempotent: exactly one tour node in the DOM after two replays
    expect(await page.locator('#onboarding-tour').count()).toBe(1);
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-onboarding-tour-replay`
Expected: PASS.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-onboarding-tour-replay.spec.ts
git commit -m "test(e2e): journey-onboarding-tour-replay — 7-step + idempotent (#1031 Tier 1d)"
```

---

### Task 4: journey-share-observation-public

**Files:**
- Create: `tests/e2e/journey-share-observation-public.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — Public share/obs. Guards the CLAUDE.md pitfall: /share/obs/ is
 * a LOCALE-NEUTRAL single page; /es/share/obs/ 404s. The page must render
 * for a synthetic id without throwing, and the /en|/es prefixed variants
 * must NOT resolve (that's the regression).
 */
import { test, expect } from '@playwright/test';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

const SYNTHETIC_ID = '00000000-0000-0000-0000-000000000abc';

test.describe('J: public share observation', () => {
  test('locale-neutral /share/obs/ renders; prefixed variants 404', async ({ page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);

    const ok = await page.goto(`/share/obs/?id=${SYNTHETIC_ID}`);
    expect(ok?.status() ?? 200).toBeLessThan(400);
    await expect(page.locator('main, body').first()).toBeVisible();

    for (const bad of [`/en/share/obs/?id=${SYNTHETIC_ID}`, `/es/share/obs/?id=${SYNTHETIC_ID}`]) {
      const r = await page.goto(bad);
      expect(r?.status() ?? 200).toBeGreaterThanOrEqual(400);
    }
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-share-observation-public`
Expected: PASS. A `< 400` on a prefixed variant means the locale-neutral contract regressed.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-share-observation-public.spec.ts
git commit -m "test(e2e): journey-share-observation-public — locale-neutral guard (#1031 Tier 1d)"
```

---

### Task 5: journey-watchlist-rare-species-alert

**Files:**
- Create: `tests/e2e/journey-watchlist-rare-species-alert.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — Watchlist. Authed watchlist page must render and the locale
 * pair must be structurally present. UI-flow only (alert delivery is a
 * backend concern — out of scope per #1031 non-goal).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: watchlist', () => {
  for (const route of ['/en/explore/watchlist/', '/es/explorar/seguimiento/']) {
    test(`watchlist renders authed: ${route}`, async ({ authedPage: page }) => {
      await dismissConsent(page);
      const errs = collectPageErrors(page);
      await page.goto(route);
      await expect(page.locator('main').first()).toBeVisible();
      expect(errs).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-watchlist-rare-species-alert`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-watchlist-rare-species-alert.spec.ts
git commit -m "test(e2e): journey-watchlist-rare-species-alert — authed + locale pair (#1031 Tier 1d)"
```

---

### Task 6: Open PR A (helper + journeys 1–5)

- [ ] **Step 1: Push + PR**

```bash
git push -u origin fix/tier1d-journeys-a
gh pr create --base main --head fix/tier1d-journeys-a \
  --title "test(e2e): Tier 1d journey specs A — cascade, callback, onboarding, share, watchlist (#1031)" \
  --body "Epic #1031 Tier 1d, part A (5 of 10). Spec: docs/superpowers/specs/2026-05-15-1031-tier1d-journey-specs-design.md. UI-flow regression only — no Supabase route mocking (epic anti-pattern). Each spec asserts route render + locale pair + named regression-vector element + zero uncaught page errors."
```

- [ ] **Step 2: Verify CI green, then enable automerge**

```bash
gh pr checks <PR#>
gh pr merge <PR#> --squash --auto
```

---

### Task 7: journey-chat-find-species-and-observe

**Files:**
- Create: `tests/e2e/journey-chat-find-species-and-observe.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — Chat → species. Chat must render past its WebLLM model-cache
 * gate (seeded) with a composer present, and the ?attach= deep-link chip
 * path (proven in chat-deep-link.spec.ts) must hydrate. UI-flow only —
 * no model inference (out of scope).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, seedWebLLMCache, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: chat find species', () => {
  test('chat renders past model gate with a composer (EN)', async ({ authedPage: page }) => {
    await dismissConsent(page);
    await seedWebLLMCache(page);
    const errs = collectPageErrors(page);

    await page.goto('/en/chat/');
    await expect(page.locator('main').first()).toBeVisible();
    // A text input / textarea composer must be present once past the gate
    expect(await page.locator('textarea, input[type="text"], [contenteditable="true"]').count())
      .toBeGreaterThan(0);
    expect(errs).toEqual([]);
  });

  test('ES chat route renders', async ({ authedPage: page }) => {
    await dismissConsent(page);
    await seedWebLLMCache(page);
    const errs = collectPageErrors(page);
    await page.goto('/es/chat/');
    await expect(page.locator('main').first()).toBeVisible();
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-chat-find-species-and-observe`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-chat-find-species-and-observe.spec.ts
git commit -m "test(e2e): journey-chat-find-species-and-observe — past model gate (#1031 Tier 1d)"
```

---

### Task 8: journey-projects-create-and-join

**Files:**
- Create: `tests/e2e/journey-projects-create-and-join.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — M29 Projects. Projects index + new-project form render authed;
 * locale pair parity. UI-flow only — upsert_project RPC is out of scope
 * (#1031 non-goal; covered by Tier 1a EF contract).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: projects create + join', () => {
  for (const route of ['/en/projects/', '/es/proyectos/', '/en/projects/new/']) {
    test(`renders authed: ${route}`, async ({ authedPage: page }) => {
      await dismissConsent(page);
      const errs = collectPageErrors(page);
      await page.goto(route);
      await expect(page.locator('main').first()).toBeVisible();
      expect(errs).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-projects-create-and-join`
Expected: PASS (3 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-projects-create-and-join.spec.ts
git commit -m "test(e2e): journey-projects-create-and-join — M29 routes authed (#1031 Tier 1d)"
```

---

### Task 9: journey-camera-station-import

**Files:**
- Create: `tests/e2e/journey-camera-station-import.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — M31 camera stations (UI only). The project-detail page must
 * render for a slug without throwing. The CLI batch import (cli/, Node) is
 * NOT browser-testable and is explicitly out of scope here (#1031 spec
 * "out of scope"); it has its own cli/test/ native runner.
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: camera station UI', () => {
  test('project-detail renders for a slug (EN)', async ({ authedPage: page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);
    await page.goto('/en/projects/detail/?slug=e2e-nonexistent');
    await expect(page.locator('main').first()).toBeVisible();
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-camera-station-import`
Expected: PASS. (If `/projects/detail/` is not a built route, the route slug is wrong — verify against `src/pages/en/projects/` and fix the path, do not delete the test.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-camera-station-import.spec.ts
git commit -m "test(e2e): journey-camera-station-import — project-detail UI (#1031 Tier 1d)"
```

---

### Task 10: journey-falta-dex-region-pool

**Files:**
- Create: `tests/e2e/journey-falta-dex-region-pool.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — v1.1.5 Fogg falta-dex. The dex (PokedexView) must render
 * authed. Honest-norms invariant: with no backend the peer-comparison
 * pool count must NOT raw-rank — the "not enough data" fallback must be
 * the rendered state, never a fabricated number. We assert the page does
 * not throw and renders; exact copy is Tier 4 (human).
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: falta-dex region pool', () => {
  for (const route of ['/en/profile/dex/', '/es/perfil/dex/']) {
    test(`dex renders authed: ${route}`, async ({ authedPage: page }) => {
      await dismissConsent(page);
      const errs = collectPageErrors(page);
      await page.goto(route);
      await expect(page.locator('main').first()).toBeVisible();
      expect(errs).toEqual([]);
    });
  }
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-falta-dex-region-pool`
Expected: PASS (2 tests).

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-falta-dex-region-pool.spec.ts
git commit -m "test(e2e): journey-falta-dex-region-pool — dex renders authed (#1031 Tier 1d)"
```

---

### Task 11: journey-passkey-enroll-then-verify

**Files:**
- Create: `tests/e2e/journey-passkey-enroll-then-verify.spec.ts`

- [ ] **Step 1: Write the spec**

```typescript
/**
 * Tier 1d — Passkey. Headless Chromium has no real authenticator, so the
 * passkey UI (ProfileSecurityForm) must degrade gracefully — render a
 * disabled/unsupported state, NOT throw an uncaught error. That graceful
 * path is the regression vector worth guarding.
 */
import { test, expect } from './fixtures/auth';
import { dismissConsent, collectPageErrors } from './fixtures/journey-helpers';

test.describe('J: passkey enroll/verify', () => {
  test('profile settings renders passkey UI without throwing', async ({ authedPage: page }) => {
    await dismissConsent(page);
    const errs = collectPageErrors(page);
    await page.goto('/en/profile/settings/');
    await expect(page.locator('main').first()).toBeVisible();
    // ProfileSecurityForm is on the settings/edit surface; assert the page
    // settled and did not throw even though navigator.credentials is absent.
    await page.waitForLoadState('networkidle');
    expect(errs).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it**

Run: `npx playwright test --project=journey-chromium journey-passkey-enroll-then-verify`
Expected: PASS. (If passkey UI is on `/profile/edit/` not `/profile/settings/`, correct the route from `src/pages/en/profile/` — keep the no-throw assertion.)

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/journey-passkey-enroll-then-verify.spec.ts
git commit -m "test(e2e): journey-passkey-enroll-then-verify — graceful unsupported (#1031 Tier 1d)"
```

---

### Task 12: Full suite gate + PR B (journeys 6–10)

- [ ] **Step 1: Run the whole journey project + assert no Supabase route-mocking crept in**

Run:
```bash
npx playwright test --project=journey-chromium
grep -rn "page.route(" tests/e2e/journey-*.spec.ts && echo "VIOLATION: route-mock in a journey spec" || echo "OK: no route mocks"
```
Expected: all journey specs PASS; grep prints "OK: no route mocks".

- [ ] **Step 2: Push + PR B**

```bash
git push -u origin fix/tier1d-journeys-b
gh pr create --base main --head fix/tier1d-journeys-b \
  --title "test(e2e): Tier 1d journey specs B — chat, projects, camera-station, falta-dex, passkey (#1031)" \
  --body "Epic #1031 Tier 1d, part B (5 of 10). Spec: docs/superpowers/specs/2026-05-15-1031-tier1d-journey-specs-design.md. UI-flow regression only; grep-verified zero page.route Supabase mocks."
```

- [ ] **Step 3: Verify CI green within budget, enable automerge**

```bash
gh pr checks <PR#>
gh pr merge <PR#> --squash --auto
```

---

### Task 13: Close out epic #1031 Tier 1d

- [ ] **Step 1: Tick the Tier 1d checklist on the issue**

```bash
gh issue comment 1031 --body "Tier 1d complete: all 10 journey specs landed (PRs A + B). UI-flow regression coverage per the agreed non-goal (no Supabase route-mocking; integration stays in Tier 1a). Spec: docs/superpowers/specs/2026-05-15-1031-tier1d-journey-specs-design.md. journey-photo-id-cascade specifically guards the 2026-05-15 identify regression class."
```

- [ ] **Step 2: Verify the added wall-time stays in budget**

Run: `npx playwright test --project=journey-chromium --reporter=list 2>&1 | tail -3`
Expected: total time for the 10 new specs combined < 90 s (spec success criterion; if exceeded, the slowest spec is the candidate to trim or `*.flaky.spec.ts`-quarantine per qa-policy §3).

---

## Self-Review

**Spec coverage:** All 10 journeys in the spec's table have a task (Tasks
1–5, 7–11). Shared helper (Task 0). Two-PR rollout (Tasks 6, 12) matches
the spec's "Rollout" section. Epic close-out (Task 13) matches success
criteria. No spec requirement is unmapped.

**Placeholder scan:** No TBD/TODO/"similar to". Every spec task contains
the full runnable Playwright file. Commands are exact. The only `<PR#>`
tokens are GitHub-assigned at runtime and unavoidable.

**Type consistency:** Helper exports `dismissConsent`, `seedWebLLMCache`,
`collectPageErrors` (Task 0) and every consuming spec imports exactly those
names. Fixtures `authedPage` match `tests/e2e/fixtures/auth.ts`. File names
match the `journey-(?!mobile)` testMatch.

**Known soft spots flagged in-plan, not hidden:** Tasks 9 & 11 carry
explicit "if the route slug is wrong, correct it from src/pages — do not
delete the assertion" notes, because `/projects/detail/` and the passkey
surface (`/profile/settings/` vs `/profile/edit/`) were not byte-verified
against built routes during planning. The executing agent verifies these
two at run time; every other route was confirmed against `src/i18n/utils.ts`
and `src/pages/`.
