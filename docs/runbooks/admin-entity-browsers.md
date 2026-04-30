# Admin entity browsers (PR16)

Last verified: 2026-04-29

The admin console exposes a paginated, filterable read-only browser for
every long-tail entity that previously required a Supabase Studio drop-in
to inspect. All seven browsers share a single `ConsoleEntityBrowser`
template + `entity-browser.ts` runtime; per-entity files declare only
their column / filter / drill-down config.

## The 7 PR16 browsers

| Tab | Route | Source | Drill-down |
|---|---|---|---|
| Identifications | `/console/identifications` | `identifications` | Full row + raw_response, deep-link to observation |
| Notifications | `/console/notifications` | `notifications` | Full payload jsonb |
| Media | `/console/media` | `media_files` | Full preview + R2 URL + EXIF |
| Follows | `/console/follows` | `follows` | Both profile deep-links + full row JSON |
| Watchlists | `/console/watchlists` | `watchlists` | Full row JSON |
| Projects | `/console/projects` | `projects_with_geojson` view | GeoJSON + species_list + lazy obs count |
| Taxon changes | `/console/taxon-changes` | `admin_audit` (filtered to taxon_* ops) | Side-by-side before/after diff |

ES routes are paired one-to-one (`/consola/seguimientos`, etc.); see
`src/i18n/utils.ts` for the canonical map.

## Templated component pattern

```
ConsoleEntityBrowser.astro      shared static skeleton (header, filter
                                form, paginated table, skeleton, empty,
                                error states; all DOM ids prefixed)

src/lib/entity-browser.ts       runtime — instantiates one EntityBrowser
                                per per-entity script with the table's
                                FilterSpec[], ColumnSpec[], drill-down,
                                lookup resolvers

src/components/Console<X>View.astro
                                per-entity wrapper — declares filters +
                                columns + drill-down render, mounts the
                                runtime, gates on has_role(admin)
```

Each per-entity view follows an identical recipe:

1. Frontmatter pulls `console.<x>View` translations + invokes
   `<ConsoleEntityBrowser prefix="…" filters={…} columns={…} />` with the
   static labels.
2. A hidden `<div id="<prefix>-config" data-…>` carries any runtime
   strings the script needs (drill-down labels are the common case —
   they can't be statically interpolated into client-side template
   literals).
3. The `<script>` block instantiates `EntityBrowser` with full
   `BrowserConfig` (filter predicates, columns with `render(row, ctx)`,
   `resolveUsersFromRow` / `resolveTaxaFromRow` for FK lookups, optional
   `rowIdFromRow` for composite-PK tables, `renderDrilldown`).

## Performance characteristics

- **$0 cost.** All browsers query existing tables via supabase-js. No
  new tables, no new cron, no new background work. Indexes added by
  PR16's first commit (`58deee6`) cover the (filter_field, created_at
  DESC) hot-paths. RLS on each underlying table already gates by
  `has_role(auth.uid(), 'admin')` — the only new policies are two
  admin-SELECT policies on `notifications` and `watchlists` that were
  previously owner-scoped (privacy-neutral; admin already had
  service-role visibility via Supabase Studio).
- **Server-side pagination.** 50 rows / page; `count: 'exact'` fired
  only on filter changes (cached between page flips). 6 entities × 50
  rows × ~6 columns = strictly bounded payload per request.
- **Lazy lookups.** `resolveUsersFromRow` / `resolveTaxaFromRow` batch
  one supabase query per page over the 50 user-ids the rows reference;
  results are cached in `RenderContext` and re-used across pagination.
- **Auto-populated dropdowns.** Filters with `autoPopulateColumn` issue
  one distinct-value query at mount, scoped to the last 90 days,
  capped at 2000 rows. Costs ~50 ms per browser at sign-in.
- **URL-driven filter state.** Filter values + page index roundtrip
  through the URL via `console-filter-state.ts`, so deep-links and
  back-button work.

## How to add a new entity browser

### Recipe (1 day of work, no schema changes if the table is already indexed)

1. **Pick the prefix.** Two-to-three letters, unique across all
   browsers. Used as the DOM id prefix and the shorthand throughout
   the file. Existing: `ids` (identifications), `ntf` (notifications),
   `med` (media), `fol` (follows), `wl` (watchlists), `prj`
   (projects), `txc` (taxon-changes).

2. **Write `src/components/Console<Name>View.astro`.** Copy the
   shape of `ConsoleNotificationsView.astro` — the simplest
   exemplar (single-table, no autocomplete, payload jsonb
   drilldown). Fill in:
   - `Props.lang`, the localised `labels` object pulled from
     `tr.console.<name>View`.
   - `<ConsoleEntityBrowser prefix=… filters=… columns=… />`.
   - `<script>` block: `EntityBrowser<Row>({ tableName, selectClause,
     orderBy, columns, filters, resolveUsersFromRow, renderDrilldown,
     lang })`.
   - `init()` gate: `getSession()` then `getUserRoles()` — show
     `<prefix>-not-auth` if not admin.

3. **Add page wrappers** under `src/pages/{en,es}/{console,consola}/<route>/index.astro`.
   Two ~10-line files, one per locale, each mounts the view with the
   right `lang` prop. Routes go in `src/i18n/utils.ts`'s `routes`
   map + the `routeTree` label pair.

4. **Register the tab** in `src/lib/console-tabs.ts` —
   `{ id, role: 'admin', routeKey: 'console<Name>', i18nKey: 'console.<id>',
   icon, phase: 1 }`. Bump the per-role count comment.

5. **i18n** — add `console.<name>View.*` keys to BOTH `en.json` and
   `es.json`, plus the `console.<id>` tab label. Re-run
   `npm run build` to confirm both locales render.

6. **Index hot-path columns.** If a filter is `kind: 'select'` /
   `'autocomplete'` / `'date'`, ensure
   `(<column>, created_at DESC)` is indexed in
   `docs/specs/infra/supabase-schema.sql` (idempotent
   `CREATE INDEX IF NOT EXISTS`). For taxon-changes we re-used the
   existing `admin_audit_op_idx` and `admin_audit_target_idx`.

7. **RLS check.** If the underlying table is owner-scoped only,
   add an admin-SELECT policy:
   ```sql
   DROP POLICY IF EXISTS <table>_admin_read ON public.<table>;
   CREATE POLICY <table>_admin_read ON public.<table>
     FOR SELECT TO authenticated
     USING (public.has_role(auth.uid(), 'admin'));
   ```
   This is privacy-neutral since admin already has service-role
   visibility — it just plumbs the same audit through anon /
   authenticated for the console.

8. **Test** — bump the count in `tests/lib/console-tabs.test.ts`:
   `tabs total`, `admin role has N tabs`, `PR16_IDS` list. Run
   `npm run test`. Then `npm run typecheck` + `npm run build` and
   confirm both new locale pages emit.

### Composite primary keys

Tables keyed on a composite PK (e.g. `follows` keyed on
`(follower_id, followee_id)`) need `rowIdFromRow: r => …` in
`BrowserConfig` so `EntityBrowser` can synthesise a stable per-row id
for drill-down expansion state. Without this, expansion state collapses
to a single shared key and only the last-clicked row stays open.

### Filtering on a baseline predicate

Some browsers need an always-on baseline (e.g. taxon-changes filters
admin_audit to `op IN ('taxon_conservation_set', …)`). Pattern:
prepend a synthetic `FilterSpec` with `key: '__op_baseline'` to the
filters array, and inject a hidden `<input id="<prefix>-f-__op_baseline" value="1" />`
so `applyFilters()` runs the predicate. The synthetic filter doesn't
render a form element (the `<ConsoleEntityBrowser>` only enumerates the
declared `filters` prop).

### Lazy aggregate facets in drill-downs

For drill-downs that need a count (e.g. projects → tagged observations
count), do **not** join in the main select clause. Emit a placeholder
`<span data-prj-obs-count="${id}">…</span>` from `renderDrilldown` and
attach a `MutationObserver` on `<prefix>-tbody` from `init()` that
fires a `head: true` count query the first time each placeholder
appears. This keeps the browse path bounded (50 × cheap rows) while
deferring O(N) work to the explicit drill-down.

## Field-level facets that intentionally aren't exposed

| Browser | Faceted? | Why not |
|---|---|---|
| Watchlists | `region` | Not in schema. v1 uses `radius_km` (CHECK 1–500) for spatial digests; "region" predates the m08 watchlist schema. |
| Projects | `country` | Not in schema. M29 uses the polygon as the routing key; observations are auto-tagged via `ST_Covers(polygon, location)`, not a country code. Filter by visibility instead. |
| Projects | obs count column | Aggregate on a paginated browse would be O(N×M). Lazy obs count fires per drill-down via `head:true` count(*). |
| Taxon changes | rename / synonym actions | `audit_op` enum has only `taxon_conservation_set` today. The view filter list is one-line-extendable when `taxon_rename` / `taxon_synonym_*` ops land. |

## Manual smoke

```bash
make dev
# Open http://localhost:4321/en/console/identifications and verify:
#  - skeleton renders
#  - filter form populates (auto-populated dropdowns lag ~50ms)
#  - 50 rows load
#  - prev/next pagination updates URL
#  - drilldown +/- toggles
#  - locale toggle picks ES translations from console.<x>View.*
```

For the projects browser, click a row's drill-down toggle and verify the
"Tagged observations: …" placeholder resolves to a numeric count within
~200ms (head:true count is fast even with no index — a few hundred
projects max in v1).
