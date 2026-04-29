# Observation detail page redesign — viewer + owner edit

**Date:** 2026-04-29
**Status:** Design — pending user review
**Owner:** Artemio Padilla
**Related modules:** 03 (observations / media files), 06 (sensitive species + obscure_level), 13 (identifier registry / cascade), 22 (community validation), 25 (privacy ladder), 26 (social — reactions / follow on detail page).

---

## Goals

1. Turn `src/pages/share/obs/index.astro` from a single-column data dump into a **richer viewer** with map + photo gallery + a layout that respects the photo+map as the primary content.
2. Replace the 3-field "manage" form with a real **owner edit experience** — coordinate editor (the page's central pain point: today owners cannot fix wrong coordinates at all), date/time, full metadata (habitat / weather / establishment), photo add/remove.
3. Stay **zero-cost** on infrastructure. All map UX reuses the existing pmtiles + MapLibre stack already wired into `ObservationForm.astro` (lines 568–600 today). No new external services.
4. Ship clean **edit-after-IDs semantics** — owner edits never silently invalidate community-given IDs, but material edits (photo, location, date, primary name) are flagged so reviewers can re-affirm. Cascade-driving photo removal prompts the owner before demoting the primary ID.
5. Reuse the new map-picker component for the future v1.1 community heatmap, the existing observe form, and any other surface that needs map view/edit.

## Non-goals

- A full edit "republish" workflow (drafts, version history, edit notifications to followers). Edits are immediate and atomic; no draft state.
- Mod-curated observation showcases / featured-obs UX. Out of scope.
- Bulk edit (edit many observations at once). Single-obs only.
- A new identifier cascade run on photo replacement. The cascade fires only on the original create path; replacing photos does not re-trigger AI ID generation.
- Real R2 blob deletion. Soft-delete only for v1; an `gc-orphan-media` cron is a v1.1 follow-up.
- Restructuring the URL or making it locale-prefixed. The page stays at `/share/obs/?id=…` (locale-neutral, per the existing CLAUDE.md regression note).

---

## Decisions captured (brainstorming outcome)

| Axis | Decision | Rationale |
|---|---|---|
| Scope | **All 7 items in** (① map view, ② coord editor, ③ photo gallery, ④ date edit, ⑤ habitat/weather/establishment edit, ⑥ photo add/remove, ⑦ layout overhaul) | User confirmed full redesign over phased "minimum" |
| Layout | **Two-column desktop, stacked mobile.** Sticky photo + map on left, scrolling metadata + IDs + manage + comments on right | Matches iNaturalist / eBird / Observation.org idiom; preserves single-scroll mobile experience |
| Edit invalidation | **Minor / material split.** Material edits flag `last_material_edit_at` and surface an "edited after IDs" badge | Audit trail without silent ID invalidation; weight-down logic is a module 13 follow-up |
| Photo deletion | **Soft-delete only (v1).** R2 blobs left as orphans; `gc-orphan-media` cron is v1.1 | Cheapest and safest; matches current v1 policy in `share/obs/index.astro` comments |
| Cascade-driving photo removal | **Confirm dialog + demote primary ID to needs-review.** Identification record persists | Audit trail intact; UX is explicit and reversible (re-adding a photo doesn't auto-restore primary, owner re-affirms manually) |
| Map component | **Extract a reusable `MapPicker.astro`** from `ObservationForm.astro` lines 568–600 | The view/edit modes share 90% of code; extracting prevents drift and unlocks v1.1 community heatmap |
| Manage panel structure | **Tabs inside the manage panel** — `Details` / `Location` / `Photos` | Five+ editable surfaces become unwieldy in a single form; tabs keep each task focused |
| Date editing | **`<input type="datetime-local">`** | Native, free, accessible; matches the create form's pattern |
| Privacy of edits | **Edits inherit the existing `obscure_level` rules** | No new RLS policies; existing trigger handles re-coarsening on coord change |

---

## Layout

### Desktop (`md:` and up)

```
┌──────────────────────────────────────────────────────────────────────────┐
│ STICKY LEFT (md:w-1/2 lg:w-7/12, max 720px)                              │
│   Hero photo (16:10, max-h-[60vh], lazy-loaded)                          │
│   ▣ ▣ ▣ ▣ thumb strip (only if >1 photo)                                 │
│   ─────                                                                  │
│   Mini-map (h-[240px])                                                   │
│     📍 pin (precise / coarsened per obscure_level)                       │
│     "Coords: 19.500°N, 101.600°W (precise)" — owner only                 │
│     "Coords: ~19.5°N, ~101.6°W (10 km)" — public, sensitive species      │
│     [ Edit location ↗ ] — owner only, opens MapPicker(mode='edit')       │
├──────────────────────────────────────────────────────────────────────────┤
│ SCROLL RIGHT                                                             │
│   H1 species (italic) + meta line (date · observer link)                 │
│   FollowButton + ShareButton + Report button                             │
│   ReactionStrip (existing)                                               │
│   Sensitive species notice (existing, hidden by default)                 │
│   Metadata grid: Date · Region · Habitat · Weather · Establishment       │
│   Community IDs section (existing, with "edited after IDs" badge if      │
│       last_material_edit_at IS NOT NULL)                                 │
│   ───── (owner-only divider)                                             │
│   ObsManagePanel — owner-only, with internal tabs                        │
│     [ Details ] [ Location ] [ Photos ]                                  │
│   Comments (existing)                                                    │
└──────────────────────────────────────────────────────────────────────────┘
```

### Mobile (`< md:`)

Single column, stacked in this order:

```
1. Hero photo + thumb strip
2. Mini-map (h-[180px], coords below)
3. H1 + meta line
4. Action row: Follow · Share · Report
5. ReactionStrip
6. Sensitive notice
7. Metadata grid (2-col)
8. Community IDs
9. ObsManagePanel (owner only) — tabs work the same as desktop
10. Comments
```

The mobile and desktop layouts share 100% of the same components — the difference is purely Tailwind responsive classes on the outer grid container.

---

## New shared components

### `src/components/MapPicker.astro` (new)

Extracted from `ObservationForm.astro` lines 568–600. Accepts:

| Prop | Type | Notes |
|---|---|---|
| `mode` | `'view' \| 'edit'` | View = pin only, no drag, no save. Edit = draggable pin + lat/lng inputs + Save / Cancel buttons. |
| `initialCoords` | `{ lat: number; lng: number } \| null` | Initial pin position. `null` is valid in edit mode (drops pin at viewer's location or a default region). |
| `obscureLevel` | `'none' \| '5km' \| '0.1deg' \| '0.2deg' \| 'full'` | Drives both pin precision (in view mode) and the coarsening preview (in edit mode). |
| `lang` | `'en' \| 'es'` | i18n. |
| `onSelect` | `(coords) => void` | Edit-mode only; called when user clicks Save. |

Internally uses MapLibre + the existing `PUBLIC_PMTILES_MX_URL` pmtiles source. The `ObservationForm.astro` create flow migrates to consume this component (no behavior change there; this is pure refactor).

### `src/components/PhotoGallery.astro` (new)

| Prop | Type | Notes |
|---|---|---|
| `photos` | `Array<{ id; url; thumbnail_url; caption?; width?; height? }>` | Filtered already to `deleted_at IS NULL` rows. |
| `lang` | `'en' \| 'es'` | i18n. |
| `mode` | `'viewer' \| 'owner'` | Owner mode shows a delete button on each photo in the lightbox. |

Renders a hero photo + below-the-hero thumbnail strip (only when `photos.length > 1`). Click any thumbnail or the hero opens a full-screen lightbox with keyboard nav (← / →), swipe-on-mobile, Esc-to-close, and per-photo share button. Below-fold thumbnails get `loading="lazy"` per the existing CLAUDE.md convention.

### `src/components/ObsManagePanel.astro` (new)

Replaces the inline `<section id="manage-panel">` block in `share/obs/index.astro` (lines 105–135 today). Three internal tabs:

#### Details tab

- Scientific-name override (existing input).
- Date / time: `<input type="datetime-local">` bound to `observed_at` in the user's local timezone.
- Habitat: `<select>` reusing options from new `src/lib/observation-enums.ts`.
- Weather: `<select>` from same module.
- Establishment means: `<select>` from same module.
- Notes textarea (existing).
- Location-privacy `<select>` (existing).
- Save button.

#### Location tab

- Static map preview at the obs's current pin (read-only `MapPicker mode='view'`).
- "Edit location" button → opens `MapPicker mode='edit'` in a modal. Save persists new lat/lng to `observations`.
- Helper text: *"Drag the pin or type coordinates. If the species is sensitive, the public map will still show only a coarsened area."*

#### Photos tab

- Grid of current photos with delete button each.
- "Add photo" button at the bottom — opens the existing photo picker / camera flow from `ObservationForm.astro` and uploads via `lib/upload.ts` (R2 → `media_files` insert).
- Delete confirmation logic per Q3 below.

---

## Schema deltas

```sql
ALTER TABLE public.observations
  ADD COLUMN IF NOT EXISTS last_material_edit_at timestamptz;

ALTER TABLE public.media_files
  ADD COLUMN IF NOT EXISTS deleted_at timestamptz;

CREATE INDEX IF NOT EXISTS idx_media_files_active
  ON public.media_files (observation_id) WHERE deleted_at IS NULL;
```

### Material edit detection (trigger)

```sql
-- Composes with sync_primary_id_trigger (also BEFORE UPDATE on observations).
-- The sync trigger *writes* primary_taxon_id from the identifications table;
-- this trigger *reads* (compares NEW.primary_taxon_id vs OLD) to decide
-- whether to flag the row as materially edited. Different responsibilities,
-- no column-write contention, alphabetical trigger ordering is irrelevant.
CREATE OR REPLACE FUNCTION public.observations_material_edit_check()
RETURNS trigger AS $$
DECLARE
  is_material boolean := false;
BEGIN
  -- location moved more than 1 km
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

  -- primary taxon changed (denormalized from identifications by the existing
  -- sync_primary_id_trigger; covers the "scientific name override" case
  -- because changing the primary identification flows through that trigger)
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
```

The trigger fires `BEFORE UPDATE` and only mutates `last_material_edit_at` on `NEW`. It composes safely with the existing `sync_primary_id_trigger` (which propagates primary-identification changes into `observations.primary_taxon_id`): when an owner changes the primary ID, the sync trigger updates `primary_taxon_id`, this trigger then fires on the same UPDATE row and sees `NEW.primary_taxon_id IS DISTINCT FROM OLD.primary_taxon_id`. Trigger ordering is alphabetical by name in Postgres; `observations_material_edit_check_trg` sorts after any `sync_primary_…` name, but trigger ordering only matters when both triggers mutate the same column — they don't here, so the apparent ordering is irrelevant.

Photo material-edits — adding/removing photos — are detected in application code at the `media_files` insert/soft-delete site, which then issues `UPDATE observations SET last_material_edit_at = now() WHERE id = $1`. This UPDATE will pass through the trigger above; none of the watched columns (`location`, `observed_at`, `primary_taxon_id`) change, so the trigger is a no-op for that pass.

### RLS

No new RLS policies needed.

- `observations` UPDATE: existing policy already gates on `auth.uid() = observer_id`.
- `media_files` UPDATE (for soft-delete): existing policy gates on owner via the FK to `observations`.
- `media_files` INSERT (for add-photo): existing policy.

---

## Edit semantics — minor vs. material

| Edit | Class | Behavior |
|---|---|---|
| Notes change | Minor | `updated_at` bumps, no badge |
| Habitat / weather / establishment_means change | Minor | `updated_at` bumps, no badge |
| Location-privacy (`obscure_level`) change | Minor | `updated_at` bumps, sensitivity recomputed by existing trigger, no badge |
| Location move ≤ 1 km | Minor | `updated_at` bumps, no badge (small fixes don't invalidate IDs) |
| Location move > 1 km | **Material** | Trigger sets `last_material_edit_at` |
| Date moves ≤ 24 h | Minor | No badge |
| Date moves > 24 h | **Material** | Trigger sets `last_material_edit_at` |
| Primary taxon changes (via name override or accepted ID switch) | **Material** | `sync_primary_id_trigger` updates `primary_taxon_id`, this trigger flags it |
| Photo added | Minor | No badge (additive) |
| Photo removed | **Material** | Application sets `last_material_edit_at` |

The "edited after IDs" badge in the IDs section reads: *"Edited after IDs were given. Suggesters may want to re-affirm."* (EN) / *"Editado después de las identificaciones. Los sugerentes pueden querer reafirmar."* (ES).

The badge is suppressed when there are no community IDs yet (no one to alert). The badge persists indefinitely once set; there is no "clear edit history" UX in v1.

Module 13 (consensus weighting) will read `last_material_edit_at` in a follow-up; this spec only persists the column and surfaces the badge. Wire-up of consensus weight is a v1.1 follow-up captured in the implementation plan's open questions.

---

## Photo deletion semantics

### Soft-delete only

Clicking "Delete photo" in the Photos tab issues:

```sql
UPDATE public.media_files
   SET deleted_at = now()
 WHERE id = $1
   AND observation_id IN (SELECT id FROM observations WHERE observer_id = auth.uid());
```

The R2 blob is **not** deleted. Future GC cron `gc-orphan-media` (v1.1) walks R2 and removes blobs not referenced by any non-deleted `media_files` row. Documented as a known v1.0 limitation.

### Confirm-before-demote logic (Q3)

Before issuing the soft-delete, the client checks:

```ts
const willLeaveZeroPhotos = photos.filter(p => p.id !== id && !p.deleted_at).length === 0;
const isCascadePhoto = primaryIdentification?.source_photo_id === id;
const willDemote = willLeaveZeroPhotos || isCascadePhoto;
```

If `willDemote`, render confirm: *"This photo was the basis for the current identification. Deleting it will mark the observation as needing review. Continue?"*

On confirm, after the soft-delete UPDATE succeeds, the client (or — preferably — a `delete-photo` Edge Function for atomicity):

```sql
UPDATE public.identifications
   SET verified = false
 WHERE observation_id = $obs_id AND is_primary = true;

UPDATE public.observations
   SET last_material_edit_at = now()
 WHERE id = $obs_id;
```

The community-IDs section then renders a "needs review" pill on the primary ID. Owner can clear it by re-affirming manually (selecting a new primary identification, or making a new manual ID).

**Decision: server-side via a new `delete-photo` Edge Function.** The soft-delete + ID demote + `last_material_edit_at` bump must commit atomically. A client-side two-call implementation has a real failure mode: if the soft-delete succeeds and the user closes the tab before the demote call lands, the observation is left with no primary photo but an active primary ID — the exact "stale state" the spec is trying to prevent. Edge Functions wrap the operations in a single SQL transaction (`BEGIN ... COMMIT`) and return only after all three writes succeed.

The function lives at `supabase/functions/delete-photo/index.ts` and is deployed via the existing `deploy-functions.yml` workflow. RLS on `media_files` and `identifications` already gates writes to the owner; the function re-verifies `auth.uid() = observer_id` before issuing the transaction.

---

## i18n

Add to `src/i18n/{en,es}.json`:

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
  "errors": { "coords_invalid": "Latitude must be between −90 and 90, longitude between −180 and 180.", "save_failed": "Save failed. Please try again.", "upload_failed": "Photo upload failed. Please try again." }
}
```

Mirror in ES.

`src/lib/observation-enums.ts` (new) exports the option lists previously inline in `ObservationForm.astro` — `habitats`, `weathers`, `establishmentMeans`, plus their bilingual labels — so the create form and the manage panel share one source of truth.

---

## Tests

### Vitest

- `tests/obs-detail/material-edit-trigger.test.ts` — pglite (or seeded test DB) — table of input deltas → expected `last_material_edit_at` set / not set. Covers all branches of the trigger (coords ≤/> 1 km, date ≤/> 24 h, sci-name change, no-op).
- `tests/obs-detail/observation-enums.test.ts` — snapshot test of the enum option lists; ensures the create form and manage panel can't drift.
- `tests/obs-detail/photo-deletion-policy.test.ts` — given a list of photos and a primary ID, assert `willDemote` correctly identifies the cases.

### Playwright

- `tests/e2e/obs-detail-view.spec.ts` — open a seeded multi-photo obs, assert hero photo + thumb strip + map render, click thumb opens lightbox, Esc closes.
- `tests/e2e/obs-detail-edit.spec.ts` — sign in as owner, open Location tab, drag pin, save, reload, assert pin moved + "edited after IDs" badge if seeded with prior IDs.
- Mobile-chrome project: same flows, asserting the stacked layout.

### Manual verification

- Confirm `make db-apply` is replay-safe (the trigger drop-and-recreate is idempotent).
- Confirm photo soft-delete preserves the R2 blob (check bucket; verify `media_files.deleted_at` is set, file still listable in R2).
- Confirm cascade-photo deletion demotes the primary ID and the "needs review" pill renders.

---

## Rollout

1. Schema deltas (columns + trigger) via `make db-apply`. Pre-merge `db-validate.yml` enforces idempotency.
2. Extract `MapPicker.astro` and refactor `ObservationForm.astro` to consume it — ship as a no-behavior-change refactor PR first, with full e2e coverage, before any user-visible changes to the obs detail page.
3. Build `PhotoGallery.astro` and integrate into the obs detail page (Phase A, viewer-only).
4. Build `ObsManagePanel.astro` with the Details tab first (date/time + habitat/weather/establishment + existing fields). Ship.
5. Add the Location tab (coordinate edit). Ship.
6. Add the Photos tab (gallery management with cascade-photo confirm logic). Ship.
7. Update the in-code `share/obs/index.astro` comment that says "the R2 photo blobs are left as orphans, acceptable for v1" to reference the new `gc-orphan-media` v1.1 follow-up explicitly.

Each step is independently shippable and independently revertible. The order is chosen to surface bugs in the most-reused component (MapPicker) first.

---

## Open questions for the implementation plan

(These are deliberately **not** decided here — they're for the planning step.)

- Photo replacement workflow when the cascade-driving photo is deleted **and** the user immediately uploads a replacement: does the new photo become eligible to be "the" cascade photo (which would then need a fresh AI run), or does the obs stay in "needs review" until manually re-affirmed? Recommend: stay in needs-review; the cascade does not auto-re-fire on edit. Confirm during planning.
- Lightbox implementation: write a minimal native one if it lands at ≤150 lines (keyboard nav + swipe + Esc + share button per photo); fall back to `photoswipe` (~30 kB gzipped) only if the native version pushes past that line budget. PWA bundle is performance-sensitive per CLAUDE.md; native is the default. Final call after a prototype during planning.
- Whether to add an "Edited at" line to the public-facing metadata grid (showing `updated_at` to viewers) — minor transparency win vs. extra clutter. Defer to planning.
