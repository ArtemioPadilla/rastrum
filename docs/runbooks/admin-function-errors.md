# Admin function errors (PR15)

`public.function_errors` is the structured error sink for every Edge
Function dispatcher. PR12 introduced the table + the
`reportFunctionError()` helper that the admin dispatcher calls inside
its catch block. PR15 adds the `/console/errors/` admin tab so rows
can be triaged without dropping into psql.

## Data model

| Column            | Notes                                                                |
|-------------------|----------------------------------------------------------------------|
| `id`              | uuid PK                                                              |
| `function_name`   | Edge Function name (currently always `'admin'`; future fns join in)  |
| `code`            | Short stable code (`rate_limit_exceeded`, `handler_exception`, …)    |
| `actor_id`        | nullable — caller's auth uid when the request was authenticated      |
| `context`         | jsonb — free-form payload (currently `{ op: '<action>' }`)           |
| `error_message`   | text — the original `Error.message` or the dispatcher-thrown literal |
| `created_at`      | timestamptz, default now()                                           |
| `acknowledged_at` | timestamptz — set by `error.acknowledge` (PR15)                      |
| `acknowledged_by` | uuid → auth.users.id — set by `error.acknowledge` (PR15)             |
| `ack_notes`       | text — optional operator note saved with the ack                     |

RLS: admin-only `SELECT` (via `has_role(auth.uid(), 'admin')`); no
client-facing INSERT/UPDATE/DELETE — only the dispatcher's
service-role client writes.

## When rows get written

The admin dispatcher's catch block calls `reportFunctionError()` and
the helper inserts a row whenever a handler throws or the dispatcher
itself rejects (rate limit, irreversible-op enforcement, etc.). The
two codes you'll see in production today:

* `handler_exception` — a handler threw. The error_message preserves
  the original `Error.message`; `context.op` records which action
  blew up.
* `rate_limit_*` — currently a planned code; the dispatcher returns
  429 directly without persisting (the `consume_rate_limit_token` RPC
  carries its own forensics). Reserved for future per-action limits.

Any future Edge Function that wants to participate just imports
`reportFunctionError` and calls it from its own catch block.

## Severity heuristic

The Errors tab paints the per-row code chip based on a pure-function
heuristic in `src/lib/error-severity.ts`:

| Severity | Heuristic                                      | Color  |
|----------|------------------------------------------------|--------|
| `high`   | `error_message` starts with `handler_exception`| red    |
| `medium` | `error_message` starts with `rate_limit_`      | amber  |
| `low`    | anything else (or null)                        | zinc   |

The mapping is unit-tested (`tests/unit/error-severity.test.ts`) so a
silent regression that mispaints a real handler exception as a benign
event would fail CI.

## Acknowledge workflow

`/console/errors/` defaults to **Unacknowledged** — that's the "what's
on fire?" view. Filter chips are URL-driven via
`console-filter-state.ts` so a deep link reproduces an investigation
exactly:

* `function_name` (dropdown — distinct values from last 30d)
* `code` (dropdown — same)
* `from` / `to` (datetime-local pickers)
* `actor_id` (uuid OR username; usernames resolve via
  `users.username = ?`)
* state toggle: **Unacknowledged** / **All**

Each unacknowledged row has an **Acknowledge** button. Single-row ack
opens a `ConsoleSlideOver` with a notes textarea + the standard reason
field; submission goes through the `error.acknowledge` admin handler.

A **Bulk Acknowledge** button at the top of the form fires
`error.acknowledge_bulk` against the current filter set. The handler
caps at 1000 rows server-side; the result includes `capHit: boolean`
so the UI surfaces a "re-run to acknowledge more" hint when the cap
was reached. Both the single and bulk handlers write `admin_audit`
rows (`op = 'error_acknowledge'` / `'error_acknowledge_bulk'`) so the
audit trail is preserved.

## Auto-refresh

The Errors tab has an **Auto-refresh (30s)** toggle — OFF by default.
Useful when actively investigating an outage; deliberately quiet
otherwise so we don't burn Supabase requests in the background.

## Top-codes mini-bar

Above the table, the 5 most-frequent codes in the current result set
are surfaced as click-to-filter pills (e.g. `handler_exception ×42`).
Hidden when the result set is empty. Lets an operator see "is one
specific failure mode dominating today?" at a glance.

## Retention

There's no automatic prune. The table is admin-only and currently
small (kilobyte-scale even after months of running); a follow-up cron
(`prune_function_errors_older_than_90d`) is on the v2 list once we
have a year of production data and a real signal it's needed.

## Acknowledging from SQL

If the dispatcher itself is broken and the UI ack flow can't run:

```sql
UPDATE public.function_errors
SET acknowledged_at = now(),
    acknowledged_by = '<your uuid>',
    ack_notes = 'sql cleanup — dispatcher hung'
WHERE id = '<error uuid>'
  AND acknowledged_at IS NULL;
```

This bypasses the audit trail. Prefer the UI unless that's broken
too — `error.acknowledge` going down in the same outage that's
flooding `function_errors` is a tail-latency case worth knowing about.

## Related

* Schema: `docs/specs/infra/supabase-schema.sql` — `function_errors`
  table + PR15 ack columns.
* Reporter: `supabase/functions/admin/_shared/error-reporter.ts`.
* Dispatcher catch: `supabase/functions/admin/index.ts`.
* Edge Function handlers: `supabase/functions/admin/handlers/{error-acknowledge,error-acknowledge-bulk}.ts`.
* UI: `src/components/ConsoleErrorsView.astro`.
* Severity helper: `src/lib/error-severity.ts`.
* Audit log enums: `audit_op IN ('error_acknowledge','error_acknowledge_bulk')`.
