# Projects (M29) — runbook

## Apply schema

```bash
make db-apply
```

Creates / migrates `projects`, `project_members`, `observations.project_id`,
`assign_observation_to_project_trigger`, `projects_with_geojson` view, and
`upsert_project()` RPC. Idempotent — re-runnable.

Verify:

```bash
make db-psql
\d projects
\df upsert_project
SELECT * FROM projects_with_geojson LIMIT 1;
```

## Backfill `project_id` on existing observations

The trigger only fires on INSERT/UPDATE. To tag historical
observations against a freshly-created project polygon, run a one-off
UPDATE:

```sql
UPDATE public.observations o
   SET project_id = p.id
  FROM public.projects p
 WHERE o.project_id IS NULL
   AND o.location  IS NOT NULL
   AND ST_Covers(p.polygon, o.location);
```

This re-fires the trigger but is a no-op once `project_id` is set.

## Manual project creation (without UI)

When the operator needs to seed an ANP polygon directly (e.g. ahead of
field work), use the RPC from `db-psql`:

```sql
SELECT public.upsert_project(
  p_slug             => 'anp-sierra-juarez',
  p_name             => 'Sierra Norte de Oaxaca',
  p_name_es          => 'Sierra Norte de Oaxaca',
  p_description      => 'CONANP federal protected area, Oaxaca.',
  p_description_es   => 'Área Natural Protegida federal, Oaxaca.',
  p_visibility       => 'public',
  p_polygon_geojson  => '{"type":"Polygon","coordinates":[…]}'::jsonb
);
```

`auth.uid()` must be set, so the call must run as the project owner's
role — easiest via `set role` or via the supabase-js client signed in
as the owner. Service role can call the function but the inserted
owner will be `auth.uid()` (NULL when running as service-role) — the
UI form is the recommended path.

## Reading polygons for export

The `projects_with_geojson` view exposes `polygon_geojson jsonb`
already in the `ST_AsGeoJSON()` form. CSV / DwC-A exporters should
consume that column directly rather than the raw `polygon` geography.

## Performance notes

- `idx_projects_polygon` (GIST on geography) keeps the auto-assign
  trigger O(log n) on the polygon set. Tested up to 50 polygons +
  10 000 observations on a free-tier Supabase; < 5 ms per insert.
- `idx_obs_project` is a partial index (`WHERE project_id IS NOT NULL`)
  to keep observations without project tag from bloating it.
