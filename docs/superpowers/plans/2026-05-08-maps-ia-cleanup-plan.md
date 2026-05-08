# Maps IA cleanup — implementation plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Disambiguate the two "Map" entries in the header MegaMenu by renaming them to "Observations map" / "Observers map" and adding a thin cross-link banner above each MapLibre canvas. Plus file the D' (unified map) future-work issue.

**Architecture:** i18n-only label changes (no URL changes, no routing). Two Astro components (`ExploreMap.astro`, `CommunityMapView.astro`) get a small banner element above their `<h1>`. Spec lives at `docs/superpowers/specs/2026-05-08-maps-ia-cleanup-design.md`.

**Tech Stack:** Astro 5, TypeScript, Tailwind, vitest. No new dependencies.

---

## Pre-work: branch + spec discoverability

The brainstorming session committed the spec doc on `feat/taxa-enrichment-and-tree`. The implementation should land on its own branch off `main`.

### Task 0: Create the implementation branch

**Files:** none (git plumbing).

- [ ] **Step 1: Verify clean working tree**

Run:
```bash
git status -s
```
Expected: only `package-lock.json` modified (pre-existing).

- [ ] **Step 2: Switch to main and pull**

Run:
```bash
git checkout main && git pull --ff-only origin main
```
Expected: `Already up to date.` or fast-forward.

- [ ] **Step 3: Cut the new branch**

Run:
```bash
git checkout -b fix/maps-ia-rename
```

- [ ] **Step 4: Cherry-pick the spec doc commit from the brainstorming branch**

The spec is on `feat/taxa-enrichment-and-tree` as commit `5659743`. Cherry-pick into this branch so the PR carries its own spec:

Run:
```bash
git cherry-pick 5659743
```
Expected: clean cherry-pick — the spec is a single new file with no conflicts.

If the SHA has drifted, find it with:
```bash
git log feat/taxa-enrichment-and-tree --oneline | grep -i "maps IA cleanup design"
```

---

## Task 1: Add i18n keys for new labels + cross-link copy

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

Per the spec § "B — design", four edit sites in each file: `nav.explore_dropdown.map`, `nav.explore_megamenu.community_map`, `map.title`, `community.map_title`. Plus two new sub-keys for the cross-link banner copy.

- [ ] **Step 1: Locate the keys in `en.json`**

Run:
```bash
grep -n '"map":\|"community_map":\|"map_title":' src/i18n/en.json
```
Expected: lines around 11, 17, 30, 427, 1049 — the keys to update + parents.

- [ ] **Step 2: Update labels + page titles in `en.json`**

Make these exact edits in `src/i18n/en.json` (use the Edit tool, one block per change since the literal strings are short and similar):

`nav.explore_dropdown.map`:
```diff
-      "map": "Map",
+      "map": "Observations map",
```

`nav.explore_megamenu.community_map`:
```diff
-      "community_map": "Map",
+      "community_map": "Observers map",
```

`map.title`:
```diff
   "map": {
-    "title": "Map",
+    "title": "Observations map",
```

`community.map_title`:
```diff
-    "map_title": "Community Map",
+    "map_title": "Observers map",
```

- [ ] **Step 3: Add cross-link copy to `en.json`**

Add a new `cross_link` sub-object inside `map` (parallel to the existing `loading`, `title` keys):

```diff
   "map": {
     "title": "Observations map",
     "loading": "Loading map…",
+    "cross_link": {
+      "prompt": "Looking for observers near you?",
+      "cta": "See Observers map →"
+    },
```

(Place it after `loading` and before whatever comes next; preserve existing trailing comma on `loading` if needed.)

Add a parallel block inside `community`:

```diff
   "community": {
     "map_title": "Observers map",
     "map_subtitle": "Observer activity across Latin America",
+    "cross_link": {
+      "prompt": "Looking for biodiversity observations?",
+      "cta": "See Observations map →"
+    },
```

- [ ] **Step 4: Repeat in `es.json` with Spanish copy**

Same key surgery in `src/i18n/es.json`:

```diff
-      "map": "Mapa",
+      "map": "Mapa de observaciones",
```

```diff
-      "community_map": "Mapa",
+      "community_map": "Mapa de observadores",
```

```diff
   "map": {
-    "title": "Mapa",
+    "title": "Mapa de observaciones",
```

```diff
-    "map_title": "Mapa de la comunidad",
+    "map_title": "Mapa de observadores",
```

Add the `cross_link` blocks (Spanish copy):

```diff
   "map": {
     "title": "Mapa de observaciones",
     "loading": "Cargando mapa…",
+    "cross_link": {
+      "prompt": "¿Buscas observadores cerca de ti?",
+      "cta": "Ver Mapa de observadores →"
+    },
```

```diff
   "community": {
     "map_title": "Mapa de observadores",
     "map_subtitle": "Actividad de observadores por América Latina",
+    "cross_link": {
+      "prompt": "¿Buscas observaciones de biodiversidad?",
+      "cta": "Ver Mapa de observaciones →"
+    },
```

> Verify the actual ES values for `map.loading` / `community.map_subtitle` before editing — they may have slightly different copy. Edit defensively by anchoring on unique surrounding context.

- [ ] **Step 5: Verify JSON is valid + build picks up new keys**

Run:
```bash
node -e "JSON.parse(require('fs').readFileSync('src/i18n/en.json','utf8')); JSON.parse(require('fs').readFileSync('src/i18n/es.json','utf8')); console.log('OK')"
```
Expected: `OK`. If parse fails, JSON has trailing comma or missing brace.

- [ ] **Step 6: Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "$(cat <<'EOF'
i18n: rename Map → Observations/Observers map + cross-link copy

Removes the duplicate "Map" entries in the header MegaMenu by giving
each map page a distinct label. Adds cross-link banner copy used by
the next commit.

Per docs/superpowers/specs/2026-05-08-maps-ia-cleanup-design.md.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 2: i18n parity test for the new keys

A small regression guard so that future edits don't drop the cross-link copy from one locale.

**Files:**
- Create: `tests/unit/maps-ia-i18n.test.ts`

- [ ] **Step 1: Write the failing test**

Create `tests/unit/maps-ia-i18n.test.ts`:

```typescript
import { describe, it, expect } from 'vitest';
import en from '../../src/i18n/en.json';
import es from '../../src/i18n/es.json';

describe('maps IA cleanup — i18n parity', () => {
  type Maybe = Record<string, unknown> | undefined;

  function get(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) =>
      (acc as Maybe)?.[key], obj);
  }

  const requiredKeys = [
    'nav.explore_dropdown.map',
    'nav.explore_megamenu.community_map',
    'map.title',
    'map.cross_link.prompt',
    'map.cross_link.cta',
    'community.map_title',
    'community.cross_link.prompt',
    'community.cross_link.cta',
  ];

  for (const key of requiredKeys) {
    it(`EN has ${key} populated`, () => {
      const v = get(en, key);
      expect(typeof v).toBe('string');
      expect((v as string).trim().length).toBeGreaterThan(0);
    });
    it(`ES has ${key} populated`, () => {
      const v = get(es, key);
      expect(typeof v).toBe('string');
      expect((v as string).trim().length).toBeGreaterThan(0);
    });
  }

  it('EN map labels are no longer the bare "Map"', () => {
    expect(get(en, 'nav.explore_dropdown.map')).not.toBe('Map');
    expect(get(en, 'nav.explore_megamenu.community_map')).not.toBe('Map');
    expect(get(en, 'map.title')).not.toBe('Map');
  });

  it('ES map labels are no longer the bare "Mapa"', () => {
    expect(get(es, 'nav.explore_dropdown.map')).not.toBe('Mapa');
    expect(get(es, 'nav.explore_megamenu.community_map')).not.toBe('Mapa');
    expect(get(es, 'map.title')).not.toBe('Mapa');
  });
});
```

- [ ] **Step 2: Run the test to confirm it passes (Task 1 already added the keys)**

Run:
```bash
npx vitest run tests/unit/maps-ia-i18n.test.ts
```
Expected: 18 tests pass (8 keys × 2 locales + 2 negative-assertion tests).

If any test fails, the i18n edits in Task 1 have a typo or missing key — go fix the JSON.

- [ ] **Step 3: Commit**

```bash
git add tests/unit/maps-ia-i18n.test.ts
git commit -m "$(cat <<'EOF'
test: i18n parity for renamed map keys

Locks in the new key shape (cross_link sub-object on both `map` and
`community`) so future edits can't silently drop one locale.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 3: Add cross-link banner to ExploreMap.astro

**Files:**
- Modify: `src/components/ExploreMap.astro`

- [ ] **Step 1: Read the current frontmatter + h1 region**

Run:
```bash
sed -n '1,20p' src/components/ExploreMap.astro
```
Expected: imports `t` from `../i18n/utils`, `<h1>{tr.map.title}</h1>` on line ~13.

- [ ] **Step 2: Add `routes` + `getLocalizedPath` to the import**

Edit line 2:
```diff
-import { t } from '../i18n/utils';
+import { t, getLocalizedPath, routes } from '../i18n/utils';
```

- [ ] **Step 3: Compute the cross-link href in the frontmatter**

Add after the existing `const tr = t(lang);` line:

```typescript
const locale = lang === 'es' ? 'es' : 'en';
const observersMapHref = getLocalizedPath(lang, routes.communityMap[locale] + '/');
```

- [ ] **Step 4: Insert the cross-link banner below the `<h1>`**

Replace the lines from `<h1>` through the loading paragraph:

```diff
   <h1 class="text-2xl font-bold tracking-tight mb-2">{tr.map.title}</h1>
+  <p class="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
+    {tr.map.cross_link.prompt}{' '}
+    <a href={observersMapHref} class="text-emerald-600 dark:text-emerald-400 hover:underline">
+      {tr.map.cross_link.cta}
+    </a>
+  </p>
   <p class="text-sm text-zinc-500 mb-4" id="map-status">{tr.map.loading}</p>
```

- [ ] **Step 5: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: clean. If `tr.map.cross_link` is unknown, the typed i18n shape is wrong — go check `src/i18n/utils.ts` for the type definition and verify Task 1's JSON edits parse the same shape.

- [ ] **Step 6: Build**

Run:
```bash
npm run build 2>&1 | tail -8
```
Expected: 231 pages built; no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/ExploreMap.astro
git commit -m "$(cat <<'EOF'
feat(map): cross-link banner on /explore/map/ to observers map

Thin one-line banner above the canvas pointing to /community/map/ for
users who want observer activity instead of biodiversity records.
Muted zinc text, emerald link — informational, not promotional.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 4: Add cross-link banner to CommunityMapView.astro

**Files:**
- Modify: `src/components/CommunityMapView.astro`

- [ ] **Step 1: Find the `<h1>` location**

Run:
```bash
grep -n "<h1\|tr.community.map_title\|cm.map_title" src/components/CommunityMapView.astro | head -8
```
Expected: at least one `<h1>` line referencing `cm.map_title`.

- [ ] **Step 2: Extend the `CommunityMapCopy` interface**

The component declares its expected shape locally. Update it so TypeScript sees the new `cross_link` keys:

```diff
 interface CommunityMapCopy {
   map_title: string;
   map_subtitle: string;
   map_observers_in_view: string;
   map_min_cluster: string;
   map_sign_in_hint: string;
   map_loading: string;
   map_no_data: string;
+  cross_link: {
+    prompt: string;
+    cta: string;
+  };
   filter: Record<string, string>;
   expert_pill: string;
   sort: Record<string, string>;
 }
```

- [ ] **Step 3: Compute the cross-link href**

The component already imports `routes` and `getLocalizedPath` from `../i18n/utils` (line 10). Add to the frontmatter after the existing locale-derived values:

```typescript
const locale = lang === 'es' ? 'es' : 'en';
const observationsMapHref = getLocalizedPath(lang, routes.exploreMap[locale] + '/');
```

(If `locale` is already declared elsewhere in the frontmatter — check first with `grep -n "locale" src/components/CommunityMapView.astro` — reuse it instead of redeclaring.)

- [ ] **Step 4: Insert the banner below the `<h1>`**

Find the `<h1>{cm.map_title}</h1>` line (around line 36 — verify with grep first). Insert immediately after:

```astro
<p class="text-xs text-zinc-500 dark:text-zinc-400 mb-3">
  {cm.cross_link.prompt}{' '}
  <a href={observationsMapHref} class="text-emerald-600 dark:text-emerald-400 hover:underline">
    {cm.cross_link.cta}
  </a>
</p>
```

(Match the surrounding indentation exactly. The component uses 2-space indent.)

- [ ] **Step 5: Type-check**

Run:
```bash
npx tsc --noEmit
```
Expected: clean.

- [ ] **Step 6: Build**

Run:
```bash
npm run build 2>&1 | tail -8
```
Expected: 231 pages built; no errors.

- [ ] **Step 7: Commit**

```bash
git add src/components/CommunityMapView.astro
git commit -m "$(cat <<'EOF'
feat(map): cross-link banner on /community/map/ to observations map

Reciprocal of the previous commit — users on the observers map can
jump to biodiversity observations without going back through the
header. Same muted zinc / emerald styling.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
```

---

## Task 5: Full verification suite

**Files:** none (verification only).

- [ ] **Step 1: Type-check (final pass)**

Run:
```bash
npx tsc --noEmit
```
Expected: zero output.

- [ ] **Step 2: Run the full test suite**

Run:
```bash
npm run test --silent 2>&1 | tail -8
```
Expected: all tests pass; total count = previous total + 18 (the parity test from Task 2).

- [ ] **Step 3: Production build**

Run:
```bash
npm run build 2>&1 | tail -6
```
Expected: 231 pages, no errors. Confirm both `/en/explore/map/index.html` and `/en/community/map/index.html` exist in `dist/`.

- [ ] **Step 4: Manual visual check**

Run `make dev` and open in a browser. For each combination below, confirm:

| Path | h1 should read | Banner copy |
|---|---|---|
| `/en/explore/map/` | "Observations map" | "Looking for observers near you? See Observers map →" |
| `/es/explorar/mapa/` | "Mapa de observaciones" | "¿Buscas observadores cerca de ti? Ver Mapa de observadores →" |
| `/en/community/map/` | "Observers map" | "Looking for biodiversity observations? See Observations map →" |
| `/es/comunidad/mapa/` | "Mapa de observadores" | "¿Buscas observaciones de biodiversidad? Ver Mapa de observaciones →" |

Also confirm the header MegaMenu (desktop) shows "Observations map" + "Observers map" (or ES equivalents) — no longer two collisions.

Mobile drawer (`MobileDrawer.astro`) reads from the same i18n keys; spot-check on a narrow viewport.

- [ ] **Step 5: Click the banner links round-trip**

From `/en/explore/map/`, click the "See Observers map" link → should land on `/en/community/map/`. Click that page's banner back → should land on `/en/explore/map/`. Repeat in ES.

If the round-trip fails, `routes.communityMap[locale]` or `routes.exploreMap[locale]` is wrong — open `src/i18n/utils.ts` and confirm the route shape.

---

## Task 6: File the D' future-work issue

**Files:** none (gh CLI).

The spec § "D' — future scope (issue body)" provides the canonical body. File it now so the PR can reference it.

- [ ] **Step 1: Create the issue**

Run (HEREDOC to preserve formatting):
```bash
gh issue create \
  --title "Unified /explore/map/ with filters, layers, and render modes" \
  --label "v1.1,UX,maps" \
  --body "$(cat <<'EOF'
## Why

`fix/maps-ia-rename` (PR linked below) renamed the two map pages so the header MegaMenu stops colliding. The deeper duplication remains, though — two MapLibre instances, two data-fetch paths, two implementations of clustering and privacy.

The industry pattern for biodiversity maps (iNaturalist, GBIF, eBird) is **one canvas with rich filtering**, not separate routes per data type. This issue captures the architectural target.

## Scope

1. Unify both maps into a single component under `/explore/map/`. `/community/map/` 301-redirects to `/explore/map/?layers=observers&overlay=none`.
2. **Layer toggles** (multi-select): \`Observations · Observers · Places · Projects (ANP)\`. Default = \`observations\` only.
3. **Render-mode toggle** (single-select): \`Dots · Clusters · Heatmap\`. Default = \`clusters\`.
4. **Filter sidebar / mobile sheet**: taxon, kingdom, date range, observer (by handle), project. URL-encoded so views are sharable.
5. Privacy gates preserved: the Observers layer requires authentication for non-centroid precision; obscure-level rules apply to Observations exactly as today.
6. **MobileBottomBar / MobileDrawer**: single "Map" entry; the page handles all variants.
7. **Telemetry**: track which layer combinations users actually pick — informs whether layered defaults should change.

## Out of scope (v1.2+)

Time-slider, custom palette per kingdom, GeoJSON export from the current view, polygon-draw filter.

## Risks / dependencies

The largest open question is mobile UX for the filter sheet — bottom-sheet vs slide-over vs collapsible-drawer. Recommend a wireframing pass before implementation, comparing against how \`ConsoleLayout\`'s mobile drawer (\`md:hidden\` + \`MobileDrawer.astro\`) handles a similar role-scoped panel today.

## Reference

Design context: [\`docs/superpowers/specs/2026-05-08-maps-ia-cleanup-design.md\`](../blob/main/docs/superpowers/specs/2026-05-08-maps-ia-cleanup-design.md) § "D' — future scope".
EOF
)"
```
Expected: prints the URL of the created issue. Save it for Task 7.

If the `v1.1`, `UX`, or `maps` labels don't exist in the repo, the command errors. Check available labels with `gh label list`; remove unknown labels from `--label`.

- [ ] **Step 2: Capture the issue number**

Run:
```bash
gh issue list --search "Unified /explore/map" --limit 1 --json number,title
```
Note the issue number — you'll reference it in the PR body.

---

## Task 7: Open the PR

**Files:** none (gh CLI).

- [ ] **Step 1: Push the branch**

Run:
```bash
git push -u origin fix/maps-ia-rename
```

- [ ] **Step 2: Create the PR**

Replace `<ISSUE_NUMBER>` with the value from Task 6 Step 2:

```bash
gh pr create --base main --head fix/maps-ia-rename \
  --title "fix(ia): rename duplicate Map labels + cross-link banners" \
  --body "$(cat <<'EOF'
## Summary

The header MegaMenu surfaces two items both labelled "Map" in adjacent columns — they point to genuinely different pages (`/explore/map/` = observation density, `/community/map/` = observer activity) but the shared label forced users to read column headers to disambiguate.

This PR ships the **B-now** half of the design in [`docs/superpowers/specs/2026-05-08-maps-ia-cleanup-design.md`](../blob/main/docs/superpowers/specs/2026-05-08-maps-ia-cleanup-design.md): rename labels + add a thin cross-link banner above each canvas. The architecturally-correct **D'** future (one unified `/explore/map/` with filters and layers) is tracked as #<ISSUE_NUMBER>.

## What changed

- `nav.explore_dropdown.map` → "Observations map" / "Mapa de observaciones"
- `nav.explore_megamenu.community_map` → "Observers map" / "Mapa de observadores"
- `map.title` and `community.map_title` updated to match the new labels
- New `map.cross_link` and `community.cross_link` i18n sub-objects
- `ExploreMap.astro` and `CommunityMapView.astro` each render a one-line zinc-muted banner above their canvas linking to the other map

URLs are unchanged. SEO and external deep-links are preserved.

## Test plan

- [x] `npx tsc --noEmit` — clean
- [x] `npm run test` — full suite green; +18 i18n parity tests
- [x] `npm run build` — 231 pages, no errors
- [x] Manual visual on `/{en,es}/{explore,explorar}/{map,mapa}/` and `/{en,es}/{community,comunidad}/{map,mapa}/`:
  - h1 reads the new label in both locales
  - Cross-link banner visible above the canvas
  - Round-trip click works (Explore → Community → Explore)
- [x] Header MegaMenu (desktop) and `MobileDrawer.astro` (mobile) both show the new labels

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

- [ ] **Step 3: Verify PR opened**

The command prints the PR URL. Open it and confirm:
- Title starts with `fix(ia):` (matches `check-pr-title` CI rule)
- Body references the design spec + the D' issue
- Files changed: 5 (en.json, es.json, ExploreMap.astro, CommunityMapView.astro, maps-ia-i18n.test.ts) + 1 (the spec doc cherry-picked from Task 0)

If the title fails the PR-title CI check, the conventional-commits prefix is wrong — `fix(<scope>):` is the contract.

---

## Notes for the executing engineer

- **Don't merge to main first.** PR #665 (taxa-enrichment) is open against the same `main`. This branch was cut off `main` directly so it's independent — both PRs can land in any order without conflicts.
- **The spec doc commit on `feat/taxa-enrichment-and-tree`** is "for the brainstorming history". After both PRs merge, the spec lives in `main`. Don't worry about it being in two branches — it's the same content.
- **Cross-link styling:** spec § "Cross-link banner" specifies muted zinc text + emerald link, matching how Explore views already style informational links. Don't add hover decorations or icons beyond the existing `→` glyph.
- **No analytics events on the cross-link click.** Tracking which users go between the two maps is on the D' issue's scope, not B's.
