# M29 — Projects (ANP polygon protocols)

> **Status:** v1 in progress.
> **Owner:** Artemio.
> **Surfaces:** `/{en,es}/projects/`, `/{en,es}/projects/[slug]/`, REST writes via supabase-js with RLS.

A *project* is a named polygon (typically an ANP, reserve, or sampling
grid) that observations are auto-tagged into when their location falls
inside the polygon. The module is the prerequisite for:

- M30 — batch CLI import for camera-trap memory cards (issue #110)
- M31 — camera station + sampling-effort tracking (issue #112)

## Data model

```
projects (
  id              uuid PK,
  slug            text UNIQUE,           -- url + CLI key
  name, name_es   text,                  -- bilingual labels
  description, description_es text,
  polygon         geography(MultiPolygon, 4326) NOT NULL,
  visibility      enum('public','private') DEFAULT 'public',
  owner_user_id   uuid → users.id,
  species_list    jsonb,                 -- optional taxon allow-list
  created_at, updated_at
)

project_members (
  project_id, user_id  uuid PK,
  role                 enum('owner','validator','member')
)

observations.project_id  uuid → projects.id  (denormalised, auto-set)
```

`MultiPolygon` is preferred over `Polygon` so an ANP with disjoint
parcels (Sierra Norte de Oaxaca, for example, has multiple separated
zones) can be one project.

## Auto-assignment trigger

`assign_observation_to_project_trigger` runs `BEFORE INSERT OR UPDATE
OF location` on `observations`. When `project_id` is null and
`location` is set, it picks the first project whose polygon contains
the point ordered by `created_at ASC` (longest-lived wins on overlap).

Operators with overlapping polygons should resolve by editing one or
the other — the trigger does not split or warn. Manual override stays
honoured because we only auto-fill when `NEW.project_id IS NULL`.

## RLS

| Surface | anon | authenticated | service_role |
|---|---|---|---|
| `projects` SELECT | public-only | public + own + member-of | all |
| `projects` INSERT | — | self-as-owner | all |
| `projects` UPDATE/DELETE | — | owner only | all |
| `project_members` SELECT | members of public projects | self + members of public + own | all |
| `project_members` INSERT/DELETE | — | owner only | all |

The `obs_public_read` policy is unchanged — observations remain gated
by `obscure_level` + `location_obscured`. `project_id` is *not* a
privacy gate; it's a routing label.

## Surfaces

### `/{en,es}/projects/` — list
Public projects + my projects (if signed in). Shows name, observation
count, owner, last-activity. Search by slug or name. "Create project"
CTA when signed in.

### `/{en,es}/projects/[slug]/` — detail
Header: name, description, owner, polygon area in km². Tabs:

- **Observations** — list of observations tagged to this project,
  honouring RLS (private projects show only to members). Re-uses the
  existing `ExploreRecent` filter wired with `?project=<slug>`.
- **Species** — distinct taxa with detection counts.
- **Members** — owner + validators + members. Owner can add/remove.

### Project create/edit form
Owner provides slug, bilingual name + description, visibility, and a
polygon. Polygon input v1 supports:
- paste GeoJSON (`Polygon` or `MultiPolygon`)
- upload `.geojson` file

Drawing the polygon on a map is a v1.1 follow-up — paste-GeoJSON
covers the CONANP-Oaxaca team's workflow (their polygons come from
SHP exports → mapshaper → GeoJSON).

## Integration with #110 (CLI import)

The CLI accepts `--project-slug <slug>`. When present, every imported
observation has `project_id` set explicitly, bypassing the auto-assign
trigger. This is faster (no PostGIS lookup per row) and lets a
researcher tag a batch even if some images' EXIF GPS is slightly
outside the polygon.

When `--project-slug` is omitted, the trigger does its normal work and
images outside any polygon stay untagged.

## Out of v1

- Polygon drawing in the browser (paste-GeoJSON only for v1).
- Per-project DwC-A export filter (export-dwca already supports a
  `?project=` param hook — UI lands in v1.1).
- Project-level role beyond owner/validator/member (e.g. data-editor,
  reviewer).
- Project polygons in tile layers / map overlays in `ExploreMap`.
