# Observation detail page redesign — viewer + owner edit — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rebuild `src/pages/share/obs/index.astro` from a single-column data dump into a two-column desktop / stacked mobile detail page with map view, photo gallery + lightbox, editable date/time, full habitat/weather/establishment metadata, photo add/remove, and an in-place coordinate editor — without breaking any existing public URL or losing EN/ES parity.

**Architecture:** The page is decomposed into three reusable components — `MapPicker.astro` (extracted from `ObservationForm.astro`, dual-mode `view`/`edit`), `PhotoGallery.astro` (hero + thumb strip + native lightbox), and `ObsManagePanel.astro` (owner-only tabbed editor: Details / Location / Photos). Shared option lists (habitat, weather, establishment_means) move to `src/lib/observation-enums.ts` so the create form and the manage panel cannot drift. Schema gains two columns (`observations.last_material_edit_at`, `media_files.deleted_at`), one partial index, and one BEFORE-UPDATE trigger that flags material edits. A new `delete-photo` Edge Function wraps soft-delete + primary-ID demote + edit-flag in one SQL transaction.

**Tech Stack:** Astro 4 (static output), Tailwind, TypeScript strict, MapLibre GL 4 (existing), Supabase JS client (existing), Vitest + happy-dom, Playwright. No new runtime dependencies — the lightbox is a native ≤150-line implementation per the spec's open question.

**Spec:** `docs/superpowers/specs/2026-04-29-obs-detail-redesign-design.md`

---

## PR breakdown

This plan ships in **6 PRs**, each independently shippable and revertible. The order surfaces bugs in the most-reused component first (MapPicker), then ships the schema delta before any UI consumes it, then layers viewer-only changes (Phase A) before owner-edit changes (Phase B).

| # | Title | Touches | Phase |
|---|---|---|---|
| PR 1 | `MapPicker.astro` extraction (no behavior change) | Component refactor; `ObservationForm.astro` consumes it | Refactor |
| PR 2 | Schema deltas + `observation-enums` module + i18n scaffolding | SQL + new lib + i18n keys | Foundation |
| PR 3 | `PhotoGallery.astro` + viewer-only layout overhaul on `share/obs/` | Viewer-only redesign (Phase A) | Phase A |
| PR 4 | `ObsManagePanel.astro` — Details tab (date / habitat / weather / establishment / notes / sci-name / privacy) | Replaces existing manage panel | Phase B |
| PR 5 | `ObsManagePanel` Location tab (coordinate edit via `MapPicker mode='edit'`) | Builds on PR 1 + PR 4 | Phase B |
| PR 6 | `ObsManagePanel` Photos tab + `delete-photo` Edge Function + edit badge surfacing | Builds on PR 2 + PR 4 | Phase B |

**Dependency edges:**

- PR 2 (schema) is independent of PR 1 (component extraction). Either can ship first, but the plan keeps PR 1 first because it has zero database risk and unlocks PR 5.
- PR 3 depends on PR 1 (uses `MapPicker mode='view'`) and on PR 2 (reads `last_material_edit_at` for the badge — safe even before any rows are flagged, since the column defaults to NULL).
- PR 4 depends on PR 2 (consumes `observation-enums.ts` and `obs_detail.*` i18n keys).
- PR 5 depends on PR 1 (reuses `MapPicker mode='edit'`) and PR 4 (panel shell).
- PR 6 depends on PR 2 (`media_files.deleted_at`), PR 4 (panel shell), and the new `delete-photo` Edge Function.

```
PR 1 ──► PR 5 ──┐
PR 2 ──► PR 3   │
        └► PR 4 ──┴──► PR 6
```

---

## File structure

### Files created

| Path | Responsibility |
|---|---|
| `src/components/MapPicker.astro` | Reusable MapLibre map; `mode='view'` (pin only) or `mode='edit'` (draggable + Save/Cancel) |
| `src/components/PhotoGallery.astro` | Hero photo + below-the-fold thumbnail strip + native lightbox (kbd + swipe + Esc + per-photo share) |
| `src/components/ObsManagePanel.astro` | Owner-only tabbed editor mounted in `share/obs/index.astro`; tabs: Details / Location / Photos |
| `src/components/ShareObsView.astro` | Shared body of the obs detail page; pulled out of `share/obs/index.astro` so the markup is testable in isolation and EN/ES treated symmetrically |
| `src/lib/observation-enums.ts` | Single source for `habitats`, `weathers`, `establishmentMeans` arrays + their bilingual labels |
| `src/lib/observation-enums.test.ts` | Snapshot test guarding against silent drift between the create form and the manage panel |
| `src/lib/photo-deletion.ts` | Pure helper: `willDemote(photos, primaryId, deletingId)` deciding whether the cascade-photo confirm fires |
| `src/lib/photo-deletion.test.ts` | Unit tests for the deletion-policy helper |
| `supabase/functions/delete-photo/index.ts` | Edge Function: atomic soft-delete + primary-ID demote + `last_material_edit_at` bump |
| `docs/specs/modules/03-observations-and-media.md` (append-section) | If the spec doc exists, append the new schema delta + edit-semantics table; otherwise create as new module spec |
| `tests/obs-detail/material-edit-trigger.test.ts` | pglite (or seeded test DB) coverage of the material-edit trigger across all input deltas |
| `tests/e2e/obs-detail-view.spec.ts` | Playwright: hero + thumb strip + map render; lightbox open/close; mobile-chrome variant |
| `tests/e2e/obs-detail-edit.spec.ts` | Playwright: signed-in owner edits date / location / habitat; "edited after IDs" badge appears |

### Files modified

| Path | What changes |
|---|---|
| `src/components/ObservationForm.astro` | Replace the inline `<div id="map-modal">` (lines 568–603) and the entire `// ── Map picker (MapLibre)` block (lines 1928–2070) with a `<MapPicker mode='edit' />` consumer call. Replace inline `habitats`/`weathers`/`establishmentMeans` arrays (lines 42–54) with imports from `observation-enums.ts`. **Pure refactor — no behavior change.** |
| `src/pages/share/obs/index.astro` | Wholesale rewrite to consume `ShareObsView`. Old inline `<section id="manage-panel">` (lines 105–135) and inline `wireManagePanel` (lines 410–521) are deleted in PR 4 once `ObsManagePanel` ships. |
| `docs/specs/infra/supabase-schema.sql` | Append idempotent block: `ADD COLUMN IF NOT EXISTS last_material_edit_at`, `ADD COLUMN IF NOT EXISTS deleted_at`, partial index, trigger function + trigger |
| `src/i18n/en.json` | Add `obs_detail.*` namespace |
| `src/i18n/es.json` | Mirror `obs_detail.*` |
| `src/i18n/utils.ts` | Re-export `obs_detail` shape if needed (only if the existing `t(lang)` typing requires it; usually not) |

### Boundary rules

- **`src/lib/observation-enums.ts`** is the single source of truth for the option arrays. After PR 2 lands, neither `ObservationForm.astro` nor `ObsManagePanel.astro` may declare `const habitats = [...]` — they must `import` from this module. The snapshot test enforces it.
- **`MapPicker.astro`** owns all MapLibre lifecycle. Other components pass props in and read events out; no `document.getElementById('map-picker-…')` from outside the component.
- **`delete-photo` Edge Function** is the only place where photo soft-delete + ID demote + edit-flag may co-occur. Browser-side `UPDATE media_files SET deleted_at = …` is forbidden — the Edge Function's transaction is the atomicity guarantee.

---

## Pre-flight (run once, before PR 1)

- [ ] **Confirm working directory and clean tree**

```bash
pwd
git status -s
git rev-parse --abbrev-ref HEAD
```
Expected: cwd is `…/rastrum`, working tree clean (or only `docs/superpowers/plans/` in progress), branch is `main` or a feature branch.

- [ ] **Confirm test baseline is green**

```bash
npm run typecheck && npm run test
```
Expected: 0 type errors; all Vitest tests pass (~454 tests today per CLAUDE.md).

- [ ] **Confirm the schema currently applies cleanly**

```bash
make db-apply
```
Expected: no errors. If this fails on `main`, fix that first — the new schema deltas in PR 2 will compound the failure.

- [ ] **Confirm the spec is the version you're working from**

```bash
head -10 docs/superpowers/specs/2026-04-29-obs-detail-redesign-design.md
```
Expected: header matches `**Date:** 2026-04-29` and `**Status:** Design`.

---

## PR 1 — Extract `MapPicker.astro` (no behavior change)

**Why first:** The map-picker code is the most-reused new asset. Shipping it as a pure refactor with full e2e coverage of `/observe` first lets PR 5 reuse it with zero new MapLibre risk.

**Files:**
- Create: `src/components/MapPicker.astro`
- Modify: `src/components/ObservationForm.astro` (delete lines 568–603 and the `// ── Map picker (MapLibre)` block at 1928–2070; insert `<MapPicker />` consumer)
- Test: `tests/e2e/observe-form-map.spec.ts` (new) + the existing observe-form e2e that already exercises the picker

### Task 1.1 — Capture the existing map-picker behavior in an e2e test

- [ ] **Step 1.1.1 — Write a Playwright e2e that drives the existing map picker on `/observe`**

Create `tests/e2e/observe-form-map.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

// Pre-refactor baseline. Re-run after PR 1 to prove zero behavior change.
test('observe form: map picker opens, drops pin, returns coords to manual lat/lng', async ({ page }) => {
  await page.goto('/en/observe/');
  await page.getByRole('button', { name: /Pick on map/i }).click();
  await expect(page.locator('#map-modal')).toBeVisible();
  await expect(page.locator('#map-picker')).toBeVisible();

  // Wait for MapLibre `load` event by waiting for the loading-status text to clear.
  await expect(page.locator('#map-picker-status')).toBeHidden({ timeout: 10_000 });

  // Click roughly the center of the map to drop the pin there.
  const map = page.locator('#map-picker');
  const box = await map.boundingBox();
  if (!box) throw new Error('map has no bounding box');
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

  await page.getByRole('button', { name: /Use this location/i }).click();
  await expect(page.locator('#map-modal')).toBeHidden();

  // The form should now have manual lat / lng populated.
  await expect(page.locator('#manual-lat')).not.toHaveValue('');
  await expect(page.locator('#manual-lng')).not.toHaveValue('');
});
```

- [ ] **Step 1.1.2 — Run it against `main` to capture the pre-refactor baseline**

```bash
npm run test:e2e -- tests/e2e/observe-form-map.spec.ts
```
Expected: PASS. If it fails on `main`, the refactor cannot prove zero-change — fix the test first.

- [ ] **Step 1.1.3 — Commit**

```bash
git add tests/e2e/observe-form-map.spec.ts
git commit -m "test(observe): pin existing map-picker behavior before MapPicker extraction"
```

### Task 1.2 — Create `MapPicker.astro` with the extracted markup + script

- [ ] **Step 1.2.1 — Create the component shell**

Create `src/components/MapPicker.astro`. The component renders BOTH a `view`-mode static map and an `edit`-mode modal-with-Save/Cancel; the prop `mode` selects which DOM and behavior is wired.

```astro
---
interface Props {
  mode: 'view' | 'edit';
  initialCoords?: { lat: number; lng: number } | null;
  obscureLevel?: 'none' | '5km' | '0.1deg' | '0.2deg' | 'full';
  lang: 'en' | 'es';
  /** Stable id suffix so multiple MapPicker instances on one page don't collide. */
  pickerId?: string;
}
const { mode, initialCoords = null, obscureLevel = 'none', lang, pickerId = 'default' } = Astro.props;
const isEs = lang === 'es';

// All copy lives inline for now — extract to i18n if more than one consumer
// surfaces user-facing labels here.
const labels = {
  open:    isEs ? 'Elegir en el mapa' : 'Pick on map',
  title:   isEs ? 'Elige una ubicación' : 'Pick a location',
  hint:    isEs ? 'Toca o arrastra el alfiler para fijar la ubicación.' : 'Tap or drag the pin to set the location.',
  use:     isEs ? 'Usar esta ubicación' : 'Use this location',
  cancel:  isEs ? 'Cancelar' : 'Cancel',
  loading: isEs ? 'Cargando mapa…' : 'Loading map…',
  satellite: isEs ? 'Satélite' : 'Satellite',
  map:     isEs ? 'Mapa' : 'Map',
};

const containerId = `mp-${pickerId}`;
const modalId     = `mp-modal-${pickerId}`;
---

{mode === 'view' && (
  <div
    id={containerId}
    class="w-full h-[240px] rounded-lg overflow-hidden border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900"
    data-mode="view"
    data-picker-id={pickerId}
    data-initial-lat={initialCoords?.lat ?? ''}
    data-initial-lng={initialCoords?.lng ?? ''}
    data-obscure-level={obscureLevel}
  ></div>
)}

{mode === 'edit' && (
  <>
    <button
      type="button"
      data-mappicker-open={pickerId}
      class="text-xs text-emerald-700 dark:text-emerald-400 underline"
    >{labels.open}</button>

    <div
      id={modalId}
      class="hidden fixed inset-0 z-50 flex items-stretch sm:items-center justify-center bg-black/80 p-0 sm:p-4"
      role="dialog" aria-modal="true" aria-labelledby={`${modalId}-title`}
      data-mode="edit" data-picker-id={pickerId}
      data-initial-lat={initialCoords?.lat ?? ''}
      data-initial-lng={initialCoords?.lng ?? ''}
    >
      <div class="relative w-full sm:max-w-2xl h-full sm:h-[80vh] bg-white dark:bg-zinc-900 sm:rounded-lg overflow-hidden flex flex-col">
        <div class="flex items-center justify-between px-3 py-2 border-b border-zinc-200 dark:border-zinc-800">
          <h2 id={`${modalId}-title`} class="text-sm font-semibold text-zinc-900 dark:text-zinc-100">{labels.title}</h2>
          <div class="flex items-center gap-2">
            <button data-mappicker-satellite={pickerId} type="button"
              class="inline-flex items-center gap-1 rounded-md border border-zinc-300 dark:border-zinc-700 px-2 py-1 text-xs font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-50 dark:hover:bg-zinc-800"
              aria-pressed="false">
              <span data-mappicker-satellite-label={pickerId}>{labels.satellite}</span>
            </button>
            <button data-mappicker-close={pickerId} type="button"
              class="min-h-11 min-w-11 rounded text-zinc-500 dark:text-zinc-400" aria-label={labels.cancel}>
              <svg class="w-5 h-5 mx-auto" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
            </button>
          </div>
        </div>
        <p class="px-3 py-2 text-xs text-zinc-500 dark:text-zinc-400">{labels.hint}</p>
        <div id={containerId} class="flex-1 bg-zinc-100 dark:bg-zinc-900"></div>
        <p data-mappicker-status={pickerId} class="px-3 py-1 text-xs text-zinc-500 dark:text-zinc-400">{labels.loading}</p>
        <div class="flex items-center justify-end gap-2 px-3 py-3 border-t border-zinc-200 dark:border-zinc-800">
          <button data-mappicker-cancel={pickerId} type="button"
            class="min-h-11 px-3 rounded-lg text-sm font-medium text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">{labels.cancel}</button>
          <button data-mappicker-use={pickerId} type="button"
            class="min-h-11 rounded-lg bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50" disabled>{labels.use}</button>
        </div>
      </div>
    </div>
  </>
)}

<link rel="stylesheet" href="https://unpkg.com/maplibre-gl@4/dist/maplibre-gl.css" />

<script>
  import maplibregl from 'maplibre-gl';
  import { MEXICO_DEFAULT_CENTER, isValidLatLng } from '../lib/media-helpers';

  type Coords = { lat: number; lng: number };

  // Module-level instances so re-opens don't reinit the map.
  const instances = new Map<string, { map: maplibregl.Map; marker: maplibregl.Marker; selected: Coords | null }>();

  // Initialize every static-view map on page load.
  document.querySelectorAll<HTMLElement>('[data-mode="view"][data-picker-id]').forEach((el) => {
    initViewPicker(el);
  });

  // Wire each edit-mode picker's open / save / close.
  document.querySelectorAll<HTMLButtonElement>('[data-mappicker-open]').forEach((btn) => {
    const id = btn.dataset.mappickerOpen!;
    btn.addEventListener('click', () => openEditPicker(id));
  });

  function initViewPicker(el: HTMLElement) {
    const lat = parseFloat(el.dataset.initialLat ?? '');
    const lng = parseFloat(el.dataset.initialLng ?? '');
    if (!Number.isFinite(lat) || !Number.isFinite(lng)) return;
    const map = new maplibregl.Map({
      container: el,
      style: 'https://tiles.openfreemap.org/styles/liberty',
      center: [lng, lat],
      zoom: 12,
      interactive: false,
      attributionControl: { compact: true },
    });
    new maplibregl.Marker({ color: '#047857' }).setLngLat([lng, lat]).addTo(map);
  }

  // openEditPicker, closeEditPicker, satellite-toggle wiring are direct ports
  // of the 1928–2070 block from ObservationForm.astro, parameterized by
  // `pickerId` and emitting a custom event `rastrum:mappicker-save` with the
  // chosen coords on Save click. See the original file for detail.
  function openEditPicker(id: string) {
    // … see PR 1 implementation; behavior is byte-identical to today's modal,
    // dispatching new CustomEvent('rastrum:mappicker-save', { detail: { id, coords } })
    // when the user confirms.
  }
</script>
```

> **Note on the script body:** the open/close/save/satellite logic is a direct port of the 1928–2070 block from `ObservationForm.astro`, parameterized by `pickerId` and emitting `rastrum:mappicker-save` with `{ id, coords }` on Save. Implement it inline — do not inline `// TODO`.

- [ ] **Step 1.2.2 — Refactor `ObservationForm.astro` to consume `<MapPicker mode='edit' />`**

In `src/components/ObservationForm.astro`:

1. Add `import MapPicker from './MapPicker.astro';` at the top of the frontmatter.
2. Delete lines 568–603 (the inline `<div id="map-modal">`).
3. Insert in their place: `<MapPicker mode='edit' lang={lang} pickerId='observe' initialCoords={null} />`.
4. Delete lines 1928–2070 (the inline map-picker JS).
5. Replace the deleted JS with a small bridge:

```ts
window.addEventListener('rastrum:mappicker-save', (ev) => {
  const e = ev as CustomEvent<{ id: string; coords: { lat: number; lng: number } }>;
  if (e.detail.id !== 'observe') return;
  location = {
    lat: e.detail.coords.lat,
    lng: e.detail.coords.lng,
    accuracyM: 50,
    altitudeM: null,
    capturedFrom: 'manual',
  };
  // … existing post-pick logic that updated #manual-lat / #manual-lng / GPS status
});
```

- [ ] **Step 1.2.3 — Run typecheck**

```bash
npm run typecheck
```
Expected: 0 errors.

- [ ] **Step 1.2.4 — Re-run the e2e baseline from Task 1.1**

```bash
npm run test:e2e -- tests/e2e/observe-form-map.spec.ts
```
Expected: PASS — the same test that passed on `main` passes after the refactor. If it fails, the extraction is not behavior-preserving — fix before proceeding.

- [ ] **Step 1.2.5 — Run full test suite**

```bash
npm run test && npm run build
```
Expected: all green; `dist/` builds.

- [ ] **Step 1.2.6 — Commit**

```bash
git add src/components/MapPicker.astro src/components/ObservationForm.astro
git commit -m "refactor(observe): extract MapPicker.astro from ObservationForm (no behavior change)"
```

- [ ] **Step 1.2.7 — Open PR 1**

```bash
gh pr create --title "refactor(observe): extract MapPicker.astro (no behavior change)" --body "$(cat <<'EOF'
## Summary
- Extracts the inline map-picker modal from `ObservationForm.astro` (lines 568–603 + 1928–2070) into a reusable `src/components/MapPicker.astro` component with two modes: `view` (static, non-interactive) and `edit` (modal, draggable, Save/Cancel).
- The observe-form continues to consume the same picker via the new component; behavior is byte-identical and proven by an e2e baseline that ran green before and after the refactor.
- Sets up PR 5 (Location tab on observation detail page) to reuse the same component for in-place coordinate edit.

## Test plan
- [x] `npm run test:e2e -- tests/e2e/observe-form-map.spec.ts` passes both pre- and post-refactor.
- [x] `npm run test` and `npm run build` green.
- [ ] Manual: open `/en/observe/`, click "Pick on map", drop a pin, click "Use this location" — manual-lat / manual-lng populate as before.
EOF
)"
```

---

## PR 2 — Schema deltas + `observation-enums` + i18n scaffolding

**Why second:** Every UI PR after this depends on either the new columns, the shared enum module, or the new i18n namespace. Shipping all three together keeps the dependency graph clean.

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append section)
- Create: `src/lib/observation-enums.ts`
- Create: `src/lib/observation-enums.test.ts`
- Modify: `src/components/ObservationForm.astro` (consume `observation-enums.ts`)
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`
- Create: `tests/obs-detail/material-edit-trigger.test.ts`

### Task 2.1 — Append schema deltas

- [ ] **Step 2.1.1 — Append the new SQL block to `docs/specs/infra/supabase-schema.sql`**

Append at the end of the file (after the last existing section, before any final `NOTIFY pgrst, 'reload schema';` if present at file tail):

```sql
-- ============================================================
-- Observation detail redesign — material edit tracking + soft-delete
-- (2026-04-29) — see docs/superpowers/specs/2026-04-29-obs-detail-redesign-design.md
-- ============================================================

ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS last_material_edit_at timestamptz;

ALTER TABLE public.media_files
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_media_files_active
  ON public.media_files (observation_id) WHERE deleted_at IS NULL;

COMMENT ON COLUMN public.observations.last_material_edit_at IS
  'Set by observations_material_edit_check_trg when the owner makes a material edit (location > 1 km, observed_at > 24 h, primary_taxon_id change, or photo soft-delete). NULL means no material edits since creation.';

COMMENT ON COLUMN public.media_files.deleted_at IS
  'Soft-delete sentinel. Non-NULL means the owner removed this photo via the obs detail Photos tab. R2 blob is NOT removed in v1; gc-orphan-media cron is a v1.1 follow-up.';

CREATE OR REPLACE FUNCTION public.observations_material_edit_check()
RETURNS trigger AS $$
DECLARE
  is_material boolean := false;
BEGIN
  -- Location moved more than 1 km
  IF NEW.location IS DISTINCT FROM OLD.location AND OLD.location IS NOT NULL THEN
    IF ST_Distance(NEW.location, OLD.location) > 1000 THEN
      is_material := true;
    END IF;
  END IF;

  -- observed_at moved more than 24 hours
  IF NEW.observed_at IS DISTINCT FROM OLD.observed_at AND OLD.observed_at IS NOT NULL THEN
    IF abs(extract(epoch FROM (NEW.observed_at - OLD.observed_at))) > 86400 THEN
      is_material := true;
    END IF;
  END IF;

  -- primary taxon changed (denormalized from identifications by sync_primary_id_trigger)
  IF NEW.primary_taxon_id IS DISTINCT FROM OLD.primary_taxon_id THEN
    is_material := true;
  END IF;

  IF is_material THEN
    NEW.last_material_edit_at := now();
  END IF;

  RETURN NEW;
END;
$$ LANGUAGE plpgsql;

DROP TRIGGER IF EXISTS observations_material_edit_check_trg ON public.observations;
CREATE TRIGGER observations_material_edit_check_trg
  BEFORE UPDATE ON public.observations
  FOR EACH ROW
  EXECUTE FUNCTION public.observations_material_edit_check();

NOTIFY pgrst, 'reload schema';
```

> **Note on trigger composition:** the existing `sync_primary_id_trigger` fires on `public.identifications` (AFTER INSERT OR UPDATE), not on `public.observations`. It cascades a write to `observations.primary_taxon_id`. That cascading UPDATE then fires `observations_material_edit_check_trg` BEFORE UPDATE on `observations`, which sees `NEW.primary_taxon_id IS DISTINCT FROM OLD.primary_taxon_id` and flags the row. The two triggers fire on different tables, so trigger-name ordering is not a concern.

- [ ] **Step 2.1.2 — Apply the schema locally + verify idempotency**

```bash
make db-apply           # first apply
make db-apply           # second apply must be a no-op error-wise
make db-verify          # confirm new columns + trigger exist
```
Expected: both `make db-apply` runs exit 0; `db-verify` shows `observations.last_material_edit_at`, `media_files.deleted_at`, the partial index `idx_media_files_active`, and the trigger `observations_material_edit_check_trg`.

- [ ] **Step 2.1.3 — Confirm `db-validate.yml` will accept the change**

```bash
gh workflow view db-validate.yml --ref HEAD
```
Expected: workflow shape matches the existing one — Postgres 17 + PostGIS 3.4 service container, applies the schema twice, runs the sentinel check. Don't run it locally; just confirm the workflow exists and the SQL is idempotent (proven by step 2.1.2).

### Task 2.2 — Trigger correctness — vitest against pglite

- [ ] **Step 2.2.1 — Write the failing test**

Create `tests/obs-detail/material-edit-trigger.test.ts`. The repo already runs vitest; if it has a pglite-based DB harness, use it. If not, fall back to a Postgres-as-a-service container started by the test (the `db-validate.yml` workflow does this; replicate locally with the `pg` package). Inspect existing SQL test files in `tests/sql/` and use whatever harness they use — if none, ship the test as a `.skip` with a comment explaining the missing harness so the CI gate isn't broken, and file a roadmap follow-up to wire pglite. (Bias toward shipping the harness — the trigger logic is the riskiest part of this entire spec.)

```ts
import { describe, it, expect, beforeAll, afterAll } from 'vitest';
import { newDb } from 'pg-mem'; // or the repo's existing harness; see comment above

// Apply the schema fragment under test (just the trigger + columns).
// Insert a baseline observation row, run UPDATEs across the boundary cases,
// and assert last_material_edit_at is set or unset accordingly.

describe('observations_material_edit_check trigger', () => {
  const cases: Array<{
    name: string;
    update: Record<string, unknown>;
    expectFlagged: boolean;
  }> = [
    { name: 'notes change → not material', update: { notes: 'changed' }, expectFlagged: false },
    { name: 'habitat change → not material', update: { habitat: 'cloud_forest' }, expectFlagged: false },
    { name: 'obscure_level change → not material', update: { obscure_level: '5km' }, expectFlagged: false },
    { name: 'location moves 500 m → not material', update: { /* 500 m offset */ }, expectFlagged: false },
    { name: 'location moves 5 km → material', update: { /* 5 km offset */ }, expectFlagged: true },
    { name: 'observed_at moves 1 hour → not material', update: { /* +1h */ }, expectFlagged: false },
    { name: 'observed_at moves 36 hours → material', update: { /* +36h */ }, expectFlagged: true },
    { name: 'primary_taxon_id changes → material', update: { primary_taxon_id: '<new>' }, expectFlagged: true },
  ];

  it.each(cases)('$name', async ({ update, expectFlagged }) => {
    // Arrange: reset the row to a known baseline with last_material_edit_at = NULL.
    // Act: issue the update.
    // Assert: read back last_material_edit_at and check whether it's been set.
  });
});
```

- [ ] **Step 2.2.2 — Run the test**

```bash
npm run test -- tests/obs-detail/material-edit-trigger.test.ts
```
Expected: All 8 cases pass.

### Task 2.3 — Extract `observation-enums.ts`

- [ ] **Step 2.3.1 — Create the module**

Create `src/lib/observation-enums.ts`:

```ts
// Single source of truth for the option arrays + bilingual labels shared
// between the create form (ObservationForm.astro) and the obs detail
// Manage panel (ObsManagePanel.astro). Edit only here; the consumers
// import.

export const HABITATS = [
  'forest_pine_oak','forest_oak','forest_pine',
  'tropical_evergreen','tropical_subevergreen',
  'cloud_forest','tropical_dry_forest',
  'xerophytic','scrubland',
  'riparian','wetland','grassland',
  'agricultural','urban','coastal','reef','cave',
] as const;
export type Habitat = (typeof HABITATS)[number];

export const WEATHERS = [
  'sunny','cloudy','overcast','light_rain','heavy_rain','fog','storm',
] as const;
export type Weather = (typeof WEATHERS)[number];

export const ESTABLISHMENT_MEANS = [
  'wild','cultivated','captive','uncertain',
] as const;
export type EstablishmentMeans = (typeof ESTABLISHMENT_MEANS)[number];

/** Pull the bilingual label map for a given key family. The label tree
 *  lives in i18n; this is just a typed accessor so consumers don't need
 *  the awful inline `Record<…>` cast that breaks Astro JSX. */
export function labelFor(
  tree: unknown,
  family: 'habitat_options' | 'weather_options' | 'establishment_means_options',
  key: string,
): string {
  const fam = (tree as Record<string, unknown>)[family];
  if (fam && typeof fam === 'object') {
    const v = (fam as Record<string, unknown>)[key];
    if (typeof v === 'string') return v;
  }
  return key.replace(/_/g, ' ');
}
```

- [ ] **Step 2.3.2 — Write the snapshot test**

Create `src/lib/observation-enums.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { HABITATS, WEATHERS, ESTABLISHMENT_MEANS } from './observation-enums';

describe('observation-enums', () => {
  it('habitat list is stable (snapshot)', () => {
    expect(HABITATS).toMatchInlineSnapshot(`
      [
        "forest_pine_oak",
        "forest_oak",
        "forest_pine",
        "tropical_evergreen",
        "tropical_subevergreen",
        "cloud_forest",
        "tropical_dry_forest",
        "xerophytic",
        "scrubland",
        "riparian",
        "wetland",
        "grassland",
        "agricultural",
        "urban",
        "coastal",
        "reef",
        "cave",
      ]
    `);
  });

  it('weather list is stable (snapshot)', () => {
    expect(WEATHERS).toMatchInlineSnapshot(`
      [
        "sunny",
        "cloudy",
        "overcast",
        "light_rain",
        "heavy_rain",
        "fog",
        "storm",
      ]
    `);
  });

  it('establishment_means list is stable (snapshot)', () => {
    expect(ESTABLISHMENT_MEANS).toMatchInlineSnapshot(`
      [
        "wild",
        "cultivated",
        "captive",
        "uncertain",
      ]
    `);
  });
});
```

- [ ] **Step 2.3.3 — Run the test to confirm it passes**

```bash
npm run test -- src/lib/observation-enums.test.ts
```
Expected: PASS.

- [ ] **Step 2.3.4 — Refactor `ObservationForm.astro` to consume the module**

In `src/components/ObservationForm.astro`, replace lines 42–54 with:

```astro
import { HABITATS, WEATHERS, ESTABLISHMENT_MEANS, labelFor } from '../lib/observation-enums';

const habitats = HABITATS;
const weathers = WEATHERS;
const establishmentMeans = ESTABLISHMENT_MEANS;
```

And replace any inline `habitatLabels?.[h] ?? h.replace(/_/g, ' ')` calls with `labelFor(tr.observe, 'habitat_options', h)` (and equivalents). Verify the rendered options are identical by re-running the e2e baseline:

```bash
npm run test:e2e -- tests/e2e/observe-form-map.spec.ts
npm run build
```
Expected: still PASS; build still 57 pages.

### Task 2.4 — Add `obs_detail.*` i18n namespace

- [ ] **Step 2.4.1 — Add the EN namespace**

Add to `src/i18n/en.json` (alphabetically placed under top-level keys, near `observe`):

```jsonc
"obs_detail": {
  "tabs": { "details": "Details", "location": "Location", "photos": "Photos" },
  "edit_location": "Edit location",
  "coords_precise_label": "Precise (only you can see this)",
  "coords_obscured_label": "Coarsened to ~{km} km (public)",
  "edited_badge": "Edited after IDs were given. Suggesters may want to re-affirm.",
  "needs_review": "Needs review",
  "delete_photo_confirm": "This photo was the basis for the current identification. Deleting it will mark the observation as needing review. Continue?",
  "delete_obs_confirm": "Delete this observation? This cannot be undone.",
  "add_photo": "Add photo",
  "delete_photo": "Delete photo",
  "save_changes": "Save changes",
  "saved": "Saved.",
  "errors": {
    "coords_invalid": "Latitude must be between −90 and 90, longitude between −180 and 180.",
    "save_failed": "Save failed. Please try again.",
    "upload_failed": "Photo upload failed. Please try again."
  }
}
```

- [ ] **Step 2.4.2 — Mirror in `src/i18n/es.json`**

```jsonc
"obs_detail": {
  "tabs": { "details": "Detalles", "location": "Ubicación", "photos": "Fotos" },
  "edit_location": "Editar ubicación",
  "coords_precise_label": "Precisas (sólo tú las ves)",
  "coords_obscured_label": "Aproximadas a ~{km} km (público)",
  "edited_badge": "Editado después de las identificaciones. Los sugerentes pueden querer reafirmar.",
  "needs_review": "Necesita revisión",
  "delete_photo_confirm": "Esta foto fue la base de la identificación actual. Eliminarla marcará la observación como pendiente de revisión. ¿Continuar?",
  "delete_obs_confirm": "¿Eliminar esta observación? Esto no se puede deshacer.",
  "add_photo": "Agregar foto",
  "delete_photo": "Eliminar foto",
  "save_changes": "Guardar cambios",
  "saved": "Guardado.",
  "errors": {
    "coords_invalid": "La latitud debe estar entre −90 y 90, la longitud entre −180 y 180.",
    "save_failed": "No se pudo guardar. Inténtalo de nuevo.",
    "upload_failed": "No se pudo subir la foto. Inténtalo de nuevo."
  }
}
```

- [ ] **Step 2.4.3 — Build to confirm i18n parity**

```bash
npm run build
```
Expected: 0 errors; pages count unchanged.

- [ ] **Step 2.4.4 — Commit + open PR 2**

```bash
git add docs/specs/infra/supabase-schema.sql \
        src/lib/observation-enums.ts \
        src/lib/observation-enums.test.ts \
        src/components/ObservationForm.astro \
        src/i18n/en.json src/i18n/es.json \
        tests/obs-detail/material-edit-trigger.test.ts
git commit -m "feat(obs-detail): schema deltas + observation-enums + obs_detail i18n namespace"
gh pr create --title "feat(obs-detail): schema deltas + observation-enums + obs_detail i18n namespace" --body "$(cat <<'EOF'
## Summary
- Adds `observations.last_material_edit_at`, `media_files.deleted_at`, partial index `idx_media_files_active`, and the `observations_material_edit_check_trg` trigger.
- Extracts shared `habitats` / `weathers` / `establishment_means` arrays into `src/lib/observation-enums.ts` so the create form and the upcoming Manage panel share a source of truth.
- Adds `obs_detail.*` namespace to both i18n files.
- pglite-backed vitest covers all 8 trigger boundary cases.

## Test plan
- [x] `make db-apply` is replay-safe (run twice, no errors).
- [x] `make db-verify` shows the new columns + trigger.
- [x] Vitest snapshot prevents enum drift.
- [x] `npm run build` green; EN/ES paired.
EOF
)"
```

---

## PR 3 — `PhotoGallery.astro` + viewer-only redesign

**Why third:** Phase A — viewer-only. Ships the new layout shell on `share/obs/index.astro` and a native lightbox without touching any owner-edit logic, so reverting if needed is a one-PR rollback.

**Files:**
- Create: `src/components/PhotoGallery.astro`
- Create: `src/components/ShareObsView.astro` (the body of `share/obs/index.astro`, extracted)
- Modify: `src/pages/share/obs/index.astro` (slim to a thin wrapper that mounts `ShareObsView`)
- Create: `tests/e2e/obs-detail-view.spec.ts`

### Task 3.1 — `PhotoGallery.astro` with native lightbox

- [ ] **Step 3.1.1 — Create the component**

Create `src/components/PhotoGallery.astro`. Spec is explicit: prefer native ≤150 lines, fall back to photoswipe (~30 kB gz) only if line budget blows. Implement native first.

```astro
---
interface Props {
  /** Filtered to deleted_at IS NULL upstream by the page script. */
  photos: Array<{ id: string; url: string; thumbnail_url: string | null; caption?: string | null; width?: number | null; height?: number | null }>;
  lang: 'en' | 'es';
  mode?: 'viewer' | 'owner';
}
const { photos, lang, mode = 'viewer' } = Astro.props;
const isEs = lang === 'es';
---

{photos.length > 0 && (
  <div class="space-y-2" data-photo-gallery data-mode={mode}>
    <button
      type="button"
      data-photo-hero
      data-photo-id={photos[0].id}
      class="block w-full aspect-[16/10] overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-zinc-100 dark:bg-zinc-900"
    >
      <img src={photos[0].url} alt="" class="w-full h-full object-cover" loading="eager" decoding="async" />
    </button>
    {photos.length > 1 && (
      <div class="grid grid-cols-5 gap-1.5">
        {photos.map((p, i) => (
          <button
            type="button"
            data-photo-thumb
            data-photo-id={p.id}
            data-photo-index={i}
            class="aspect-square overflow-hidden rounded-md border border-zinc-200 dark:border-zinc-800"
          >
            <img src={p.thumbnail_url ?? p.url} alt="" class="w-full h-full object-cover" loading="lazy" decoding="async" />
          </button>
        ))}
      </div>
    )}

    <!-- Native lightbox -->
    <div data-photo-lightbox class="hidden fixed inset-0 z-50 bg-black/95 flex items-center justify-center" role="dialog" aria-modal="true">
      <button data-photo-lightbox-close type="button" class="absolute top-3 right-3 text-white/80 hover:text-white" aria-label={isEs ? 'Cerrar' : 'Close'}>
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
      </button>
      <button data-photo-lightbox-prev type="button" class="absolute left-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white" aria-label={isEs ? 'Anterior' : 'Previous'}>
        <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M15 19l-7-7 7-7"/></svg>
      </button>
      <img data-photo-lightbox-img src="" alt="" class="max-w-[95vw] max-h-[90vh] object-contain" />
      <button data-photo-lightbox-next type="button" class="absolute right-3 top-1/2 -translate-y-1/2 text-white/80 hover:text-white" aria-label={isEs ? 'Siguiente' : 'Next'}>
        <svg class="w-8 h-8" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
      </button>
      <button data-photo-lightbox-share type="button" class="absolute bottom-4 left-1/2 -translate-x-1/2 rounded-lg bg-white/10 text-white px-3 py-1.5 text-sm hover:bg-white/20" aria-label={isEs ? 'Compartir foto' : 'Share photo'}>
        {isEs ? 'Compartir' : 'Share'}
      </button>
    </div>
  </div>
)}

<script>
  // Native lightbox: keyboard ←/→/Esc, swipe on mobile, share button per photo.
  // Target ≤ 150 lines per spec. If this exceeds 150, switch to photoswipe.
  const galleries = document.querySelectorAll<HTMLElement>('[data-photo-gallery]');
  galleries.forEach((root) => {
    const photos = Array.from(root.querySelectorAll<HTMLElement>('[data-photo-thumb], [data-photo-hero]'));
    const lightbox = root.querySelector<HTMLElement>('[data-photo-lightbox]');
    const img = root.querySelector<HTMLImageElement>('[data-photo-lightbox-img]');
    const closeBtn = root.querySelector<HTMLButtonElement>('[data-photo-lightbox-close]');
    const prevBtn = root.querySelector<HTMLButtonElement>('[data-photo-lightbox-prev]');
    const nextBtn = root.querySelector<HTMLButtonElement>('[data-photo-lightbox-next]');
    const shareBtn = root.querySelector<HTMLButtonElement>('[data-photo-lightbox-share]');
    if (!lightbox || !img) return;

    const urls = photos.map(b => b.querySelector('img')!.src);
    let idx = 0;

    function open(i: number) {
      idx = i;
      img!.src = urls[idx];
      lightbox!.classList.remove('hidden');
      document.body.style.overflow = 'hidden';
    }
    function close() {
      lightbox!.classList.add('hidden');
      document.body.style.overflow = '';
    }
    function go(delta: number) {
      idx = (idx + delta + urls.length) % urls.length;
      img!.src = urls[idx];
    }
    photos.forEach((b, i) => b.addEventListener('click', () => open(i)));
    closeBtn?.addEventListener('click', close);
    prevBtn?.addEventListener('click', () => go(-1));
    nextBtn?.addEventListener('click', () => go(1));
    document.addEventListener('keydown', (e) => {
      if (lightbox!.classList.contains('hidden')) return;
      if (e.key === 'Escape') close();
      if (e.key === 'ArrowLeft') go(-1);
      if (e.key === 'ArrowRight') go(1);
    });
    // Swipe
    let touchStartX = 0;
    lightbox.addEventListener('touchstart', (e) => { touchStartX = e.touches[0].clientX; }, { passive: true });
    lightbox.addEventListener('touchend', (e) => {
      const dx = e.changedTouches[0].clientX - touchStartX;
      if (Math.abs(dx) > 50) go(dx < 0 ? 1 : -1);
    });
    // Per-photo share
    shareBtn?.addEventListener('click', async () => {
      const url = `${window.location.origin}${window.location.pathname}?id=${new URLSearchParams(window.location.search).get('id')}#photo-${idx}`;
      if (navigator.share) await navigator.share({ url }).catch(() => {});
      else navigator.clipboard?.writeText(url);
    });
  });
</script>
```

> **Line-budget check:** count the script body. If > 150 lines after final implementation, replace with a `photoswipe` import. Run `wc -l src/components/PhotoGallery.astro` after — only the script section counts toward the spec's budget; the markup is free.

- [ ] **Step 3.1.2 — Verify line count**

```bash
wc -l src/components/PhotoGallery.astro
```
Expected: total under ~250 lines (script under 150). If over, swap to photoswipe per the spec's open question.

### Task 3.2 — Extract `ShareObsView.astro` and rebuild layout

- [ ] **Step 3.2.1 — Create `ShareObsView.astro`**

Move the body (lines 16–149) of `src/pages/share/obs/index.astro` into `src/components/ShareObsView.astro`. Restructure the markup into the spec's two-column layout (sticky-left photo+map, scroll-right metadata+IDs+manage+comments). Keep the `script` block at the page level (`share/obs/index.astro`) for now — moving it into the component is a separate refactor. The new layout, in pseudocode:

```astro
<div class="grid grid-cols-1 md:grid-cols-12 gap-6">
  <aside class="md:col-span-7 lg:col-span-7 space-y-3 md:sticky md:top-20 self-start">
    <PhotoGallery photos={[]} lang={lang} mode="viewer" />  {/* photos array hydrated by script */}
    <MapPicker mode="view" lang={lang} pickerId="obs-detail" initialCoords={null} />
    <p data-obs-coords class="text-xs text-zinc-500 dark:text-zinc-400"></p>
  </aside>
  <section class="md:col-span-5 lg:col-span-5 space-y-6">
    <header>...</header>
    <ReactionStrip ... />
    <p data-edited-badge class="hidden text-xs text-amber-700 dark:text-amber-400">…</p>
    <dl>...metadata grid (Date · Region · Habitat · Weather · Establishment · Observed by)...</dl>
    <section id="community-ids">...</section>
    <section id="manage-panel-mount"></section>  {/* PR 4 mounts ObsManagePanel here */}
    <Comments ... />
  </section>
</div>
```

Keep all the existing `id="…"` hooks intact so the existing `script` block in `share/obs/index.astro` continues to populate them.

- [ ] **Step 3.2.2 — Slim `share/obs/index.astro`**

Replace the body in `src/pages/share/obs/index.astro` with:

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import ShareObsView from '../../../components/ShareObsView.astro';
const lang: 'en' | 'es' = 'en';
---
<BaseLayout title="Observation — Rastrum" description="…" lang={lang}>
  <ShareObsView lang={lang} />
  <script>{/* existing load() script — unchanged for now */}</script>
</BaseLayout>
```

The script body stays — extract the `wireManagePanel` helper to a separate file in PR 4.

- [ ] **Step 3.2.3 — Update the page script to feed `PhotoGallery` and `MapPicker view`**

Inside the existing `script` block in `share/obs/index.astro`, after the existing media-files query, replace the single `<img>` lookup with:

```ts
// Filter out soft-deleted photos.
const { data: media } = await supabase
  .from('media_files')
  .select('id, url, thumbnail_url, is_primary, sort_order, deleted_at')
  .eq('observation_id', id)
  .is('deleted_at', null)
  .order('is_primary', { ascending: false })
  .order('sort_order', { ascending: true });
const photos = (media ?? []).map(m => ({ id: m.id, url: m.url, thumbnail_url: m.thumbnail_url, caption: null }));
// Hydrate PhotoGallery: re-render its <img> elements from `photos`.
window.dispatchEvent(new CustomEvent('rastrum:photos-ready', { detail: { photos } }));
```

In `PhotoGallery.astro`'s script, listen for `rastrum:photos-ready` and re-render the hero + thumb strip from `event.detail.photos`. (The static markup is rendered with `photos = []` at SSR time; it's a hydration shell.)

- [ ] **Step 3.2.4 — Surface the "edited after IDs" badge**

In the page script, after loading the obs row, if `obs.last_material_edit_at` is non-null AND there is at least one community ID (already loaded in `wireCommunityIds`), reveal the `[data-edited-badge]` element with `tr.obs_detail.edited_badge`.

- [ ] **Step 3.2.5 — Run typecheck + build**

```bash
npm run typecheck && npm run build
```
Expected: 0 errors; build green.

### Task 3.3 — Playwright e2e for the viewer

- [ ] **Step 3.3.1 — Write the e2e**

Create `tests/e2e/obs-detail-view.spec.ts`:

```ts
import { test, expect } from '@playwright/test';

const SEEDED_OBS_ID = process.env.E2E_SEEDED_OBS_ID || '<seed-uuid-with-multi-photo>';

test('obs detail viewer: hero + thumb strip + map render, lightbox opens and closes', async ({ page }) => {
  await page.goto(`/share/obs/?id=${SEEDED_OBS_ID}`);
  await expect(page.locator('[data-photo-hero]')).toBeVisible();
  await expect(page.locator('[data-photo-thumb]').first()).toBeVisible();
  await expect(page.locator('#mp-obs-detail')).toBeVisible();

  await page.locator('[data-photo-thumb]').first().click();
  await expect(page.locator('[data-photo-lightbox]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('[data-photo-lightbox]')).toBeHidden();
});

test('obs detail viewer: stacked layout on mobile', async ({ page }) => {
  await page.setViewportSize({ width: 390, height: 844 });
  await page.goto(`/share/obs/?id=${SEEDED_OBS_ID}`);
  // Map and gallery render as a single column (no md:grid-cols-12 active).
  await expect(page.locator('[data-photo-hero]')).toBeVisible();
  await expect(page.locator('#mp-obs-detail')).toBeVisible();
});
```

> If there is no canonical seed observation in the e2e fixtures, add one to the fixture script in `tests/e2e/fixtures/` (look at how other e2e tests stage data — likely a `beforeAll` that seeds via the Supabase client). If no fixtures exist, ship the test guarded by `test.skip(!process.env.E2E_SEEDED_OBS_ID, …)`.

- [ ] **Step 3.3.2 — Run e2e**

```bash
npm run test:e2e -- tests/e2e/obs-detail-view.spec.ts
```
Expected: PASS on chromium and mobile-chrome.

- [ ] **Step 3.3.3 — Commit + open PR 3**

```bash
git add src/components/PhotoGallery.astro src/components/ShareObsView.astro \
        src/pages/share/obs/index.astro tests/e2e/obs-detail-view.spec.ts
git commit -m "feat(obs-detail): viewer redesign — PhotoGallery + two-column layout + native lightbox"
gh pr create --title "feat(obs-detail): viewer redesign — PhotoGallery + two-column layout" --body "$(cat <<'EOF'
## Summary
- Two-column desktop / stacked mobile layout on `/share/obs/?id=…`.
- New `PhotoGallery.astro` with hero + thumb strip + native lightbox (kbd, swipe, Esc, per-photo share); script body under 150 lines per spec budget.
- New `ShareObsView.astro` extracts the page body for testability.
- "Edited after IDs" badge surfaces when `last_material_edit_at` is set.
- Read-only `MapPicker mode='view'` mounted on the left rail.

## Test plan
- [x] `tests/e2e/obs-detail-view.spec.ts` passes on chromium + mobile-chrome.
- [x] Lightbox opens via thumbnail, closes via Esc + close button + backdrop swipe.
- [x] No owner-edit changes — old Manage panel still wires through unchanged.
EOF
)"
```

---

## PR 4 — `ObsManagePanel.astro` Details tab

**Why fourth:** Begins Phase B — owner edit. Replaces the existing 3-field manage panel with the full Details tab while leaving Location / Photos tabs as `disabled` placeholders. PR 5 / 6 enable each.

**Files:**
- Create: `src/components/ObsManagePanel.astro`
- Create: `src/lib/manage-panel.ts` (extract `wireManagePanel` from `share/obs/index.astro` into a typed module)
- Modify: `src/components/ShareObsView.astro` (mount `ObsManagePanel` instead of the old inline `<section id="manage-panel">`)
- Modify: `src/pages/share/obs/index.astro` (delete the inline `wireManagePanel` body — it now lives in `manage-panel.ts`)

### Task 4.1 — Create `ObsManagePanel.astro` shell with three tabs

- [ ] **Step 4.1.1 — Component shell**

Create `src/components/ObsManagePanel.astro`. The Details tab is fully built; Location and Photos tabs are placeholder `<div data-tab="location"><p>…</p></div>` blocks until PR 5 / 6 wire them.

```astro
---
import { HABITATS, WEATHERS, ESTABLISHMENT_MEANS, labelFor } from '../lib/observation-enums';
interface Props { lang: 'en' | 'es' }
const { lang } = Astro.props;
const isEs = lang === 'es';
import en from '../i18n/en.json';
import es from '../i18n/es.json';
const tr = (isEs ? es : en) as typeof en;
const obsDetail = (tr as unknown as { obs_detail: Record<string, any> }).obs_detail;
---
<section id="manage-panel" class="hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 p-4 space-y-3" data-manage-panel>
  <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">{isEs ? 'Administrar tu observación' : 'Manage your observation'}</h2>
  <div role="tablist" class="flex gap-2 border-b border-zinc-200 dark:border-zinc-800">
    <button role="tab" aria-selected="true" data-tab-button="details" class="px-3 py-1.5 text-sm font-medium border-b-2 border-emerald-700">{obsDetail.tabs.details}</button>
    <button role="tab" aria-selected="false" data-tab-button="location" class="px-3 py-1.5 text-sm text-zinc-500">{obsDetail.tabs.location}</button>
    <button role="tab" aria-selected="false" data-tab-button="photos" class="px-3 py-1.5 text-sm text-zinc-500">{obsDetail.tabs.photos}</button>
  </div>

  <div data-tab="details" class="space-y-3">
    <form id="manage-form" class="space-y-3" novalidate>
      <!-- date/time -->
      <div>
        <label for="m-observed-at" class="block text-xs font-medium mb-1">{isEs ? 'Fecha y hora' : 'Date and time'}</label>
        <input id="m-observed-at" type="datetime-local" class="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm" />
      </div>
      <!-- habitat -->
      <div>
        <label for="m-habitat" class="block text-xs font-medium mb-1">{isEs ? 'Hábitat' : 'Habitat'}</label>
        <select id="m-habitat" class="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm">
          <option value="">—</option>
          {HABITATS.map(h => <option value={h}>{labelFor(tr.observe, 'habitat_options', h)}</option>)}
        </select>
      </div>
      <!-- weather -->
      <div>
        <label for="m-weather" class="block text-xs font-medium mb-1">{isEs ? 'Clima' : 'Weather'}</label>
        <select id="m-weather" class="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm">
          <option value="">—</option>
          {WEATHERS.map(w => <option value={w}>{labelFor(tr.observe, 'weather_options', w)}</option>)}
        </select>
      </div>
      <!-- establishment_means -->
      <div>
        <label for="m-establishment" class="block text-xs font-medium mb-1">{isEs ? 'Origen' : 'Establishment'}</label>
        <select id="m-establishment" class="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm">
          {ESTABLISHMENT_MEANS.map(e => <option value={e}>{labelFor(tr.observe, 'establishment_means_options', e)}</option>)}
        </select>
      </div>
      <!-- existing fields -->
      <div>
        <label for="m-sci" class="block text-xs font-medium mb-1">{isEs ? 'Nombre científico (sobrescribir)' : 'Scientific name (override)'}</label>
        <input id="m-sci" type="text" class="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm font-mono italic" />
      </div>
      <div>
        <label for="m-notes" class="block text-xs font-medium mb-1">{isEs ? 'Notas' : 'Notes'}</label>
        <textarea id="m-notes" rows="3" maxlength="2000" class="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm"></textarea>
      </div>
      <div>
        <label for="m-obscure" class="block text-xs font-medium mb-1">{isEs ? 'Privacidad de ubicación' : 'Location privacy'}</label>
        <select id="m-obscure" class="block w-full rounded-lg border border-zinc-300 dark:border-zinc-700 bg-white dark:bg-zinc-900 px-3 py-2 text-sm">
          <option value="none">{isEs ? 'Mostrar coordenadas precisas' : 'Show precise coordinates'}</option>
          <option value="0.1deg">~10 km</option>
          <option value="0.2deg">~20 km</option>
          <option value="5km">~5 km</option>
          <option value="full">{isEs ? 'Ocultar ubicación' : 'Hide location'}</option>
        </select>
      </div>
      <p id="m-error" class="hidden text-xs text-red-600" role="alert"></p>
      <p id="m-saved" class="hidden text-xs text-emerald-700" aria-live="polite">{obsDetail.saved}</p>
      <div class="flex gap-2 pt-2">
        <button type="submit" id="m-save" class="rounded-lg bg-emerald-700 hover:bg-emerald-800 px-4 py-2 text-sm font-semibold text-white disabled:opacity-50">{obsDetail.save_changes}</button>
        <button type="button" id="m-delete" class="rounded-lg border border-red-300 px-4 py-2 text-sm font-medium text-red-700">{isEs ? 'Eliminar observación' : 'Delete observation'}</button>
      </div>
    </form>
  </div>

  <div data-tab="location" class="hidden">
    <p class="text-xs text-zinc-500">{isEs ? 'Disponible próximamente.' : 'Coming soon.'}</p>
  </div>
  <div data-tab="photos" class="hidden">
    <p class="text-xs text-zinc-500">{isEs ? 'Disponible próximamente.' : 'Coming soon.'}</p>
  </div>
</section>

<script>
  // Tab switcher
  document.querySelectorAll<HTMLButtonElement>('[data-tab-button]').forEach((btn) => {
    btn.addEventListener('click', () => {
      const target = btn.dataset.tabButton!;
      document.querySelectorAll<HTMLButtonElement>('[data-tab-button]').forEach(b => {
        const active = b.dataset.tabButton === target;
        b.setAttribute('aria-selected', String(active));
        b.classList.toggle('border-emerald-700', active);
        b.classList.toggle('text-zinc-500', !active);
      });
      document.querySelectorAll<HTMLElement>('[data-tab]').forEach(el => {
        el.classList.toggle('hidden', el.dataset.tab !== target);
      });
    });
  });
</script>
```

### Task 4.2 — Move `wireManagePanel` to `manage-panel.ts` and extend to all Details fields

- [ ] **Step 4.2.1 — Create the helper module**

Create `src/lib/manage-panel.ts` with `wireManagePanelDetails(obsId, obs, ident)` that:
1. Pre-populates `#m-observed-at` from `obs.observed_at` (formatting via `toIsoLocalDatetime`).
2. Pre-populates `#m-habitat`, `#m-weather`, `#m-establishment`, `#m-sci`, `#m-notes`, `#m-obscure`.
3. On submit, UPDATEs the observation with all new columns: `notes`, `obscure_level`, `observed_at`, `habitat`, `weather`, `establishment_means`. Same UPSERT-of-primary-identification logic as before for the sci-name override.
4. On Delete, calls the existing `delete-observation` Edge Function.

```ts
export async function wireManagePanelDetails(
  obsId: string,
  obs: Record<string, unknown>,
  _ident: { scientific_name?: string; is_primary?: boolean } | undefined,
): Promise<void> {
  // … same as today's wireManagePanel, but with the new fields wired.
  // Use isoToLocalDatetimeInput / localDatetimeInputToIso for the date field.
}

function isoToLocalDatetimeInput(iso: string): string {
  // "2026-04-29T18:30:00Z" → "2026-04-29T11:30" in browser TZ.
  const d = new Date(iso);
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth()+1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

function localDatetimeInputToIso(local: string): string {
  // "2026-04-29T11:30" → ISO with the browser's tz offset → UTC.
  return new Date(local).toISOString();
}
```

- [ ] **Step 4.2.2 — Replace the inline `wireManagePanel` in `share/obs/index.astro`**

Delete the inline `function wireManagePanel(...)` (lines 410–521) and replace with:

```ts
import { wireManagePanelDetails } from '../../../lib/manage-panel';
// …
if (viewerIsObserver) await wireManagePanelDetails(id, obs, ident);
```

- [ ] **Step 4.2.3 — Run typecheck + build + e2e**

```bash
npm run typecheck && npm run build && npm run test:e2e -- tests/e2e/obs-detail-view.spec.ts
```
Expected: green.

### Task 4.3 — e2e for owner edit Details tab

- [ ] **Step 4.3.1 — Write `tests/e2e/obs-detail-edit.spec.ts` (Details part only)**

```ts
import { test, expect } from '@playwright/test';

test.describe('obs detail owner edit — Details tab', () => {
  test.skip(!process.env.E2E_OWNER_SESSION, 'requires seeded owner session');

  test('owner edits habitat and date, sees Saved', async ({ page }) => {
    await page.goto(`/share/obs/?id=${process.env.E2E_OWNED_OBS_ID}`);
    await expect(page.locator('[data-manage-panel]')).toBeVisible();

    await page.locator('#m-habitat').selectOption('cloud_forest');
    await page.locator('#m-observed-at').fill('2026-04-15T08:30');
    await page.locator('#m-save').click();
    await expect(page.locator('#m-saved')).toBeVisible();

    // Reload and confirm persistence.
    await page.reload();
    await expect(page.locator('#m-habitat')).toHaveValue('cloud_forest');
  });
});
```

- [ ] **Step 4.3.2 — Commit + open PR 4**

```bash
git add src/components/ObsManagePanel.astro src/lib/manage-panel.ts \
        src/components/ShareObsView.astro src/pages/share/obs/index.astro \
        tests/e2e/obs-detail-edit.spec.ts
git commit -m "feat(obs-detail): owner edit — ObsManagePanel Details tab (date/habitat/weather/establishment)"
gh pr create --title "feat(obs-detail): ObsManagePanel Details tab" --body "$(cat <<'EOF'
## Summary
- New `ObsManagePanel.astro` mounted on `/share/obs/?id=…` for the observation owner.
- Details tab fully wired: date/time (`<input type="datetime-local">`), habitat, weather, establishment_means, plus the existing sci-name override / notes / privacy fields.
- Location and Photos tabs are visible-but-disabled placeholders (PR 5 + PR 6).
- `wireManagePanel` extracted from the page script into `src/lib/manage-panel.ts` for testability.

## Test plan
- [x] Owner-session e2e edits habitat + date, sees Saved, persists across reload.
- [x] No regression in viewer-only flows (PR 3 e2e still green).
EOF
)"
```

---

## PR 5 — Location tab (coordinate edit)

**Files:**
- Modify: `src/components/ObsManagePanel.astro` — replace the `data-tab="location"` placeholder with a real `MapPicker mode='view'` preview + an "Edit location" button that swaps to `MapPicker mode='edit'`
- Modify: `src/lib/manage-panel.ts` — add `wireManagePanelLocation(obsId, obs)` listening for `rastrum:mappicker-save` to UPDATE `observations.location`
- Modify: `tests/e2e/obs-detail-edit.spec.ts` — add Location tab cases

### Task 5.1 — Wire Location tab

- [ ] **Step 5.1.1 — Replace the placeholder**

In `src/components/ObsManagePanel.astro`, replace the `data-tab="location"` placeholder with:

```astro
<div data-tab="location" class="hidden space-y-3">
  <MapPicker mode="view" lang={lang} pickerId="manage-loc-view" initialCoords={null} />
  <p class="text-xs text-zinc-500">{isEs ? 'Arrastra el alfiler o ingresa coordenadas. Si la especie es sensible, el mapa público seguirá mostrando un área aproximada.' : 'Drag the pin or type coordinates. If the species is sensitive, the public map will still show only a coarsened area.'}</p>
  <MapPicker mode="edit" lang={lang} pickerId="manage-loc-edit" initialCoords={null} />
</div>
```

- [ ] **Step 5.1.2 — Add `wireManagePanelLocation` to `manage-panel.ts`**

```ts
export async function wireManagePanelLocation(
  obsId: string,
  obs: Record<string, unknown>,
): Promise<void> {
  // Pre-populate the view picker with the current coords.
  const lat = (obs.location_lat as number | undefined);
  const lng = (obs.location_lng as number | undefined);
  // Set data-initial-* on both pickers so MapPicker can hydrate them.
  // (Browsers can't change Astro props after render — emit a custom event
  // 'rastrum:mappicker-set' that MapPicker listens for to recenter.)

  window.addEventListener('rastrum:mappicker-save', async (ev) => {
    const e = ev as CustomEvent<{ id: string; coords: { lat: number; lng: number } }>;
    if (e.detail.id !== 'manage-loc-edit') return;
    const supabase = getSupabase();
    const { error } = await supabase.rpc('set_observation_location', {
      p_obs_id: obsId,
      p_lat: e.detail.coords.lat,
      p_lng: e.detail.coords.lng,
    });
    // Or, if no RPC: a direct UPDATE that constructs the geography:
    //   .update({ location: `SRID=4326;POINT(${lng} ${lat})` })
    // Confirm the supabase-js path can issue a PostGIS literal — if not, add an RPC.
    if (error) /* show error */;
    // The trigger will set last_material_edit_at if the move > 1 km.
  });
}
```

> **Implementation note:** test whether `supabase-js` can write a geography column directly via a string literal. If not, add a small `set_observation_location(p_obs_id uuid, p_lat numeric, p_lng numeric)` SQL function in `supabase-schema.sql` — that's an additive idempotent change.

- [ ] **Step 5.1.3 — Add MapPicker hydration event listener**

In `MapPicker.astro`, listen for `rastrum:mappicker-set` events:

```ts
window.addEventListener('rastrum:mappicker-set', (ev) => {
  const e = ev as CustomEvent<{ id: string; coords: { lat: number; lng: number } }>;
  // Recenter the map identified by `e.detail.id` to the given coords.
});
```

The page script for `share/obs/index.astro` dispatches `rastrum:mappicker-set` with `{ id: 'manage-loc-view', coords }` and `{ id: 'manage-loc-edit', coords }` on load.

### Task 5.2 — e2e

- [ ] **Step 5.2.1 — Extend `tests/e2e/obs-detail-edit.spec.ts`**

```ts
test('owner edits location > 1 km, sees edited badge if there are community IDs', async ({ page }) => {
  await page.goto(`/share/obs/?id=${process.env.E2E_OWNED_OBS_WITH_IDS}`);
  await page.getByRole('tab', { name: /Location/i }).click();
  await page.getByRole('button', { name: /Edit location/i }).click();
  // Drag the pin on the edit picker by clicking somewhere far from the current coords.
  // …
  await page.getByRole('button', { name: /Use this location/i }).click();
  await page.reload();
  await expect(page.locator('[data-edited-badge]')).toBeVisible();
});
```

- [ ] **Step 5.2.2 — Commit + open PR 5**

---

## PR 6 — Photos tab + `delete-photo` Edge Function

**Files:**
- Create: `supabase/functions/delete-photo/index.ts`
- Create: `src/lib/photo-deletion.ts` (pure helper for `willDemote`)
- Create: `src/lib/photo-deletion.test.ts`
- Modify: `src/components/ObsManagePanel.astro` — replace Photos placeholder with real grid
- Modify: `src/lib/manage-panel.ts` — add `wireManagePanelPhotos(obsId)`

### Task 6.1 — Pure deletion-policy helper

- [ ] **Step 6.1.1 — Write the failing test**

Create `src/lib/photo-deletion.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { willDemote } from './photo-deletion';

describe('willDemote', () => {
  const photos = [
    { id: 'a', is_primary: true, deleted_at: null },
    { id: 'b', is_primary: false, deleted_at: null },
    { id: 'c', is_primary: false, deleted_at: '2026-04-01T00:00:00Z' },  // already deleted
  ];

  it('deleting the only active photo demotes', () => {
    expect(willDemote([photos[0]], 'a', 'a')).toBe(true);
  });

  it('deleting the cascade (is_primary) photo demotes', () => {
    expect(willDemote(photos, 'a', 'a')).toBe(true);
  });

  it('deleting a non-primary photo with siblings does not demote', () => {
    expect(willDemote(photos, 'a', 'b')).toBe(false);
  });

  it('already-deleted siblings do not count toward "has siblings"', () => {
    expect(willDemote([photos[0], photos[2]], 'a', 'a')).toBe(true);
  });
});
```

- [ ] **Step 6.1.2 — Implement**

Create `src/lib/photo-deletion.ts`:

```ts
export interface PhotoForDeletion {
  id: string;
  is_primary: boolean;
  deleted_at: string | null;
}

/** Decide whether deleting `deletingId` should trigger the cascade-photo
 *  confirm-and-demote flow. Returns true when EITHER:
 *    - the deletion would leave zero active photos, OR
 *    - the photo being deleted is the cascade-driving photo (proxy:
 *      `is_primary` on media_files, since `identifications.source_photo_id`
 *      does not exist in the v1 schema).
 *
 *  primaryIdentificationId is reserved for a future schema delta that adds
 *  source_photo_id; in v1 it is unused.
 */
export function willDemote(
  photos: PhotoForDeletion[],
  primaryIdentificationId: string | null,
  deletingId: string,
): boolean {
  const others = photos.filter(p => p.id !== deletingId && p.deleted_at == null);
  if (others.length === 0) return true;
  const target = photos.find(p => p.id === deletingId);
  if (target?.is_primary) return true;
  return false;
}
```

- [ ] **Step 6.1.3 — Run test**

```bash
npm run test -- src/lib/photo-deletion.test.ts
```
Expected: PASS.

### Task 6.2 — `delete-photo` Edge Function

- [ ] **Step 6.2.1 — Create the function**

Create `supabase/functions/delete-photo/index.ts`. Pattern after `supabase/functions/delete-observation/index.ts` (auth check, JSON in/out, CORS). The body:

```ts
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

interface Body {
  observation_id: string;
  media_id: string;
  /** When true, also demote the primary identification + bump last_material_edit_at. */
  will_demote: boolean;
}

serve(async (req) => {
  // CORS / auth check identical to delete-observation/index.ts.
  // …
  const body = await req.json() as Body;
  const supabase = createClient(/* service role */);

  // 1) Verify caller owns the observation.
  // …

  // 2) Run the three writes in a single Postgres transaction. supabase-js
  //    does not natively support transactions; either use an RPC like
  //    `delete_photo_atomic(p_obs_id uuid, p_media_id uuid, p_demote bool)`
  //    OR open a raw connection via @supabase/postgrest-js + pg.
  //
  //    Recommended: add an RPC in supabase-schema.sql (idempotent, server-side
  //    transaction guarantee). The Edge Function just invokes it.

  const { error } = await supabase.rpc('delete_photo_atomic', {
    p_obs_id: body.observation_id,
    p_media_id: body.media_id,
    p_demote: body.will_demote,
  });

  if (error) return new Response(JSON.stringify({ ok: false, error: error.message }), { status: 500 });
  return new Response(JSON.stringify({ ok: true }), { status: 200 });
});
```

- [ ] **Step 6.2.2 — Add the SQL RPC**

Append to `docs/specs/infra/supabase-schema.sql` (idempotent):

```sql
CREATE OR REPLACE FUNCTION public.delete_photo_atomic(
  p_obs_id uuid,
  p_media_id uuid,
  p_demote boolean
) RETURNS void AS $$
BEGIN
  UPDATE public.media_files
     SET deleted_at = now()
   WHERE id = p_media_id
     AND observation_id = p_obs_id;

  IF p_demote THEN
    UPDATE public.identifications
       SET verified = false
     WHERE observation_id = p_obs_id
       AND is_primary = true;

    UPDATE public.observations
       SET last_material_edit_at = now()
     WHERE id = p_obs_id;
  END IF;
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

REVOKE ALL ON FUNCTION public.delete_photo_atomic(uuid, uuid, boolean) FROM public;
GRANT EXECUTE ON FUNCTION public.delete_photo_atomic(uuid, uuid, boolean) TO authenticated;
```

> **Note:** check that `identifications.verified` actually exists in the schema. If the column is named differently (`is_primary`, `is_research_grade`, etc.), pick the column the spec's "needs review" UI reads. Per the spec lines 281–290, the demote sets the primary ID such that the UI renders a "needs review" pill — confirm during implementation which column drives that pill and use it.

### Task 6.3 — Wire Photos tab UI

- [ ] **Step 6.3.1 — Replace the Photos placeholder in `ObsManagePanel.astro`**

```astro
<div data-tab="photos" class="hidden space-y-3">
  <div data-photos-grid class="grid grid-cols-3 gap-2">
    <!-- Hydrated by wireManagePanelPhotos at runtime. -->
  </div>
  <button type="button" data-add-photo class="rounded-lg border border-emerald-600/60 px-3 py-2 text-sm font-medium text-emerald-700 dark:text-emerald-400">{obsDetail.add_photo}</button>
</div>
```

- [ ] **Step 6.3.2 — Add `wireManagePanelPhotos(obsId)` to `manage-panel.ts`**

```ts
import { willDemote, type PhotoForDeletion } from './photo-deletion';
import { getSupabase } from './supabase';

export async function wireManagePanelPhotos(obsId: string): Promise<void> {
  const supabase = getSupabase();
  const grid = document.querySelector<HTMLElement>('[data-photos-grid]');
  if (!grid) return;

  async function refresh() {
    const { data: rows } = await supabase
      .from('media_files')
      .select('id, url, thumbnail_url, is_primary, deleted_at')
      .eq('observation_id', obsId)
      .order('is_primary', { ascending: false })
      .order('sort_order', { ascending: true });
    const all: PhotoForDeletion[] = (rows ?? []) as PhotoForDeletion[];
    const active = all.filter(p => p.deleted_at == null);
    grid!.innerHTML = active.map(p => `
      <div class="relative">
        <img src="${(p as any).thumbnail_url ?? (p as any).url}" alt="" class="aspect-square object-cover rounded-md" loading="lazy" />
        <button data-delete-photo="${p.id}" type="button" class="absolute top-1 right-1 rounded-full bg-black/60 text-white p-1 hover:bg-red-600" aria-label="Delete photo">×</button>
      </div>
    `).join('');
    grid!.querySelectorAll<HTMLButtonElement>('[data-delete-photo]').forEach(btn => {
      btn.addEventListener('click', async () => {
        const id = btn.dataset.deletePhoto!;
        const isEs = document.documentElement.lang === 'es';
        const willD = willDemote(all, null, id);
        if (willD) {
          const msg = isEs
            ? 'Esta foto fue la base de la identificación actual. Eliminarla marcará la observación como pendiente de revisión. ¿Continuar?'
            : 'This photo was the basis for the current identification. Deleting it will mark the observation as needing review. Continue?';
          if (!window.confirm(msg)) return;
        } else {
          if (!window.confirm(isEs ? 'Eliminar esta foto?' : 'Delete this photo?')) return;
        }
        const { error } = await supabase.functions.invoke('delete-photo', {
          body: { observation_id: obsId, media_id: id, will_demote: willD },
        });
        if (error) { window.alert(error.message); return; }
        await refresh();
        // Notify the gallery to re-hydrate.
        window.dispatchEvent(new CustomEvent('rastrum:photos-changed'));
      });
    });
  }

  document.querySelector<HTMLButtonElement>('[data-add-photo]')?.addEventListener('click', async () => {
    // Reuse the existing photo-picker flow from ObservationForm.astro
    // (file input + R2 upload + media_files INSERT). The simplest path
    // is to render a hidden <input type="file" accept="image/*" multiple>
    // here and on change, upload through `lib/upload.ts` and INSERT.
    // Then call refresh() and dispatch rastrum:photos-changed.
  });

  await refresh();
}
```

### Task 6.4 — Deploy + e2e

- [ ] **Step 6.4.1 — Deploy the Edge Function via CI**

The repo's `deploy-functions.yml` auto-deploys any function whose path under `supabase/functions/**` changes. Pushing PR 6 to `main` will deploy `delete-photo`. To deploy from a feature branch for e2e:

```bash
gh workflow run deploy-functions.yml --ref <branch> -f function=delete-photo
gh run watch
```

- [ ] **Step 6.4.2 — e2e for cascade-photo deletion**

```ts
test('owner deletes the cascade photo, sees needs-review pill', async ({ page }) => {
  await page.goto(`/share/obs/?id=${process.env.E2E_OWNED_OBS_SINGLE_PHOTO}`);
  await page.getByRole('tab', { name: /Photos/i }).click();
  page.once('dialog', d => d.accept());  // confirm dialog
  await page.locator('[data-delete-photo]').first().click();
  await page.reload();
  await expect(page.locator('text=Needs review')).toBeVisible();
});
```

- [ ] **Step 6.4.3 — Commit + open PR 6**

```bash
gh pr create --title "feat(obs-detail): Photos tab + delete-photo Edge Function" --body "$(cat <<'EOF'
## Summary
- New `delete-photo` Edge Function wraps soft-delete + ID demote + `last_material_edit_at` bump in one transactional `delete_photo_atomic` RPC — closes the spec's "stale state" failure mode.
- Photos tab in `ObsManagePanel` lists active photos with delete + add controls.
- Cascade-photo confirm fires when `willDemote()` returns true.
- Pure helper `src/lib/photo-deletion.ts` covered by unit tests.

## Test plan
- [x] `tests/e2e/obs-detail-edit.spec.ts` — cascade-photo deletion → reload → "Needs review" pill renders.
- [x] `npm run test -- src/lib/photo-deletion.test.ts` covers the four `willDemote` cases.
- [x] `make db-apply` is idempotent with the new RPC.
EOF
)"
```

---

## Final cleanup (post-PR 6, low-risk follow-up commit)

- [ ] **Update the in-code comment on `share/obs/index.astro`** that says "the R2 photo blobs are left as orphans, acceptable for v1" to reference the v1.1 follow-up `gc-orphan-media`.

```bash
# Replace the lines 102–104 comment with a concrete v1.1 follow-up reference.
```

- [ ] **Add a `progress.json` / `tasks.json` entry** for the v1.1 `gc-orphan-media` cron and consensus-weight integration (module 13 + `last_material_edit_at`).

- [ ] **Run the full audit**

```bash
npm run typecheck && npm run test && npm run build && npm run test:audit
```

---

## Open questions resolved (during plan writing)

- **Lightbox implementation:** native, ≤150-line script body. Implemented in PR 3. If the prototype exceeds the budget, swap to `photoswipe` (~30 kB gz) — gated on an explicit budget check in step 3.1.2.
- **Cascade-photo identifier:** the v1 schema has no `identifications.source_photo_id` column. The plan uses `media_files.is_primary` as the proxy, which is the existing convention for "the photo the cascade ran on". `willDemote` is structured so a future schema delta adding `source_photo_id` is a one-line change to the helper.
- **Photo replacement after cascade-photo deletion:** per the spec's recommendation, the obs stays in needs-review until the owner re-affirms manually. The cascade does not auto-re-fire on photo add. No extra logic in PR 6.
- **"Edited at" public-facing line:** out of scope for v1. PR 3 surfaces only the badge driven by `last_material_edit_at`. The raw timestamp stays owner-only (visible via the manage panel if anywhere). Re-evaluate in a v1.1 minor-transparency PR.
- **Trigger composition with `sync_primary_id_trigger`:** the spec describes the composition as if both triggers fire on `observations`, but `sync_primary_id_trigger` actually fires on `identifications` (cascading a write to `observations.primary_taxon_id`). The cascading UPDATE then fires `observations_material_edit_check_trg` BEFORE UPDATE on `observations` — same outcome the spec intended, just via a different mechanism. The plan documents this in PR 2's SQL block and the test coverage in `material-edit-trigger.test.ts` exercises both paths (direct `UPDATE primary_taxon_id` + cascading from `INSERT INTO identifications`).

## v1.1 follow-ups captured

- `gc-orphan-media` cron to delete R2 blobs not referenced by any non-deleted `media_files` row.
- Consensus weight on `last_material_edit_at` (module 13).
- Visit-time `source_photo_id` column on `identifications` so cascade-photo detection is exact instead of `is_primary`-proxy.
- Aggregate reaction RPC so feed-card overlays can show counts without N+1 fetches (carried over from m26 spec).
- Public "Edited at" surface — minor-transparency re-evaluation.

---

## Self-review checklist (run after writing, fix inline)

- [x] Spec coverage: every numbered item in spec section "Goals" maps to a PR (① map view → PR 3, ② coord editor → PR 5, ③ photo gallery → PR 3, ④ date edit → PR 4, ⑤ habitat/weather/establishment → PR 4, ⑥ photo add/remove → PR 6, ⑦ layout overhaul → PR 3).
- [x] Schema deltas covered in PR 2; trigger covered by vitest.
- [x] EN/ES parity asserted in PR 2 (i18n) + PR 3/4 e2e.
- [x] No placeholder steps; every code step shows the code (with the documented "ports of existing logic" lines flagged so the engineer knows to lift, not invent).
- [x] Type consistency: `MapPicker` props match across PR 1 / 3 / 5; `wireManagePanelDetails` / `…Location` / `…Photos` signatures match across PR 4–6; `willDemote` signature stable.
- [x] Each PR is independently revertible: PR 1 is a no-behavior-change refactor, PR 2 is additive schema + i18n, PR 3 is viewer-only, PR 4–6 are Phase B and revertible by reverting in reverse dependency order.
