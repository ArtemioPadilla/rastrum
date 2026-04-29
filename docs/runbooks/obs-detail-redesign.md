# Observation detail page redesign — runbook

> Operator runbook for the `/share/obs/?id=<uuid>` redesign.
> Spec: `docs/superpowers/specs/2026-04-29-obs-detail-redesign-design.md`.
> Plan: `docs/superpowers/plans/2026-04-29-obs-detail-redesign-plan.md`.

## Architecture

- `src/components/MapPicker.astro` (PR1 #91) — reusable two-mode component
  (`mode='view'|'edit'`) consumed by `ObservationForm.astro` (edit), the
  share-obs viewer (view; PR3), and the Location tab (edit; PR5). Per-instance
  HTML IDs (`-${pickerId}` suffix) so multiple instances coexist on one page.
- `src/components/PhotoGallery.astro` (PR3 #103) — hero + thumbnail strip +
  native lightbox (keyboard ←/→/Esc + swipe + per-photo share + `canShare`
  probe + dynamic "Photo N of M" aria-labels). Owner mode renders a delete
  button per photo whose onClick dispatches `rastrum:photogallery-delete`;
  PR6's `delete-photo` Edge Function wires the handler.
- `src/components/ShareObsView.astro` (PR3 #103) — extracted from
  `share/obs/index.astro`. Two-column desktop / stacked mobile layout. Sticky
  LEFT: gallery + mini-map + coords readout + owner-only "Edit location"
  affordance. Scroll RIGHT: H1 + meta + reactions + sensitive notice +
  metadata grid + community IDs + manage-panel placeholder + comments. All
  view-side strings in `obs_detail.view.*` i18n.
- `src/lib/observation-enums.ts` (PR2 #98) — single source of truth for
  `HABITATS` / `WEATHERS` / `ESTABLISHMENT_MEANS` consumed by `ObservationForm`
  (create) and `ObsManagePanel.Details` (PR4). `labelFor()` accessor pulls
  bilingual labels from the i18n tree without inline `Record<…>` casts.

## Schema deltas (PR2 #98)

- `observations.last_material_edit_at timestamptz` — set by trigger when an
  edit crosses a "material" threshold:
  - `ST_Distance(NEW.location, OLD.location) > 1000` (1 km)
  - `abs(extract(epoch FROM (NEW.observed_at - OLD.observed_at))) > 86400` (24 h)
  - `NEW.primary_taxon_id IS DISTINCT FROM OLD.primary_taxon_id` (covers the
    "scientific name override" UX, which manipulates `identifications`; the
    existing `sync_primary_id_trigger` on `identifications` cascades the change
    into `observations.primary_taxon_id`, which then fires the new
    `observations_material_edit_check_trg` BEFORE UPDATE on `observations`).
- `media_files.deleted_at timestamptz` — soft-delete sentinel. R2 blob is **not**
  removed in v1; the `gc-orphan-media` cron is a v1.1 follow-up.
- `idx_media_files_active` — partial index `(observation_id) WHERE deleted_at IS NULL`.

## Edit semantics — minor vs material

| Edit | Class | Behavior |
|---|---|---|
| Notes change | Minor | `updated_at` bumps, no badge |
| Habitat / weather / establishment_means change | Minor | no badge |
| Location-privacy (`obscure_level`) change | Minor | no badge |
| Coords move ≤ 1 km | Minor | no badge |
| Coords move > 1 km | **Material** | trigger sets `last_material_edit_at` |
| Date moves ≤ 24 h | Minor | no badge |
| Date moves > 24 h | **Material** | trigger sets `last_material_edit_at` |
| Primary taxon changes (via override or accepted ID) | **Material** | trigger sets `last_material_edit_at` |
| Photo added | Minor | no badge (additive) |
| Photo removed | **Material** | application-level UPDATE `last_material_edit_at` |

**Badge rules** (PR3 implements): the "Edited after IDs were given" badge in the
community-IDs section is shown only when `last_material_edit_at IS NOT NULL`
**AND** the obs has at least one community ID. No suggestions to alert means no
badge. The badge persists indefinitely once set; there is no "clear edit
history" UX in v1.

## Photo deletion atomicity (PR6)

The `delete-photo` Edge Function wraps three writes in one transaction:

```sql
UPDATE public.media_files
   SET deleted_at = now()
 WHERE id = $1;

-- Demote primary ID if the deleted photo was the cascade source AND
-- removing it leaves no replacement primary photo. Helper logic:
--   willDemote = (count(non-deleted photos) === 0) || (deleted photo had is_primary = true)
UPDATE public.identifications
   SET validated_by      = NULL,
       validated_at      = NULL,
       is_research_grade = false
 WHERE observation_id = $obs_id AND is_primary = true;

UPDATE public.observations
   SET last_material_edit_at = now()
 WHERE id = $obs_id;
```

The owner sees a confirm dialog (*"This photo was the basis for the current
identification. Deleting it will mark the observation as needing review.
Continue?"*) when `willDemote` is true. **Always use the Edge Function**, never
issue these UPDATEs from client code — the client-side two-call has a real
race window if the user closes the tab between calls.

## R2 orphan policy

Soft-delete only for v1. The R2 blob is left in the bucket; the `media_files`
row is filtered out by the gallery via `deleted_at IS NULL`. A future
`gc-orphan-media` cron (v1.1) will walk R2 and remove blobs not referenced by
any non-deleted `media_files` row. This is documented in
`src/pages/share/obs/index.astro` next to the soft-delete logic.

## i18n

`obs_detail.*` namespace in `src/i18n/{en,es}.json`. Sub-namespaces:

- `obs_detail.tabs` — `details`, `location`, `photos` (PR4+)
- `obs_detail.view.*` — all the strings in `ShareObsView.astro` (PR3)
- `obs_detail.gallery.*` — `PhotoGallery.astro` (PR3)
- `obs_detail.errors.*` — coords_invalid, save_failed, upload_failed (PR4+)
- `obs_detail.{edit_location, save_changes, saved, edited_badge,
   delete_photo_confirm, delete_obs_confirm, add_photo, delete_photo,
   coords_precise_label, coords_obscured_label, needs_review}` — flat keys
   reused across panels.

EN/ES parity is enforced by visual review during PR; the project does not yet
have an automated parity check.

## Per-step PR map

| PR | Status | Scope |
|---|---|---|
| #91 | merged 2026-04-29 | PR1 — extract `MapPicker.astro` (no behavior change) + Playwright regression test |
| #98 | merged 2026-04-29 | PR2 — schema deltas + material-edit trigger + `observation-enums.ts` + `obs_detail.*` i18n |
| #103 | in review | PR3 — `PhotoGallery.astro` + `ShareObsView.astro` two-column layout + viewer e2e |
| TBD | planned | PR4 — `ObsManagePanel.astro` Details tab (date/time + habitat + weather + establishment + name override + notes + obscure level) |
| TBD | planned | PR5 — Location tab (drop-in `MapPicker mode='edit'` for coordinate edit) |
| TBD | planned | PR6 — Photos tab + `delete-photo` Edge Function (atomic soft-delete + ID demote + edit-flag) |

## Future work (v1.1)

- `gc-orphan-media` cron (R2 GC of soft-deleted blobs — current orphan policy
  is "leave them" per the v1.0 share/obs comment).
- Lightbox lib decision: PR3 ships native (~106 LOC, well under the 150-LOC
  spec budget). PhotoSwipe remains an option if accessibility audits later
  surface gaps the native impl can't reasonably close.
- Migrate any remaining `isEs ? 'X' : 'Y'` strings in PR4+ surfaces to the
  i18n tree (PR3 already migrated `ShareObsView`'s 27 ternary labels).
- Cascade re-run on photo replacement is **out of scope** for the obs-detail
  redesign; consider in a separate spec.
