# Weekly Digest — Operator Runbook

**Issue:** #868  
**Edge Functions:** `weekly-digest`, `email-unsubscribe`  
**Trigger:** pg_cron, every hour (`0 * * * *`)

---

## Required Environment Variables (Supabase Vault Secrets)

| Secret | Description |
|---|---|
| `RESEND_API_KEY` | Resend API key for outbound email — already in use |
| `CRON_SECRET` | Shared secret; sent in `Authorization: Bearer <secret>` header by pg_cron |
| `UNSUBSCRIBE_SECRET` | Random secret used to sign HMAC-SHA256 unsubscribe tokens |
| `SUPABASE_URL` | Injected automatically by Supabase EF runtime |
| `SUPABASE_SERVICE_ROLE_KEY` | Injected automatically by Supabase EF runtime |

### Generate `UNSUBSCRIBE_SECRET`

```bash
openssl rand -hex 32
```

Set it in Supabase Dashboard → **Project Settings → Edge Functions → Secrets**.

---

## Deploy Edge Functions

```bash
supabase functions deploy weekly-digest
supabase functions deploy email-unsubscribe
```

---

## Apply Schema Migration

```bash
# From repo root — append the #868 block to your migration:
psql "$DATABASE_URL" -c "
  ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS email_notifications_enabled boolean NOT NULL DEFAULT true;
  ALTER TABLE public.users
    ADD COLUMN IF NOT EXISTS last_digest_sent_at timestamptz;
"
```

Then register the cron job (once per project):

```sql
SELECT cron.schedule(
  'weekly-digest',
  '0 * * * *',
  $$SELECT net.http_post(
    url     := current_setting('app.supabase_url') || '/functions/v1/weekly-digest',
    headers := jsonb_build_object(
      'Authorization', 'Bearer ' || current_setting('app.cron_secret')
    ),
    body    := '{}'::jsonb
  )$$
);
```

---

## Manual Fire (Testing)

```bash
curl -X POST \
  "https://<project>.supabase.co/functions/v1/weekly-digest" \
  -H "Authorization: Bearer $CRON_SECRET" \
  -H "Content-Type: application/json" \
  -d '{}'
```

Expected response:

```json
{ "total_eligible": 12, "sent": 12, "failed": 0 }
```

---

## Unsubscribe Flow

1. Each digest email contains a footer link:  
   `https://rastrum.org/{lang}/unsubscribe?token={hmac}&uid={user_id}`
2. The HMAC is `HMAC-SHA256(uid + "weekly-digest", UNSUBSCRIBE_SECRET)`, hex-encoded.
3. `email-unsubscribe` EF validates the HMAC and sets `email_notifications_enabled = false`.
4. User is redirected to `/en/profile/notifications` (or `/es/...`) on success.

---

## Rotate `CRON_SECRET`

See [`docs/runbooks/cron-secret-rotation.md`](./cron-secret-rotation.md) for the full procedure.

---

## Rotate `UNSUBSCRIBE_SECRET`

> ⚠️ Rotating invalidates all existing unsubscribe links in sent emails. Only rotate if the secret is compromised.

1. Generate a new secret: `openssl rand -hex 32`
2. Update the Supabase Vault secret `UNSUBSCRIBE_SECRET`.
3. Redeploy both Edge Functions: `supabase functions deploy weekly-digest && supabase functions deploy email-unsubscribe`

---

## Disable Digest for All Users (Emergency)

```sql
-- Disable the cron schedule
SELECT cron.unschedule('weekly-digest');

-- Or unsubscribe everyone
UPDATE public.users SET email_notifications_enabled = false;
```

---

## Monitoring

- Check **Supabase Dashboard → Edge Function Logs** for `weekly-digest` errors.
- The function logs `[weekly-digest] error for user <uid>` per user failure.
- Response body includes `errors[]` array on partial failure.
- `last_digest_sent_at` on the `users` table tracks send history.
