# Admin anomaly detection (PR12)

The admin console writes every privileged action to `public.admin_audit`.
Once an hour, `public.detect_admin_anomalies()` scans the prior hour's
rows for actor-level signals that look unusual and inserts a row into
`public.admin_anomalies` per detection. The Anomalies tab (`/console/anomalies`)
exposes the queue to admins.

## Detection rules

| Kind          | Signal                                                                                    | Threshold |
|---------------|-------------------------------------------------------------------------------------------|-----------|
| `high_rate`   | One actor produces too many `admin_audit` rows in any rolling 1-hour window               | > 50      |
| `bulk_delete` | One actor produces too many destructive-shaped ops (`hide`/`revoke`/`ban`/`delete`) in 1h | > 10      |
| `off_hours`   | One actor takes ≥ N actions outside 06:00–22:00 UTC in any 1-hour window                  | ≥ 5       |

The function lives in `docs/specs/infra/supabase-schema.sql`. It is
`SECURITY DEFINER`, with `REVOKE ALL FROM PUBLIC` and `GRANT EXECUTE TO
service_role`. Each detection inserts one row, dedicated by the
`UNIQUE (kind, actor_id, window_start)` constraint — so re-running the
same hour is a no-op.

`window_start` is truncated to the hour (`date_trunc('hour', now()) - 1h`),
which both keeps the unique key compact and makes manual re-fires safe.

## The cron job

```sql
-- docs/specs/infra/cron-schedules.sql
PERFORM cron.schedule(
  'admin-anomaly-detect-hourly',
  '5 * * * *',
  $$ SELECT public.detect_admin_anomalies(); $$
);
```

Fire it manually:

```bash
make db-psql -c "SELECT public.detect_admin_anomalies();"
```

## Tuning thresholds

The thresholds are inline constants in `detect_admin_anomalies()`. To
loosen `bulk_delete` from 10 → 25 actions/hour (typical after a wave of
spam moderation):

1. Edit `detect_admin_anomalies()` in `docs/specs/infra/supabase-schema.sql` —
   change the `HAVING count(*) > 10` for the bulk_delete `INSERT` block.
2. `make db-apply` (the function is `CREATE OR REPLACE`, so the change
   takes effect on the next cron firing).

Tightening is symmetric. Don't introduce per-actor thresholds — keep the
function scan-friendly and the false-positive review burden in the UI.

## Acknowledging from the UI

`/console/anomalies` (admin-only). Each unacknowledged row has an
**Acknowledge** button. Clicking it opens the slide-over with a notes
textarea + the standard reason field. Submission goes through the
`anomaly.acknowledge` action on the admin Edge Function, which writes
`acknowledged_at = now()`, `acknowledged_by = actor.id`, and
`ack_notes = <notes>` in one update — and inserts an `admin_audit` row
with `op = 'anomaly_acknowledge'`.

Acknowledged rows stay in the table; switch the toggle to **All** to
review past detections.

## Acknowledging from SQL

If you need to bypass the UI (e.g., a stuck row, an automation cleanup):

```sql
UPDATE public.admin_anomalies
SET acknowledged_at = now(),
    acknowledged_by = '<your uuid>',
    ack_notes = 'sql cleanup — false positive after audit'
WHERE id = '<anomaly uuid>'
  AND acknowledged_at IS NULL;
```

This bypasses the audit trail. Prefer the UI unless the dispatcher itself
is broken.

## False positives — what to do

* **Big import / bulk moderation event**: expected. Acknowledge with a
  note pointing to the operational context ("post-import cleanup",
  "spam-wave moderation 2026-04-29").
* **Off-hours that are within an admin's local working hours**: the rule
  uses UTC by design — there's no per-admin timezone column yet. For
  now, acknowledge with a note. If this becomes a frequent annoyance,
  add a `users.timezone` column and switch the rule to actor-local time.
* **Single false-positive `high_rate`**: acknowledge with a note. If
  the same actor trips it more than once a week, raise the threshold or
  open a discussion about whether the action they're taking should be
  rate-limited at the dispatcher.

## Related

* Schema: `docs/specs/infra/supabase-schema.sql` — `admin_anomalies` +
  `detect_admin_anomalies()`.
* Cron: `docs/specs/infra/cron-schedules.sql` — `admin-anomaly-detect-hourly`.
* Edge Function: `supabase/functions/admin/handlers/anomaly-acknowledge.ts`.
* UI: `src/components/ConsoleAnomaliesView.astro`.
* Audit log enum: `audit_op = 'anomaly_acknowledge'`.
