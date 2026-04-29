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

## Related

* Schema: `docs/specs/infra/supabase-schema.sql` — `admin_health_digests`
  + `compute_admin_health_digest()`.
* Cron: `docs/specs/infra/cron-schedules.sql` —
  `admin-health-digest-weekly`.
* Anomaly counterpart: `docs/runbooks/admin-anomalies.md`.
