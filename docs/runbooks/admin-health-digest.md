# Admin health digest (PR12)

A weekly snapshot of platform-health metrics, written by
`public.compute_admin_health_digest()`. Rows land in
`public.admin_health_digests` and are read by admins only.

## Schedule

```sql
-- docs/specs/infra/cron-schedules.sql
PERFORM cron.schedule(
  'admin-health-digest-weekly',
  '0 9 * * 1',
  $$ SELECT public.compute_admin_health_digest(); $$
);
```

Mondays at 09:00 UTC. The function aggregates the previous 7 days
(`now() - 7 days` through `now()`) and inserts one row. The unique
constraint on `(period_start, period_end)` makes manual re-runs safe.

Fire it manually:

```bash
make db-psql -c "SELECT public.compute_admin_health_digest();"
```

## Metrics jsonb

Every digest carries a `metrics` jsonb with these keys (all bigints):

| Key                  | Definition                                                              |
|----------------------|-------------------------------------------------------------------------|
| `admin_actions`      | rows in `admin_audit` written in the period                             |
| `bans_issued`        | rows in `user_bans` created in the period                               |
| `bans_lifted`        | rows in `user_bans` whose `revoked_at` falls inside the period          |
| `appeals_open`       | rows in `ban_appeals` with `status = 'pending'` at digest time          |
| `reports_open`       | rows in `reports` with `status IN ('open','triaged')` at digest time    |
| `anomalies_unack`    | rows in `admin_anomalies` with `acknowledged_at IS NULL` at digest time |
| `function_errors_7d` | rows in `function_errors` written in the period                         |

`appeals_open`, `reports_open`, and `anomalies_unack` are *as of
digest time* — the others count rows whose primary timestamp falls
within `[period_start, period_end)`.

## Reading the latest digest from SQL

```sql
SELECT period_start, period_end, metrics
FROM public.admin_health_digests
ORDER BY period_end DESC
LIMIT 4;
```

Or to extract a single metric across the last quarter:

```sql
SELECT period_end::date AS week,
       (metrics->>'admin_actions')::bigint AS admin_actions
FROM public.admin_health_digests
WHERE period_end >= now() - interval '90 days'
ORDER BY period_end;
```

## Future expansion ideas

The schema is intentionally minimal. Concrete asks that should land
before they grow load-bearing:

* **Karma / observation throughput**: per-week observations synced,
  per-week consensus decisions. Read from `observations` + `karma_events`.
* **Identifier mix**: per-week distribution across cascade providers
  (PlantNet / Claude / WebLLM). Read from `api_usage`.
* **Funnel metrics**: signed up → first observation → 5th observation,
  weekly cohort. Read from `users` + `observations`.

Add new keys to the `jsonb_build_object()` call in
`compute_admin_health_digest()`. The function is `CREATE OR REPLACE`, so
schema-replay picks up the changes; existing rows keep their original
shape.

If the digest grows beyond ~20 keys, split it into a normalised
`admin_health_metrics(digest_id, metric_key, metric_value)` table — the
denormalised jsonb is fine for v1.

## UI surface (PR15)

`/console/health/` is the admin-only view at `/{en,es}/{console,consola}/{health,salud}/`.

The page renders the **last 12 weekly digests** ordered DESC by
`period_end`. Layout is two cards stacked:

1. **Hero card** — the latest week. 2-column metric grid; each cell
   shows the absolute value plus a delta pill ("vs prev") with a
   directional arrow + raw delta + percent. Pill color is
   metric-aware:
   * **lower-is-better** metrics (`bans_issued`, `reports_open`,
     `appeals_open`, `anomalies_unack`, `function_errors_7d`,
     `mod_queue_depth`, `expert_queue_depth`) → green when going down,
     red when going up.
   * **higher-is-better** metrics (`bans_lifted`) → green when going
     up, red when going down.
   * other metrics → zinc/flat.
2. **Sparkline strip** — 12-week trend per metric. Each metric is one
   tile with a tiny inline-SVG bar chart. Bars are tooltipped via
   `<title>` so hover reveals "Week of YYYY-MM-DD: <value>".

The classification lives in `src/lib/health-delta.ts` as a pair of
pure helpers (`computeMetricDelta`, `trendColorClass`, `trendArrow`)
backed by 10 unit tests.

### Manual recompute

The header has a **Refresh now** button. It calls the admin
`health.recompute` action, which invokes
`compute_admin_health_digest()`. Because the underlying RPC is
`ON CONFLICT DO NOTHING` on `(period_start, period_end)`, multi-fires
within the same week are no-ops on the digest row itself — but they
still emit an `admin_audit` row with `op = 'health_recompute'` so the
intent is traced.

## Related

* Schema: `docs/specs/infra/supabase-schema.sql` — `admin_health_digests`
  + `compute_admin_health_digest()`.
* Cron: `docs/specs/infra/cron-schedules.sql` —
  `admin-health-digest-weekly`.
* UI: `src/components/ConsoleHealthView.astro`.
* Edge Function: `supabase/functions/admin/handlers/health-recompute.ts`.
* Audit log enum: `audit_op = 'health_recompute'`.
* Pure helpers: `src/lib/health-delta.ts` + `tests/unit/health-delta.test.ts`.
* Anomaly counterpart: `docs/runbooks/admin-anomalies.md`.
