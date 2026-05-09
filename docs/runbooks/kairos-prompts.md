# Kairos contextual prompts (M34)

> Spec: [`../specs/modules/34-kairos-prompts.md`](../specs/modules/34-kairos-prompts.md).
> Closes #724.

## What it does

Sends one Web Push per opted-in user per day, 15-30 minutes before
sunset at the centroid of their most recent observation.

## Prerequisites

- VAPID keys configured (see [`rotate-secret.md`](rotate-secret.md)
  → "VAPID keys").
- `CRON_SECRET` set on the Edge Function and matched in the Vault.
- `kairos-fire` Edge Function deployed.
- `kairos-fire-15min` pg_cron job scheduled.

## Deploy

```bash
# 1. Deploy the Edge Function
gh workflow run deploy-functions.yml --ref main -f function=kairos-fire

# 2. Apply the schema (idempotent)
make db-apply

# 3. Schedule the cron (idempotent — re-runs replace the row)
make db-cron-schedule

# 4. Verify the cron registered
make db-psql -- -c "SELECT jobname, schedule, active FROM cron.job WHERE jobname='kairos-fire-15min';"
```

## Manually fire the cron

Useful for smoke-testing without waiting for the next 15-minute window.

```bash
curl -X POST https://reppvlqejgoqvitturxp.supabase.co/functions/v1/kairos-fire \
  -H "Content-Type: application/json" \
  -H "X-Cron-Secret: $CRON_SECRET" \
  -d '{}'
```

Expected response:

```json
{ "sent": 0, "candidates": 0, "errored": 0, "total": <opt-in count> }
```

`candidates` will be > 0 only when at least one user is in the
sunset-15-30-min window AND hasn't been pinged yet today. The window
is short (15 min wide) and tied to local sunset, so most invocations
return `0` — that's expected.

## Test via Supabase JS

From a Node REPL or a short script with the service-role key:

```ts
import { createClient } from '@supabase/supabase-js';
const db = createClient(SUPABASE_URL, SERVICE_ROLE_KEY);
const { data, error } = await db.functions.invoke('kairos-fire', {
  headers: { 'X-Cron-Secret': process.env.CRON_SECRET! },
});
console.log({ data, error });
```

## Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| Response is `{ "error": "vapid_unconfigured" }` | `VAPID_PUBLIC_KEY` or `VAPID_PRIVATE_KEY` missing on the EF | See `rotate-secret.md` → VAPID keys, then redeploy. |
| Response is `403 forbidden` | `X-Cron-Secret` header missing or stale | Verify Vault and GitHub secret match; rotate via `rotate-secret.md`. |
| `candidates` > 0 but `sent` = 0 | Push endpoints returning 4xx — the SW endpoint may have changed (browser uninstall, extension cleanup) | EF auto-deletes 404/410 endpoints. Check `errored` for transient 5xx. |
| User never receives push | `notification` permission revoked, or device offline at fire time | Web Push has at-most-once semantics; the EF doesn't queue. Wait for next day. |
| User got TWO pushes today | Should not happen — `last_sent_at` is updated atomically. If it does, file an incident with the row's `last_sent_at` and the EF logs. | |

## Manual opt-in / opt-out via psql

```sql
-- Opt user into golden_hour
INSERT INTO public.kairos_subscriptions (user_id, kind, opt_in)
VALUES ('<uuid>', 'golden_hour', true)
ON CONFLICT (user_id, kind) DO UPDATE SET opt_in = true, updated_at = now();

-- Reset their last_sent_at so they can be pinged today
UPDATE public.kairos_subscriptions
   SET last_sent_at = NULL
 WHERE user_id = '<uuid>' AND kind = 'golden_hour';

-- Opt user out (preserves the row)
UPDATE public.kairos_subscriptions
   SET opt_in = false, updated_at = now()
 WHERE user_id = '<uuid>' AND kind = 'golden_hour';
```

## v1.1 follow-ups (separate issues)

- After-rain trigger.
- Migration window trigger.
- Lunar event trigger.
- Encrypted payloads (RFC 8291) so the SW can render per-place copy.
