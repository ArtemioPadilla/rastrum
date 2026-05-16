# Journey Catalog Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Ship a CI-enforced, provably-complete journey catalog so manual Chrome / e2e sweeps run against a list that cannot silently rot.

**Architecture:** A human-curated markdown doc (`docs/journey-catalog.md`) whose §1 "route spine" (one fenced row per route) is mechanically diffed against the route sources of truth by a new vitest, mirroring `tests/unit/dynamic-routes-parity.test.ts`. A §2 journey-flow overlay groups routes into named end-to-end flows (reading aid, not drift-checked).

**Tech Stack:** Markdown, Vitest (`node:fs`), TypeScript. No new deps. Docs + one test + two cross-link edits. One PR on branch `feat/journey-catalog` (worktree `.worktrees/journey-catalog` already exists).

**Spec:** `docs/superpowers/specs/2026-05-16-journey-catalog-design.md` (read it; it is authoritative if this plan disagrees).

**Sources of truth (confirmed):**
- `src/i18n/utils.ts` → `export const routes` — **95 keys**.
- `src/lib/console-tabs.ts` → `export const CONSOLE_TABS` — 39 unique `routeKey`s, all already a subset of `routes`. Union = 95.

**Worktree env constraint:** all paths below are relative to the worktree root `/Users/artemiopadilla/Documents/repos/GitHub/personal/rastrum/.worktrees/journey-catalog`. `cd` there for every command. Subagents: you cannot run git — the controller commits; stage files explicitly (never `git add -A` in a worktree).

---

## File structure

- **Create** `docs/journey-catalog.md` — the living catalog (§1 fenced route-spine table, §2 journey-flow overlay, §3 sweep procedure, cross-links).
- **Create** `tests/unit/journey-catalog-complete.test.ts` — the drift-check.
- **Modify** `docs/qa-policy.md` — add a §7 References bullet pointing at the catalog.
- **Modify** `docs/journey-audit-2026-05-15.md` — add a one-line forward pointer near the top ("living catalog supersedes this snapshot's completeness role").
- **Throwaway, NOT committed:** `/tmp/gen-spine.mjs` — generates the 95 spine rows; deleted before commit.

---

### Task 1: Generate and author `docs/journey-catalog.md`

**Files:**
- Create: `docs/journey-catalog.md`
- Throwaway: `/tmp/gen-spine.mjs` (delete before commit)

- [ ] **Step 1: Write the spine generator**

Create `/tmp/gen-spine.mjs` (plain node, regex-parses the TS sources — node cannot import `.ts`):

```js
import { readFileSync } from 'node:fs';

const ROOT = process.cwd(); // run from worktree root

// --- routes: key -> {en, es} ---
const utils = readFileSync(`${ROOT}/src/i18n/utils.ts`, 'utf8');
const routesBlock = utils.match(/export const routes[^{]*\{([\s\S]*?)\n\};/)[1];
const routeRe = /^\s{2}([a-zA-Z][a-zA-Z0-9]*):\s*\{\s*en:\s*'([^']*)',\s*es:\s*'([^']*)'/gm;
const routes = {};
for (const m of routesBlock.matchAll(routeRe)) routes[m[1]] = { en: m[2], es: m[3] };

// --- console-tabs: routeKey -> role ---
const ct = readFileSync(`${ROOT}/src/lib/console-tabs.ts`, 'utf8');
const consoleRole = {};
for (const m of ct.matchAll(/routeKey:\s*'([^']+)'[^}]*?role:\s*'([^']+)'|role:\s*'([^']+)'[^}]*?routeKey:\s*'([^']+)'/g)) {
  if (m[1]) consoleRole[m[1]] = m[2];
  else consoleRole[m[4]] = m[3];
}

// --- anon vs authed heuristic (deterministic; curate exceptions in Step 3) ---
const ANON = new Set(['home','explore','exploreMap','exploreRecent','exploreSpecies',
  'explorePlaces','exploreSpeciesDetail','exploreTrails','explorePits','fieldGuide',
  'observe','identify','about','docs','signIn','publicProfile','community',
  'communityObservers','communityMap','leaderboard','discover','privacy','terms','faq',
  'sponsoredBy','projects','projectNew','chat']);

const keys = Object.keys(routes).sort();
const rows = keys.map(k => {
  const r = routes[k];
  const enPath = '/en' + (r.en || '');
  const esPath = '/es' + (r.es || '');
  const auth = consoleRole[k] ? `role:${consoleRole[k]}`
             : ANON.has(k) ? 'anon' : 'authed';
  return `| \`${k}\` | ${enPath || '/en'} | ${esPath || '/es'} | ${auth} | R | — | never |  |`;
});
console.log(`${keys.length} rows`);
console.log(rows.join('\n'));
```

- [ ] **Step 2: Run it and capture the rows**

Run: `cd .worktrees/journey-catalog && node /tmp/gen-spine.mjs`
Expected: first line `95 rows`, then 95 pipe-delimited lines. Keep this output — it is the §1 table body.

- [ ] **Step 3: Write `docs/journey-catalog.md`**

Use this exact skeleton. Paste the 95 generated rows between the fences (after the header + separator rows already shown). Then apply the curation rules below to specific cells.

````markdown
# Journey Catalog

> CI-enforced, provably-complete catalog of every Rastrum route + the
> end-to-end journeys over them. The §1 spine is diffed against
> `routes` (`src/i18n/utils.ts`) ∪ `CONSOLE_TABS.routeKey`
> (`src/lib/console-tabs.ts`) by `tests/unit/journey-catalog-complete.test.ts`
> — a new/removed route fails CI until this file is updated.
>
> Historical point-in-time audit: [`journey-audit-2026-05-15.md`](journey-audit-2026-05-15.md).
> CI policy: [`qa-policy.md`](qa-policy.md).

## How to read

- **Auth**: `anon` (no login) · `authed` (any signed-in user) ·
  `role:admin|moderator|expert` (console/privileged).
- **R/W**: `R` read-only surface · `R+W` has write affordances (a
  read-only sweep must not submit writes here without per-item consent).
- **Spec**: covering `tests/e2e/journey-*.spec.ts`, or `—`.
- **Verified**: `YYYY-MM-DD` of the last real Chrome verification, or
  `never`. Update in-place when you sweep (see §3).

## §1 Route spine

<!-- spine:start -->
| `routeKey` | EN path | ES path | Auth | R/W | Spec | Verified | Issues |
| --- | --- | --- | --- | --- | --- | --- | --- |
PASTE THE 95 GENERATED ROWS HERE
<!-- spine:end -->

## §2 Journey-flow overlay

End-to-end flows as an ordered `routeKey` sequence → guarding spec.
Reading aid; not drift-checked (every route is already proven present
by §1).

| Flow | Route sequence | Spec |
| --- | --- | --- |
| guest-browse | `home` → `explore` → `exploreRecent` → `explorePlaces` → `exploreSpecies` | `journey-guest-browse.spec.ts` |
| first-observation | `observe` → `profileObservations` → `publicProfile` | `journey-observer-first-obs.spec.ts` |
| identify-cascade | `observe` (photo → cascade UI) | `journey-photo-id-cascade.spec.ts` |
| share-observation | `publicProfile` → `/share/obs/?id=` (locale-neutral) | `journey-share-observation-public.spec.ts` |
| watchlist | `exploreWatchlist` | `journey-watchlist-rare-species-alert.spec.ts` |
| social-engage | `publicProfile` → `inbox` → `profileFollowers` → `profileFollowing` | `journey-social-engage.spec.ts` |
| projects-camera | `projects` → `projectNew` | `journey-projects-create-and-join.spec.ts`, `journey-camera-station-import.spec.ts` |
| researcher-export | `profileExport` | `journey-researcher-export.spec.ts` |
| moderation-triage | `consoleModFlagQueue` → `consoleObservations` | `journey-mod-flags.spec.ts`, `journey-admin-health.spec.ts` |
| falta-dex | `dex` | `journey-falta-dex-region-pool.spec.ts` |
| auth-magic-link | `signIn` → `/auth/callback/` (locale-neutral) | `journey-magic-link-pkce-callback.spec.ts` |
| auth-passkey | `profileSettingsPrivacy` | `journey-passkey-enroll-then-verify.spec.ts` |
| onboarding | `home` (replay tour) | `journey-onboarding-tour-replay.spec.ts` |
| offline-pwa | `observe` (offline) | `journey-observer-offline.spec.ts` |
| mobile-chrome | `home` (mobile viewport) | `journey-mobile-core.spec.ts` |
| chat-ask-rastrum | `chat` (deep-link `?attach=`) | `journey-chat-find-species-and-observe.spec.ts` (model mocked) |

## §3 Sweep procedure

Read-only Chrome, signed-in. Walk §1 top-to-bottom. Per route:
`read_console_messages` with an error pattern + `read_network_requests`
(media/5xx); screenshot visual surfaces (map, observe form, lists).
On a clean route, set its `Verified` cell to the sweep date **in the
same PR**. A route marked `R+W` must not have writes submitted in a
read-only sweep without explicit per-item user consent. New bug → file
an issue, add its `#ref` to the route's `Issues` cell.

`/auth/callback/` and `/share/obs/` are intentionally locale-neutral
(no `routeKey`); they ride the `auth-magic-link` / `share-observation`
flows in §2 and are not §1 spine rows.
````

- [ ] **Step 4: Curate the generated cells (deterministic rules)**

Apply exactly these edits to the pasted rows:

1. **R+W** (change `R` → `R+W`) for: `observe`, `identify`,
   `profileEdit`, `profileSettingsProfile`, `profileSettingsPreferences`,
   `profileSettingsData`, `profileSettingsDeveloper`,
   `profileSettingsPrivacy`, `profileTokens`, `profileExpertApply`,
   `profileImport`, `profileImportCameraTrap`, `projectNew`,
   `sponsoring`, `communityDonate`, `exploreValidate`,
   `profileValidate`, `chat`, and every `console*` / `consoleMod*` /
   `consoleExpert*` key (all console tabs have write affordances).
2. **Verified = 2026-05-16** for the routes the 2026-05-16 sweep
   actually covered: `home`, `explore`, `explorePlaces`,
   `exploreRecent`, `exploreSpecies`, `observe`, `exploreMap`,
   `publicProfile`, `projects`, `profileExport`, `dex`,
   `exploreValidate`, `chat`, `consoleUsers`, `consoleHealth`,
   `consoleErrors`, `consoleObservations`, `consoleModFlagQueue`.
   All other rows keep `never` (honest — not aspirational).
3. **Issues**: `consoleObservations` → `#1112`; `exploreMap` →
   `#1113`.
4. **Spec**: fill from `ls tests/e2e/journey-*.spec.ts` where a spec
   clearly covers the route (e.g. `exploreRecent`/`explore`/`home` →
   `journey-guest-browse.spec.ts`; `observe` →
   `journey-observer-first-obs.spec.ts`; `chat` →
   `journey-chat-find-species-and-observe.spec.ts`;
   `consoleHealth` → `journey-admin-health.spec.ts`;
   `consoleModFlagQueue` → `journey-mod-flags.spec.ts`; `dex` →
   `journey-falta-dex-region-pool.spec.ts`; `exploreWatchlist` →
   `journey-watchlist-rare-species-alert.spec.ts`; `profileExport` →
   `journey-researcher-export.spec.ts`). Leave `—` where no spec
   clearly maps; do not invent filenames — verify each against
   `ls tests/e2e/`.

- [ ] **Step 5: Delete the throwaway generator**

Run: `rm /tmp/gen-spine.mjs`

- [ ] **Step 6: Commit**

```bash
cd .worktrees/journey-catalog
git add docs/journey-catalog.md
git commit -m "docs(qa): journey catalog — route spine + flow overlay"
```

---

### Task 2: Drift-check test (TDD: catalog is the data, test guards it)

**Files:**
- Create: `tests/unit/journey-catalog-complete.test.ts`

- [ ] **Step 1: Write the test**

Create `tests/unit/journey-catalog-complete.test.ts` with exactly:

```ts
/**
 * Journey-catalog completeness gate.
 *
 * docs/journey-catalog.md §1 "route spine" must list EXACTLY the route
 * keys in `routes` (src/i18n/utils.ts) ∪ `CONSOLE_TABS.routeKey`
 * (src/lib/console-tabs.ts). A new/removed route fails CI until the
 * catalog is updated — the rot mode that silently stale-d
 * journey-audit-2026-05-15.md (PR #1103 squash race) becomes impossible.
 *
 * Mirrors tests/unit/dynamic-routes-parity.test.ts (vitest + node:fs).
 */
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { routes } from '../../src/i18n/utils';
import { CONSOLE_TABS } from '../../src/lib/console-tabs';

const REPO_ROOT = resolve(__dirname, '..', '..');
const CATALOG = resolve(REPO_ROOT, 'docs/journey-catalog.md');

function spineKeys(): string[] {
  const md = readFileSync(CATALOG, 'utf8');
  const start = md.indexOf('<!-- spine:start -->');
  const end = md.indexOf('<!-- spine:end -->');
  expect(start, 'missing <!-- spine:start --> fence').toBeGreaterThanOrEqual(0);
  expect(end, 'missing <!-- spine:end --> fence').toBeGreaterThan(start);
  const block = md.slice(start, end);
  const keys: string[] = [];
  // A spine key line: first cell is a backticked identifier and nothing else.
  const re = /^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|/gm;
  for (const m of block.matchAll(re)) keys.push(m[1]);
  return keys;
}

const required = new Set<string>([
  ...Object.keys(routes),
  ...CONSOLE_TABS.map((t) => t.routeKey),
]);

describe('journey catalog — spine completeness', () => {
  const keys = spineKeys();

  it('has no duplicate spine rows', () => {
    const dupes = keys.filter((k, i) => keys.indexOf(k) !== i);
    expect(dupes, `duplicate spine rows: ${[...new Set(dupes)].join(', ')}`).toEqual([]);
  });

  it('lists every required route (no missing)', () => {
    const missing = [...required].filter((k) => !keys.includes(k)).sort();
    expect(
      missing,
      `journey catalog §1 is missing routes (add a spine row):\n  ${missing.join('\n  ')}`,
    ).toEqual([]);
  });

  it('has no stale/unknown routes (no extras)', () => {
    const extra = keys.filter((k) => !required.has(k)).sort();
    expect(
      extra,
      `journey catalog §1 has rows for routes not in routes/CONSOLE_TABS (removed from manifest?):\n  ${extra.join('\n  ')}`,
    ).toEqual([]);
  });
});

describe('journey catalog — Verified column hygiene', () => {
  it('every Verified cell is `never` or YYYY-MM-DD', () => {
    const md = readFileSync(CATALOG, 'utf8');
    const block = md.slice(
      md.indexOf('<!-- spine:start -->'),
      md.indexOf('<!-- spine:end -->'),
    );
    const bad: string[] = [];
    for (const line of block.split('\n')) {
      const m = line.match(/^\|\s*`([A-Za-z][A-Za-z0-9]*)`\s*\|/);
      if (!m) continue;
      const cells = line.split('|').map((c) => c.trim());
      // cells: ['', routeKey, en, es, auth, rw, spec, verified, issues, '']
      const verified = cells[7];
      if (verified !== 'never' && !/^\d{4}-\d{2}-\d{2}$/.test(verified)) {
        bad.push(`${m[1]}: "${verified}"`);
      }
    }
    expect(
      bad,
      `Verified must be 'never' or YYYY-MM-DD:\n  ${bad.join('\n  ')}`,
    ).toEqual([]);
  });
});
```

- [ ] **Step 2: Run it — expect PASS against the populated catalog**

Run: `cd .worktrees/journey-catalog && npx vitest run tests/unit/journey-catalog-complete.test.ts`
Expected: 4 tests, all PASS. (The catalog from Task 1 is complete, so the gate is green.)

- [ ] **Step 3: Prove the gate actually catches drift (do NOT commit this)**

Temporarily delete one spine row (e.g. the `` `home` `` line) from `docs/journey-catalog.md`, rerun the command.
Expected: the "lists every required route" test FAILS with `journey catalog §1 is missing routes … home`.
Then `git checkout docs/journey-catalog.md` to restore. This verifies the gate fails when it should — the TDD "watch it fail" step, done locally, not committed.

- [ ] **Step 4: Full suite green**

Run: `cd .worktrees/journey-catalog && npm run test 2>&1 | tail -3`
Expected: all test files pass (baseline ~2426 + 4 new = ~2430).

- [ ] **Step 5: Commit**

```bash
cd .worktrees/journey-catalog
git add tests/unit/journey-catalog-complete.test.ts
git commit -m "test(qa): journey-catalog spine drift-check (#dynamic-routes-parity pattern)"
```

---

### Task 3: Cross-links

**Files:**
- Modify: `docs/qa-policy.md` (the `## 7. References` list)
- Modify: `docs/journey-audit-2026-05-15.md` (forward pointer near top)

- [ ] **Step 1: Add the qa-policy reference**

In `docs/qa-policy.md`, find the `## 7. References` bullet list (ends with the `.github/workflows/...` line) and append one bullet:

```markdown
- [`journey-catalog.md`](journey-catalog.md) — CI-enforced, provably-
  complete route + journey catalog (the list sweeps run against;
  `tests/unit/journey-catalog-complete.test.ts` keeps it from rotting).
```

- [ ] **Step 2: Add the journey-audit forward pointer**

In `docs/journey-audit-2026-05-15.md`, immediately after the
`> **Status:**` blockquote near the top (the first `> ` block under
the title), add a new blockquote line:

```markdown
> **Living successor:** completeness is now owned by the CI-enforced
> [`journey-catalog.md`](journey-catalog.md). This file remains the
> immutable 2026-05-15/16 audit record; for "is every route covered"
> consult the catalog, not this snapshot.
```

If a `docs/journey-sweep-2026-05-16` PR (#1118) is still open at
execution time, that is fine — this pointer is additive and does not
conflict (different lines). Note it in the PR description.

- [ ] **Step 3: Verify both render (no broken relative links)**

Run: `cd .worktrees/journey-catalog && npm run build 2>&1 | tail -3`
Expected: build completes (docs are not built pages, but this confirms
nothing else broke). Then visually confirm the two relative links
`journey-catalog.md` resolve (same `docs/` dir).

- [ ] **Step 4: Commit**

```bash
cd .worktrees/journey-catalog
git add docs/qa-policy.md docs/journey-audit-2026-05-15.md
git commit -m "docs(qa): cross-link journey-catalog from qa-policy + audit doc"
```

---

### Task 4: Final verification + PR

**Files:** none (verification only)

- [ ] **Step 1: Gate**

```bash
cd .worktrees/journey-catalog
npx tsc --noEmit            # clean
npm run test 2>&1 | tail -3 # all green incl. 4 new
npm run build 2>&1 | tail -3 # 255 pages, no errors
git status --porcelain      # only the 4 intended files; NO /tmp leak, no node_modules
```
Expected: tsc clean; suite green; build clean; `git status` shows only
`docs/journey-catalog.md`, `tests/unit/journey-catalog-complete.test.ts`,
`docs/qa-policy.md`, `docs/journey-audit-2026-05-15.md` committed and a
clean tree.

- [ ] **Step 2: Open the PR**

```bash
cd /Users/artemiopadilla/Documents/repos/GitHub/personal/rastrum
gh pr create --base main --head feat/journey-catalog \
  --title "feat(qa): CI-enforced journey catalog (route spine + flow overlay)" \
  --body "Implements docs/superpowers/specs/2026-05-16-journey-catalog-design.md. New docs/journey-catalog.md (95 spine rows = routes ∪ CONSOLE_TABS.routeKey) + tests/unit/journey-catalog-complete.test.ts (drift-check mirroring dynamic-routes-parity.test.ts) + cross-links. Docs+test only; no schema/RLS/route code. Verified: tsc clean, full vitest green (+4), build clean."
```

- [ ] **Step 3: Arm auto-merge**

```bash
gh pr merge --squash --auto feat/journey-catalog
```

(Single feature branch, no follow-up pushes planned — squash will
capture the full branch; no #1103-style race.)

---

## Self-review

**Spec coverage:** Component 1 (catalog doc) → Task 1. Component 2
(drift-check test) → Task 2. Component 3 (honest initial population) →
Task 1 Step 4 rules (`2026-05-16` only for swept routes, else `never`).
Cross-links + rollout → Task 3. Non-goals respected (no generator
committed — `/tmp/gen-spine.mjs` is throwaway; overlay not drift-checked;
no route/schema code). Success criteria → Task 2 tests assert
exact-set + dup + Verified-format.

**Placeholder scan:** No TBD/TODO. The one "PASTE THE 95 GENERATED ROWS
HERE" marker is an explicit, mechanical instruction with the generator
producing the exact content in the prior step — not a hand-wave.

**Type/name consistency:** `spine:start`/`spine:end` fences identical in
spec, catalog skeleton (Task 1 Step 3) and test parser (Task 2). Column
order (routeKey|EN|ES|Auth|R/W|Spec|Verified|Issues) identical in
generator, skeleton, curation rules, and the test's `cells[7] =
verified` index (0=‘’,1=routeKey,…,7=verified). `routes` + `CONSOLE_TABS`
import paths match the confirmed exports. Test count "+4" matches the 4
`it()` blocks written.
