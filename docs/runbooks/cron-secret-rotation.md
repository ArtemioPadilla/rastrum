# Cron Secret Rotation — `CRON_SECRET`

The `CRON_SECRET` guards 5 cron-only Edge Functions against unauthenticated POST requests.
This document describes how to rotate the secret safely.

## ⚠️ Order matters — follow exactly

Rotating in the wrong order will cause cron jobs to start failing (403) before the
new secret is live, creating a window where scheduled tasks are silently skipped.

---

## Rotation procedure

### Step 1 — Generate a new secret

```bash
openssl rand -hex 32
# e.g.: a3f8c2...
```

Save it somewhere temporary (password manager). Do NOT commit it anywhere.

### Step 2 — Add the new secret to Supabase Vault

In the Supabase dashboard → **Project Settings → Vault**:

1. Find the existing entry `cron_secret`
2. Click **Edit** → paste the new value → **Save**

The pg_cron schedules read this via `vault.decrypted_secrets` at query time, so the
next cron run will automatically pick up the new value. No DB migration needed.

### Step 3 — Update the GitHub Secret

In the GitHub repo → **Settings → Secrets and variables → Actions**:

1. Find `CRON_SECRET`
2. Click **Update** → paste the new value → **Save**

This updates the `community-backfill.yml` workflow so manual triggers continue to work.

### Step 4 — Verify

After the next scheduled cron run (check Supabase cron logs):
```sql
SELECT jobname, last_run_status, last_run_at
FROM cron.job_run_details
ORDER BY last_run_at DESC
LIMIT 10;
```

All 5 jobs should show `succeeded`.

For manual verification:
```bash
curl -sS -X POST \
  https://reppvlqejgoqvitturxp.supabase.co/functions/v1/recompute-streaks \
  -H "X-Cron-Secret: <new-secret>" \
  -H "Content-Type: application/json" \
  -d '{}'
# Should return 200 with job result
```

```bash
curl -sS -X POST \
  https://reppvlqejgoqvitturxp.supabase.co/functions/v1/recompute-streaks \
  -H "Content-Type: application/json" \
  -d '{}'
# Should return 403 forbidden
```

---

## Protected functions

| Function | Schedule | Notes |
|---|---|---|
| `recompute-streaks` | 07:00 UTC daily | |
| `award-badges` | 07:30 UTC daily | |
| `plantnet-monitor` | 23:55 UTC daily | |
| `streak-push` | 01:55 UTC daily | |
| `recompute-user-stats` | 08:00 UTC daily | Also used by `community-backfill.yml` |

## NOT protected (intentional)

| Function | Reason |
|---|---|
| `share-card` | Public OG scrapers (Twitter/Facebook) need anonymous access |
| `mcp` | Uses `rst_*` token model |
| `api` | Uses `rst_*` token model |

---

## Bootstrap (first-time setup)

If `CRON_SECRET` doesn't exist yet:

1. Generate: `openssl rand -hex 32`
2. Add to Vault: Supabase dashboard → Vault → **Add secret** → name: `cron_secret`
3. Add to GitHub: Settings → Secrets → **New repository secret** → `CRON_SECRET`
4. Re-run `db-apply.yml` to push the updated `cron-schedules.sql` (with Vault reads)

---

## Token leak response

If the secret is suspected to be leaked:
1. **Immediately** rotate (start at Step 1 above)
2. Check Supabase EF logs for unusual POST patterns in the last 24h
3. Check pg_cron run history for unexpected extra runs
