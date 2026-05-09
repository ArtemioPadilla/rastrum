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

## Production deploy checklist (operator action required)

Closes the post-merge ops gap on [#777](https://github.com/ArtemioPadilla/rastrum/pull/777):
without VAPID keys configured, `kairos-fire` cron runs every 15 min and
returns `{ "error": "vapid_unconfigured" }` on every iteration — the EF
exits before touching `push_subscriptions`, so failures are silent
(no exceptions raised, no rows updated). Run this checklist once after
merging M34, then again any time the keys are rotated.

The full rotation flow (and why each env var exists) lives in
[`rotate-secret.md`](rotate-secret.md) → "VAPID keys"; the steps below
are the minimum kairos operator path.

### Generate VAPID key pair (one-time)

```bash
npx web-push generate-vapid-keys --json
# → { "publicKey": "B…", "privateKey": "Y…" }
```

Both halves are base64url-encoded EC P-256. The public key is 65 bytes
raw (uncompressed, starts with `0x04`); the private key is a 32-byte
scalar. `supabase/functions/_shared/web-push.ts` validates the public
key shape on import — a wrong-format key surfaces as
`VAPID public key must be uncompressed (65 bytes, starts with 0x04)`.

### Set env vars in Supabase (Edge Functions)

```bash
gh secret set VAPID_PUBLIC_KEY              # paste publicKey
gh secret set VAPID_PRIVATE_KEY             # paste privateKey
gh secret set VAPID_SUBJECT                 # paste mailto:owner@rastrum.org
```

Or via the Supabase dashboard: Project Settings → Edge Functions →
Secrets. `VAPID_SUBJECT` MUST be a `mailto:` URL or an https origin —
RFC 8292 requires the JWT `sub` claim to be one of the two; FCM/APNS
will 401 otherwise.

### Set client-exposed env var

```bash
gh secret set PUBLIC_VAPID_PUBLIC_KEY       # SAME value as VAPID_PUBLIC_KEY
```

Must match the Supabase `VAPID_PUBLIC_KEY` exactly. The browser pins the
subscription to this public key; if the static bundle and the EF disagree,
every push will 4xx and the EF will treat each subscription as dead.

### Verify deploy

1. **Re-deploy the EF and the static bundle:**

   ```bash
   gh workflow run deploy-functions.yml --ref main -f function=kairos-fire
   gh workflow run deploy.yml --ref main
   gh run watch
   ```

2. **Manual fire** (mirrors the `recompute-streaks` curl-with-CRON_SECRET
   pattern documented in [`cron-secret-rotation.md`](cron-secret-rotation.md)):

   ```bash
   curl -sS -X POST \
     https://reppvlqejgoqvitturxp.supabase.co/functions/v1/kairos-fire \
     -H "X-Cron-Secret: $CRON_SECRET" \
     -H "Content-Type: application/json" \
     -d '{}'
   # Expected: { "sent": 0, "candidates": 0, "errored": 0, "total": <n> }
   # NOT expected: { "error": "vapid_unconfigured", "sent": 0 }
   ```

   If the response is `vapid_unconfigured`, the secrets didn't reach
   the EF — re-check the Supabase dashboard secrets list and re-deploy.

3. **Opt in on a signed-in dev account** at `/profile/notifications/`
   (EN) or `/perfil/notificaciones/` (ES). Toggling on must (a) prompt
   for the browser notification permission, (b) call
   `pushManager.subscribe()` with the `PUBLIC_VAPID_PUBLIC_KEY`, and
   (c) upsert a row into `public.push_subscriptions`. Verify:

   ```sql
   SELECT user_id, endpoint, created_at
     FROM public.push_subscriptions
    ORDER BY created_at DESC
    LIMIT 5;
   ```

4. **Force-fire a real push at yourself.** The 15-min cron only fires
   when local time is in `[sunset-30min, sunset-15min]` AND
   `last_sent_at` is NULL or stale. To test out-of-window:

   ```sql
   UPDATE public.kairos_subscriptions
      SET last_sent_at = NULL
    WHERE user_id = '<you>' AND kind = 'golden_hour';
   ```

   Set your laptop clock to ~25 min before local sunset, then run the
   manual-fire curl above. Expected response: `"sent": 1` and a push
   notification rendered by the SW with golden-hour copy. If `sent` is
   1 but no notification arrives, the SW handler may not be wired —
   verify `_shared/web-push.ts` is imported by `kairos-fire/index.ts`
   (see Troubleshooting below).

### Rotation (key compromise / yearly hygiene)

Use the same flow above with new keys. The full secret-rotation flow
lives in [`rotate-secret.md`](rotate-secret.md) → "VAPID keys".

**User-visible side effect:** every existing push subscription is tied
to the old public key from the browser's perspective; after rotation
the next push attempt to each subscription will 410, and the EF reaps
those rows automatically. Users must re-toggle on
`/profile/notifications/` to re-subscribe under the new key. The
in-app toast surfaced after rotation reads:

> "Notifications re-subscribed required after operator key rotation."

To force-clear instead of waiting for the 410 reap:

```sql
DELETE FROM public.push_subscriptions;
```

### Troubleshooting

| Symptom | Likely cause | Fix |
|---|---|---|
| `{ "error": "vapid_unconfigured" }` | `VAPID_PUBLIC_KEY` or `VAPID_PRIVATE_KEY` missing on the EF | Re-set the Supabase secrets and re-deploy `kairos-fire`. |
| Push 401 from FCM/APNS endpoint (visible in `errored`) | `VAPID_SUBJECT` not a `mailto:` URL or an https origin, or the public/private keys are mismatched halves | Verify `VAPID_SUBJECT` per RFC 8292; regenerate the pair if half is missing. |
| No `push_subscriptions` rows after opt-in | `PUBLIC_VAPID_PUBLIC_KEY` is missing or doesn't match `VAPID_PUBLIC_KEY` on the EF | Re-set the GitHub secret to the SAME value as the Supabase secret and re-deploy `deploy.yml`. |
| Cron fires `"sent": 1` but no notification arrives | SW push handler not wired, or `_shared/web-push.ts` import path stale | Check `supabase/functions/kairos-fire/index.ts` imports `sendPushNoPayload` from `../_shared/web-push.ts`, and that the SW (`public/sw.js`) has a `push` event listener rendering the kairos copy. |
| `errored` > 0 with 5xx statuses | Transient FCM/APNS outage | Retry on the next 15-min tick. The EF doesn't queue. |
| `errored` > 0 with 410 statuses | Browser uninstalled the SW or the user revoked permission | The EF auto-deletes 404/410 endpoints. No action needed. |

## v1.1 follow-ups (separate issues)

- After-rain trigger.
- Migration window trigger.
- Lunar event trigger.
- Encrypted payloads (RFC 8291) so the SW can render per-place copy.
