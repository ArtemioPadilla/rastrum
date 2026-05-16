# Journey Catalog — design

> A CI-enforced, provably-complete catalog of every Rastrum route +
> the end-to-end journeys over them, so manual Chrome / e2e sweeps can
> be checked against a list that cannot silently rot.

**Status:** approved 2026-05-16. Supersedes the *completeness* role of
the dated `docs/journey-audit-2026-05-15.md` (which remains the
immutable point-in-time audit record).

---

## Problem

`journey-audit-2026-05-15.md` is a dated snapshot whose coverage matrix
was *reconstructed from issues*, not derived from the route manifest.
It silently went stale (PR #1103 squash-merged at its first commit; two
follow-up commits never reached main) and is not provably exhaustive —
there is nothing that forces it to list every route. A sweep run from
it can only be as complete as a hand-maintained list. We need a catalog
whose completeness is **mechanically enforced** against the actual
route sources of truth.

## Sources of truth (the spine)

1. `src/i18n/utils.ts` → `export const routes: Record<string, Record<Locale,string>>`
   — the public + signed-in route manifest (~41 keys, e.g. `home`,
   `exploreMap`, `profileExport`, `signIn`).
2. `src/lib/console-tabs.ts` → `export const CONSOLE_TABS: ConsoleTab[]`
   — each tab carries `routeKey`, `role`, `i18nKey` (41 console
   routeKeys).

The catalog's required key set is exactly
`Object.keys(routes) ∪ CONSOLE_TABS.map(t => t.routeKey)`. Some console
`routeKey`s also appear in `routes`; the union de-dupes them, so a
console route that is also in `routes` is **one** catalog row, not two.

## Components

### Component 1 — `docs/journey-catalog.md` (new living doc)

**§1 Route spine table.** One row per key in the required set. The
entire spine table (and only it) is wrapped in HTML-comment fences so
the test parser can scope itself and ignore any other markdown table in
the doc:

```
<!-- spine:start -->
| `routeKey` | EN path | ES path | Auth | R/W | Spec | Verified | Issues |
| --- | --- | --- | --- | --- | --- | --- | --- |
| `home` | / | / | anon | R | journey-guest-browse.spec.ts | 2026-05-16 |  |
| … one row per required key … |
<!-- spine:end -->
```

Strict, machine-parseable row format — the first cell is the route key
wrapped in backticks and nothing else.

- **Auth**: one of `anon`, `authed`, `role:admin`, `role:moderator`,
  `role:expert` (console rows take their `role` from `CONSOLE_TABS`).
- **R/W**: `R` (read-only surface) or `R+W` (has write affordances) —
  drives whether a sweep may exercise it read-only.
- **Spec**: the covering `tests/e2e/journey-*.spec.ts` filename, or `—`
  if none.
- **Verified**: `YYYY-MM-DD` of the last *real Chrome* verification, or
  the literal `never`. Honest by construction — unswept routes say
  `never`, not a hopeful date.
- **Issues**: open/closed `#refs` affecting that route, or blank.

**§2 Journey-flow overlay.** Named end-to-end flows as an ordered
`routeKey` sequence → the `journey-*.spec.ts` that guards the flow.
Initial set (extend as the product grows): `guest-browse`,
`first-observation`, `identify-cascade`, `share-observation`,
`watchlist`, `social-engage`, `projects-camera`, `researcher-export`,
`moderation-triage`, `falta-dex`, `auth-magic-link`, `auth-passkey`,
`onboarding`, `offline-pwa`, `mobile-chrome`, `chat-ask-rastrum`.
Human-curated; **not** drift-checked (every route is already provably
present via §1 — the overlay is a reading aid that groups them).

**§3 Sweep procedure.** The read-only Chrome method: signed-in, walk
the §1 table top-to-bottom, per route capture console errors
(`read_console_messages` with an error pattern) + network requests
(media/5xx), screenshot the visual ones. On a clean route, bump its
`Verified` cell to the sweep date in the same PR. Cross-links to
`journey-audit-2026-05-15.md` (historical provenance) and
`qa-policy.md` (CI policy).

### Component 2 — `tests/unit/journey-catalog-complete.test.ts`

Mirrors `tests/unit/dynamic-routes-parity.test.ts` (vitest, `node:fs`,
`REPO_ROOT = resolve(__dirname, '..', '..')`).

1. Read `docs/journey-catalog.md`. Extract the §1 spine route keys with
   a strict regex: a catalog key line matches
   `^\|\s*\`([A-Za-z][A-Za-z0-9]*)\`\s*\|` between the `<!-- spine:start -->`
   and `<!-- spine:end -->` HTML-comment fences (the fences scope the
   parser so prose tables elsewhere can't be misread).
2. Import `routes` from `src/i18n/utils.ts` and `CONSOLE_TABS` from
   `src/lib/console-tabs.ts`. Compute `required = new Set([...Object.keys(routes), ...CONSOLE_TABS.map(t => t.routeKey)])`.
3. Assert `catalogKeys` (as a Set) **equals** `required`:
   - `required \ catalog` → fail: "Journey catalog missing routes: …"
   - `catalog \ required` → fail: "Journey catalog has stale/unknown
     routes (removed from manifest?): …"
4. Assert no duplicate key rows in the spine.
5. Assert every `Verified` cell is either `never` or matches
   `^\d{4}-\d{2}-\d{2}$` (guards against freeform/aspirational text).

Any new or removed route now turns this required CI check red until the
catalog row is added/removed — the rot mode that bit
`journey-audit-2026-05-15.md` becomes impossible.

### Component 3 — initial population (honest)

Generate the spine once from `routes` + `CONSOLE_TABS`. Fill columns:

- Routes Chrome-swept on **2026-05-16** (per the §8 sweep that this
  work follows): `Verified = 2026-05-16`.
- Everything not swept that day (onboarding, offline/PWA,
  mobile-chrome, social *write* actions, auth flows, sponsor/expert
  surfaces, dynamic detail pages, etc.): `Verified = never`. Truthful,
  not aspirational.
- `Spec` filled by matching existing `tests/e2e/journey-*.spec.ts` to
  routes; `—` where none.
- `Issues`: attach `#1112` (consoleObservations), `#1113` (exploreMap)
  and any other open route-scoped refs.

## Non-goals

- Not a generator — the doc is the human-curated source; the test only
  enforces *completeness of the spine*, not the metadata values.
- The journey-flow overlay (§2) is not drift-checked.
- No new runtime/route code; no schema/RLS/Edge-Function changes. This
  is docs + one unit test.

## Testing

- `tests/unit/journey-catalog-complete.test.ts` is the feature's own
  test (it *is* the enforcement).
- Add a deliberately-missing-row and a deliberately-extra-row case in
  the test file's own fixtures? No — the test runs against the real
  committed catalog; its correctness is validated by: (a) it passes
  with the fully-populated catalog, (b) a temporary local edit removing
  one row makes it fail with the right message (verified during
  implementation, not committed).
- Full suite (`npm run test`) must stay green; `npm run build` and
  `npx tsc --noEmit` unaffected (docs + test only).

## Rollout

1. Add `docs/journey-catalog.md` fully populated from the manifest.
2. Add `tests/unit/journey-catalog-complete.test.ts`; confirm green.
3. Cross-link from `qa-policy.md` and from
   `journey-audit-2026-05-15.md` (a forward pointer: "living catalog
   supersedes this snapshot's completeness role").
4. One PR. The test becomes a normal required check via the existing
   `test` job (no branch-protection change needed — it's just another
   vitest file).

## Success criteria

- Every `routes` key and every `CONSOLE_TABS.routeKey` has exactly one
  catalog spine row; CI fails otherwise.
- A future sweep updates only `Verified`/`Issues` cells; adding a route
  without cataloging it is impossible to merge.
- `journey-audit-2026-05-15.md` remains valid as a dated record and now
  points forward to the catalog.
