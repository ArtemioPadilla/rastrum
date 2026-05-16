# Audit Fixes Implementation Plan (#1070–#1083)

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land minimal, tested fixes (or honest diagnoses) for the 14 production-audit issues across 5 thematic worktree/PR groups.

**Architecture:** One worktree per group under `.worktrees/`, branched from up-to-date `main`. One atomic commit per issue. Diagnostic spikes (#1071/#1072/#1076) run read-only first and gate on user approval. Each issue task is a scoped subagent brief: read → reproduce → minimal fix → TDD → verify → commit.

**Tech Stack:** Astro + TypeScript + Tailwind, Supabase (Postgres/RLS/Edge Functions Deno), Vitest, Playwright. Spec: `docs/superpowers/specs/2026-05-15-audit-fixes-implementation-design.md`.

---

## Global preconditions (run once, before any group)

- [ ] **P1: Sync main**

Run: `git -C /Users/artemiopadilla/Documents/repos/GitHub/personal/rastrum checkout main && git pull --ff-only`
Expected: `Already up to date.` or fast-forward.

- [ ] **P2: Confirm protected worktrees untouched**

Run: `git worktree list`
Expected: `.worktrees/fix-1025-places` and `.worktrees/fix-1026-lint-test` present. **Never** `cd` into or modify these.

**Worktree creation pattern (per group G):**
```bash
git worktree add .worktrees/<name> -b <branch> main
cd .worktrees/<name>
# node_modules is a symlink — NEVER `git add -A` / `git add .`. Stage explicit files only.
```
**Verification before every commit (run in the group worktree):**
```bash
npm run typecheck && npm run test && npm run build
```
Paste real tail output. No green → no commit. Never `--no-verify`.
**Commit message footer (every commit):** `Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>`

---

## Group G1 — Frontend fixes → branch `fix/audit-frontend`, worktree `.worktrees/audit-frontend`

Issues: #1070, #1073, #1074, #1075, #1077, #1080, #1081. One atomic commit each, one PR. Run #1070 then #1077 sequentially (both touch Explore area); others parallel.

### Task G1.1 — #1070 Lugares/Places `ReferenceError: lang is not defined`

**Files:**
- Read: `src/components/ExplorePlacesView.astro` (client `<script>`; the bundled artifact is `ExplorePlacesView.astro_astro_type_script_index_0_lang.*.js`)
- Test: `tests/unit/` (add) or `tests/e2e/` smoke as appropriate

- [ ] **Step 1:** Read `src/components/ExplorePlacesView.astro` end to end. Find where the client script references `lang` and how it's provided (look for `define:vars`, `is:inline`, or an out-of-scope `lang`). Confirm the symptom matches the CLAUDE.md 2026-05-09 pitfall and memory `reference_astro_define_vars_breaks_bundling`.
- [ ] **Step 2:** Reproduce locally: `npm run build` then serve `dist/` (or `npm run dev`), open `/es/explorar/lugares/`, confirm console `ReferenceError: lang is not defined`.
- [ ] **Step 3:** Apply the minimal fix per the documented pattern: remove `define:vars` (drops implicit `is:inline=true`) and read locale from the DOM (`document.documentElement.lang`) or a `data-lang` attribute on a wrapper element — mirror how other fixed components do it (see PRs #825 pattern referenced in CLAUDE.md; grep `document.documentElement.lang` in `src/components` for the established idiom).
- [ ] **Step 4:** Add a regression guard consistent with `scripts/check-define-vars-imports.sh` scope, OR an e2e assertion in `tests/e2e/` that `/es/explorar/lugares/` and `/en/explore/places/` render place results with no console error. Use the lightest test that pins the regression (prefer the existing CI guard if it already covers this; if so, note why no new test).
- [ ] **Step 5:** Verify: `npm run build` then load both `/es/explorar/lugares/` and `/en/explore/places/` — places load, console clean. Run `npm run typecheck && npm run test`.
- [ ] **Step 6:** Commit:
```bash
git add src/components/ExplorePlacesView.astro <test-file-if-any>
git commit -m "fix(explore): ExplorePlacesView reads lang from DOM, not define:vars (#1070)

ReferenceError: lang is not defined killed /explorar/lugares & /explore/places
in prod (both locales). define:vars -> implicit is:inline -> unbundled scope.

Closes #1070

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task G1.2 — #1077 duplicate "Lugares" tile on Explore index

**Files:**
- Read/Modify: `src/components/ExploreIndexView.astro` (the two tiles both linking `/…/lugares/`)

- [ ] **Step 1:** Read `src/components/ExploreIndexView.astro`. Locate the two entries that both render title "Lugares" → `/{lang}/explorar/lugares/`. Determine which is the intended one (compare descriptions; the duplicate likely came from an M28 community vs ANP merge).
- [ ] **Step 2:** Remove the redundant tile (or repoint/rename it if it was meant to be a distinct destination — decide from surrounding code + i18n keys; do not invent a new route). Keep EN/ES parity (shared view → both locales fixed at once).
- [ ] **Step 3:** Verify: `npm run build`, load `/es/explorar/` and `/en/explore/` — exactly one "Lugares" tile.
- [ ] **Step 4:** `npm run typecheck && npm run test && npm run build`.
- [ ] **Step 5:** Commit:
```bash
git add src/components/ExploreIndexView.astro
git commit -m "fix(explore): de-duplicate Lugares tile on Explore index (#1077)

Closes #1077

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

### Task G1.3 — #1073 "observed today" boundary uses UTC midnight not local

**Files:**
- Read: `src/lib/home-loaders.ts` (and any helper it calls building the `observed_at=gte` filter); cross-check `src/lib/karma.ts` / streak helpers for the canonical local-day helper.

- [ ] **Step 1:** In `src/lib/home-loaders.ts` find the query building `observations?…observed_at=gte.<ts>`. Confirm it derives the boundary from UTC midnight (`Date.UTC(...)` / `toISOString()` of UTC day) rather than local start-of-day.
- [ ] **Step 2:** Identify the established local-day helper used by daily caps / `todayKey()` (CLAUDE.md TZ-determinism note says user-facing daily surfaces use local). Reuse it; do not hand-roll a second boundary.
- [ ] **Step 3:** Write a Vitest unit (the suite pins `TZ=UTC` via `vitest.config.ts`) asserting the boundary helper returns the **local** start-of-day ISO for a representative non-UTC offset, distinct from UTC midnight. Run it; expect FAIL.
- [ ] **Step 4:** Change the home-loader to use the local-day helper. Run the test; expect PASS.
- [ ] **Step 5:** `npm run typecheck && npm run test && npm run build`.
- [ ] **Step 6:** Commit `fix(home): observed-today boundary uses user-local day, not UTC midnight (#1073)` + Closes #1073 + footer.

### Task G1.4 — #1074 "Ver observación" → "Observation not found" until sync

**Files:**
- Read: the observe success screen (grep `obs_detail`/"Ver observación"/"view observation" in `src/components/ObserveView2.astro` and `src/i18n/{en,es}.json`); `src/components/ShareObsView.astro` (the "Observation not found" path).

- [ ] **Step 1:** Locate the success-screen "Ver observación" CTA and how it builds the `/share/obs/?id=` link immediately after save while the outbox item is still `pending` (not yet in Supabase).
- [ ] **Step 2:** Choose the minimal fix consistent with existing patterns: either (a) gate/disable the CTA until the outbox item syncs (listen for the existing sync-complete signal used by the SyncPill/"+karma synced" toast), or (b) have `ShareObsView` fall back to the local Dexie outbox record and show a "syncing…" state that auto-resolves on sync. Prefer (a) if a sync-complete event already exists; confirm by reading `src/lib/sync.ts` / SyncPill.
- [ ] **Step 3:** Add a focused test for the chosen behavior (unit on the gate logic, or an e2e that asserts the CTA is not a dead link pre-sync). Keep it minimal per `docs/qa-policy.md`.
- [ ] **Step 4:** Manual verify: create an observation, confirm the CTA no longer lands on "Observation not found" before sync.
- [ ] **Step 5:** `npm run typecheck && npm run test && npm run build`. Commit `fix(observe): success CTA no longer dead-links before outbox sync (#1074)` + Closes #1074 + footer.

### Task G1.5 — #1075 broken observation thumbnails on list/grid cards

**Files:**
- Read: `src/components/ExploreSpeciesView.astro`, `src/components/DiscoverFeedView.astro`, `src/lib/home-loaders.ts` (home "Ve a buscar"/"Cerca de ti" + recientes list + especies grid all showed empty boxes; share/obs gallery is fine).

- [ ] **Step 1 (diagnose):** Compare the working `share/obs` gallery image URL construction vs the broken card components. Determine the difference: a thumbnail-variant URL that 404s, a missing/empty `src`/`srcset`, a CSS sizing collapse, or a lazy-load that never triggers. Use the audit network note (some `media.rastrum.org/...` objects are extension-less but return 200).
- [ ] **Step 2:** Reproduce locally and confirm the exact failing attribute for one card.
- [ ] **Step 3:** Apply the minimal fix shared by the affected card path(s) (single helper if they share one). Keep below-fold `loading="lazy"` per CLAUDE.md.
- [ ] **Step 4:** Add a unit test on the image-URL/`srcset` helper if one exists; otherwise an e2e asserting card `<img>` has a non-empty resolvable `src` on `/es/explorar/recientes/?view=list`.
- [ ] **Step 5:** Verify visually + `npm run typecheck && npm run test && npm run build`. Commit `fix(ui): observation card thumbnails resolve on list/grid surfaces (#1075)` + Closes #1075 + footer.

### Task G1.6 — #1080 PWA manifest start_url hardcoded `/en/`

**Files:**
- Read: `public/manifest.webmanifest`; check how `/` (root) is handled (redirect to locale?) in `astro.config.*` / `src/pages/index.astro` / middleware.

- [ ] **Step 1:** Inspect `public/manifest.webmanifest` (`"start_url": "/en/"`). Determine the correct minimal fix: a single static manifest can't be per-locale. Options: set `start_url` to a language-neutral route that already redirects by stored/Accept-Language (verify such a route exists at `/`), or `start_url: "/"` if root performs locale redirect, or `"."`/scope-relative. Pick the option backed by existing routing — confirm by reading the root route handler. Do not introduce a new redirect mechanism if one exists.
- [ ] **Step 2:** Apply the change; ensure `scope`/`id` remain valid.
- [ ] **Step 3:** Verify: `npm run build`, install/inspect manifest, confirm launching resolves to the user's locale (or neutral redirect).
- [ ] **Step 4:** `npm run typecheck && npm run test && npm run build`. Commit `fix(pwa): manifest start_url no longer hardcodes /en/ (#1080)` + Closes #1080 + footer.

### Task G1.7 — #1081 map basemap inconsistency

**Files:**
- Read: `src/components/ExploreMap.astro` (dark PMTiles) vs the community/share map components (OSM raster) — grep the map style/source config.

- [ ] **Step 1:** Identify the basemap style/source each map uses. Determine whether the community/share maps fall back to OSM raster because the PMTiles style/source isn't wired (vs. intentional).
- [ ] **Step 2:** If unintentional: apply the PMTiles style to the community/share maps consistently with `ExploreMap.astro`, reusing the existing style/source helper (don't duplicate config). If a deliberate reason exists in code/comments, instead document it and reduce scope to a code comment + close as wontfix-with-rationale (post to issue).
- [ ] **Step 3:** Verify both maps render the chosen consistent style; `npm run typecheck && npm run test && npm run build`.
- [ ] **Step 4:** Commit `fix(maps): consistent basemap across explore/community/share (#1081)` + Closes #1081 + footer.

### Task G1.8 — G1 integration

- [ ] Ensure 7 atomic commits on `fix/audit-frontend` (one per issue; #1070 before #1077). Final `npm run typecheck && npm run test && npm run build` on the branch tip — paste output.
- [ ] Open one PR (base `main`, head `fix/audit-frontend`) titled `fix(audit): frontend findings #1070,#1073,#1074,#1075,#1077,#1080,#1081`. Body lists each commit→issue and ends with the 🤖 footer. Do **not** merge.

---

## Group G2 — Copy/i18n/docs → branch `fix/audit-copy`

Issues: #1078, #1079, #1083. One subagent, three atomic commits, one small PR.

### Task G2.1 — #1078 "<1 kmaún no en tu dex" missing separator

**Files:**
- Modify: `src/components/ContextualSpeciesChips.astro` (lines ~49 and ~318 join distance + `not_in_dex` with no separator). i18n keys: `src/i18n/es.json:768` / EN equivalent.

- [ ] **Step 1:** Read `ContextualSpeciesChips.astro:40-60` and `:310-325`. Find where distance string (`<1 km`) and the `not_in_dex` label are concatenated.
- [ ] **Step 2:** Insert a separator (` · ` consistent with other chip separators in the codebase — grep for the existing distance/badge separator pattern; match it). Apply at both sites and for EN+ES.
- [ ] **Step 3:** Build, view Observe nearby-species card → renders `<1 km · aún no en tu dex`.
- [ ] **Step 4:** `npm run typecheck && npm run test && npm run build`. Commit `fix(i18n): separator between distance and dex badge in species chips (#1078)` + Closes #1078 + footer.

### Task G2.2 — #1079 Pokédex empty-state copy wrong when user has observations

**Files:**
- Modify: `src/i18n/es.json:2319` (`dex…empty`) + EN equivalent; check the consuming component to confirm which key fires for the signed-in-but-no-confirmed-species case (vs `visitor_empty` at :2333).

- [ ] **Step 1:** Read the dex view component to confirm `empty` is shown to a signed-in user who has observations but no confirmed species (not "no observations").
- [ ] **Step 2:** Rewrite the `empty` string (ES + EN) to reflect "no confirmed species yet — your observations need community verification" without implying the user hasn't observed. Keep tone consistent with neighboring strings. If the component actually has two states, only fix the misused one; if it conflates them, add the distinction minimally.
- [ ] **Step 3:** Build, view `/es/perfil/dex/` as the audited user → accurate copy. EN parity check.
- [ ] **Step 4:** `npm run typecheck && npm run test && npm run build`. Commit `fix(i18n): accurate Pokédex empty-state for users with unconfirmed obs (#1079)` + Closes #1079 + footer.

### Task G2.3 — #1083 CLAUDE.md M28 path stale

**Files:**
- Modify: `CLAUDE.md` (M28 "Community discovery" section: `{community,comunidad}/observers/` → real slugs).

- [ ] **Step 1:** `grep -n "observers/" CLAUDE.md` — find the M28 path examples.
- [ ] **Step 2:** Update to the real production routes: `/es/comunidad/observadores/`, `/es/comunidad/tabla-de-lideres/`, `/es/comunidad/mapa/` (and EN equivalents `/en/community/observers/` — verify the EN slug by checking `src/i18n/utils.ts` `routes`/`routeTree`; use the actual slug pair, don't guess).
- [ ] **Step 3:** Commit `docs(claude-md): correct M28 community route slugs (#1083)` + Closes #1083 + footer. (No build needed — doc only; still run `npm run typecheck` to be safe.)

### Task G2.4 — G2 integration

- [ ] 3 commits on `fix/audit-copy`. `npm run typecheck && npm run test && npm run build` green.
- [ ] One PR `fix(audit): copy/i18n/docs #1078,#1079,#1083`, 🤖 footer. Do not merge.

---

## Group G3 — #1071 schema/RLS (DIAGNOSE → APPROVE → IMPLEMENT)

### Task G3.1 — #1071 diagnostic spike (READ-ONLY, no branch)

**Files (read only):** `supabase/functions/admin/index.ts`, `supabase/functions/admin/handlers/` (the `role.grant` handler), `docs/specs/infra/supabase-schema.sql` (GRANTs on `public.users`, RLS on `users`, the `has_role`/role-grant SECURITY DEFINER path), commit `d122b29` ("blanket GRANT to service_role").

- [ ] **Step 1:** Trace the dispatcher path for action `role.grant`: which DB role executes the INSERT into `users` (or `user_roles`?), and why `permission denied for table users` (the audit error). Identify whether it's a missing GRANT, a SECURITY DEFINER wrapper running as the wrong owner, or an RLS policy.
- [ ] **Step 2:** Draft the **minimal idempotent** schema/handler change (e.g., route the write through a SECURITY DEFINER function with proper search_path + explicit REVOKE/GRANT, or correct the GRANT) consistent with the CLAUDE.md schema-security invariants.
- [ ] **Step 3:** **STOP. Post the diagnosis + exact proposed diff to issue #1071 and present it to the user. Do not create a branch, apply schema, or open a PR until the user approves the specific diff.**

### Task G3.2 — #1071 implement (ONLY after explicit user approval)

- [ ] Create `.worktrees/fix-1071` / branch `fix/1071-role-grant`. Apply the approved diff to `docs/specs/infra/supabase-schema.sql` (idempotent) and/or the handler. Add pgTAP/RLS test if the existing suite covers role grants.
- [ ] Verify locally per CLAUDE.md schema flow (the `db-validate` gate will re-check on PR). `npm run typecheck && npm run test`.
- [ ] One PR `fix(admin): role.grant write no longer permission-denied on users (#1071)`, Closes #1071, 🤖 footer. Do not apply to prod / do not merge.

---

## Group G4 — #1082 Edge Function → branch `fix/1082-report-resolve`

### Task G4.1 — #1082 `report.resolve` handles missing target

**Files:**
- Read/Modify: `supabase/functions/admin/handlers/report-resolve.ts`
- Test: existing admin handler test location (grep `report-resolve` tests under `supabase/functions/` or `tests/`).

- [ ] **Step 1:** Read `report-resolve.ts`. Find where it throws when the report's target no longer exists ("report.resolve: target not found" in the function_errors sink).
- [ ] **Step 2:** Change so a missing target is a **handled outcome**: resolve/close the report gracefully (mark resolved with a "target gone" reason, still write the `admin_audit` row) instead of throwing an unhandled `handler_exception`.
- [ ] **Step 3:** Add/extend a unit test: resolving a report whose target is absent returns success + audit row, no throw. Run it (FAIL → PASS).
- [ ] **Step 4:** `npm run typecheck && npm run test`. **Do not deploy** (deploys are deliberate via `workflow_dispatch`; note in PR that deploy is manual).
- [ ] **Step 5:** Commit + PR `fix(admin): report.resolve treats missing target as handled (#1082)`, Closes #1082, 🤖 footer. Do not merge/deploy.

---

## Group G5 — Spikes #1072, #1076 (DIAGNOSE → fix-if-clean)

### Task G5.1 — #1072 home 503 on observed-today HEAD

- [ ] **Step 1 (read-only):** From `src/lib/home-loaders.ts`, identify the exact `HEAD observations?select=id…observed_at=gte` request and its `Prefer: count=…` header. Hypothesize why it 503s (RLS-heavy count HEAD statement timeout / pooler) while sibling 200 queries differ.
- [ ] **Step 2:** Determine if a clean client fix exists: e.g., replace the count HEAD with a lightweight `select=id&limit=1` existence check (no `count`), which also composes with the #1073 boundary fix. Confirm this removes the 503 against prod-like data.
- [ ] **Step 3:** If a clean code fix: implement on branch `fix/1072-observed-today-503` (or fold into G1 since it's the same `home-loaders.ts` as #1073 — prefer folding to avoid CI-coupled split), with a test asserting the existence-check query shape (no `count` header). Verify. Commit `fix(home): observed-today uses existence check, not count HEAD (#1072)` + Closes #1072 + footer.
- [ ] **Step 4:** If root cause is Supabase infra (statement timeout unrelated to query shape): post the analysis + recommended Supabase-side action to issue #1072; do **not** fake a code fix. Report outcome to user.

### Task G5.2 — #1076 gotrue lock 5000ms + user_roles fan-out

- [ ] **Step 1 (read-only):** Identify every caller of `getUserRoles`/session that fires the duplicate `user_roles?select=role,revoked_at` (Header, BellIcon, ConsoleLayout pill hydrate, MobileDrawer) and the cached-helper introduced in #1064/#1065. Determine why duplicates still fire and the orphaned-lock source (component unmount path).
- [ ] **Step 2:** If a clean fix exists (e.g., route remaining callers through the existing cached helper / dedupe in-flight promise / release lock on unmount): implement on branch `fix/1076-auth-fanout`, with a test asserting a single roles fetch per load (or the dedupe helper returns the shared promise). Verify. Commit `fix(auth): dedupe user_roles fan-out + release auth lock on unmount (#1076)` + Closes #1076 + footer.
- [ ] **Step 3:** If too subtle / risks the #1064 regression: post precise analysis (call sites, lock source, why duplicates persist) to issue #1076; no speculative patch. Report to user.

---

## Self-review notes

- **Spec coverage:** every spec bucket maps to a task group (G1–G5); all 14 issues have a task. #1070/#1077 sequenced. #1071 gated. #1072 explicitly may fold into G1 (same file as #1073) to avoid CI-coupled split — consistent with the spec's CI-coupling constraint.
- **Placeholders:** diagnostic-then-fix tasks (#1071/#1072/#1075/#1076/#1081) intentionally specify "read file X:lines, apply minimal pattern-consistent change" rather than literal diffs, because the exact patch requires reading current source; each such task names exact files, the reproduction, the decision criterion, the test shape, and the verification commands — this is the correct fidelity for a bug-fix sweep, not a placeholder.
- **Consistency:** verification command (`npm run typecheck && npm run test && npm run build`), commit footer, and "no merge/deploy" rule are uniform across tasks.
- **Naming:** branches `fix/audit-frontend`, `fix/audit-copy`, `fix/1071-role-grant`, `fix/1082-report-resolve`, `fix/1072-*`, `fix/1076-*`; worktrees mirror under `.worktrees/`.
