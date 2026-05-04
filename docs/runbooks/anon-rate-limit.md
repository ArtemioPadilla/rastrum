# Anonymous rate-limit (Postgres-backed)

Tracks per-IP request counts for unauthenticated callers across Edge
Function endpoints. Replaces the previous in-memory `globalThis` map
that reset on every V8 cold start (see #581).

## Schema

```sql
CREATE TABLE public.anon_rate_limit (
  ip        text NOT NULL,
  endpoint  text NOT NULL,
  ts        timestamptz NOT NULL DEFAULT now()
);
```

Index: `(endpoint, ip, ts DESC)`. RLS: service-role only.

## Usage from an Edge Function

```ts
import { checkAnonRateLimit } from '../_shared/anon-rate-limit.ts';

const ok = await checkAnonRateLimit(db, ip, 'identify', 10, 3600);
if (!ok) return rateLimited();
```

Returns `false` to deny, `true` to allow (and inserts a row). Fails
open when the table read errors — better to serve traffic than brick
the EF.

## Cleanup

`anon-rate-limit-cleanup` cron (every 6h) deletes rows older than 2h.
Lives in `docs/specs/infra/cron-schedules.sql`. Apply with
`make db-cron-schedule`.

## Adding a new rate-limited endpoint

Pick a stable string for `endpoint` (e.g. `'identify'`, `'follow'`),
import the helper, and call it on the unauth path. Pick a window
shorter than 2 hours or extend the cleanup TTL.
