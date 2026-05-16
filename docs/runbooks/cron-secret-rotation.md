# Cron Secret Rotation — `CRON_SECRET`

`CRON_SECRET` guards the cron-triggered Edge Functions (those that
self-gate via `_shared/cron-auth.ts` `requireCronSecret`, or their own
inline `authOk`) against unauthenticated POST requests. This document
covers the architecture, the safe rotation order, and first-time
bootstrap.

## Architecture & invariants (read this first)

`CRON_SECRET` lives in **three independent stores that must all hold the
exact same value**:

| Store | Read by | Set via |
|---|---|---|
| **Edge Function env secret** `CRON_SECRET` | `Deno.env.get('CRON_SECRET')` inside every cron EF (`requireCronSecret`) | Supabase dashboard → Edge Functions → Secrets |
| **Vault** secret **`cron_secret`** (lowercase!) | pg_cron jobs: `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'cron_secret')` builds the `X-Cron-Secret` header | Supabase dashboard → Vault |
| **GitHub Actions** repo secret `CRON_SECRET` | `enrich-taxa.yml`, `community-backfill.yml` | `gh secret set CRON_SECRET` |

Two failure modes that are NOT a secret mismatch and bite first:

1. **The EF must be deployed `--no-verify-jwt`.** pg_cron sends no
   `Authorization` bearer. If the function deploys with
   `verify_jwt=true`, the Supabase **gateway 401s the request before
   the function code (and the `CRON_SECRET` check) ever runs**. Every
   cron EF must be in `CRON_ONLY` (or, if it also serves user traffic,
   `OTHER_NO_JWT`) in `.github/workflows/deploy-functions.yml` **and**
   `verify_jwt = false` in `supabase/config.toml`. The deploy flag wins
   in prod; keep both sites in sync. `--no-verify-jwt` is applied at
   deploy time and is **not retroactive** — a function only picks it up
   when actually redeployed.
2. **`cron.job_run_details` lies.** pg_net is async; the cron job
   reports `succeeded` the instant the request is *enqueued*,
   regardless of the HTTP response. **`net._http_response` is the
   source of truth** for what the EF actually returned.

The status ladder when debugging: **401** = gateway (verify_jwt still
on) · **500 `CRON_SECRET unset on EF`** = EF env secret missing · **403
`forbidden`** = EF env value ≠ the `X-Cron-Secret` pg_cron sent (Vault
mismatch) · **500 `permission denied for table`** = a different bug
(service_role table GRANT, not auth).

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

1. Find the existing entry **`cron_secret`** (lowercase — the SQL reads
   `WHERE name = 'cron_secret'`)
2. Click **Edit** → paste the new value → **Save**

The pg_cron schedules read this via `vault.decrypted_secrets` at query time, so the
next cron run will automatically pick up the new value. No DB migration needed.

> Note: the SQL editor's role usually **cannot** `SELECT` from
> `vault.decrypted_secrets` (returns no rows even when the secret
> exists) — pg_cron runs as a privileged role that can. Don't conclude
> "the secret is missing" from an empty SQL-editor query; use the Vault
> UI.

### Step 2b — Sync the Edge Function env secret

In the Supabase dashboard → **Edge Functions → Secrets**, set
`CRON_SECRET` to the **same value**. This is what `requireCronSecret`
reads (`Deno.env.get('CRON_SECRET')`); a Vault-only update leaves every
cron EF returning `500 CRON_SECRET unset on EF` / `403`.

### Step 3 — Update the GitHub Secret

In the GitHub repo → **Settings → Secrets and variables → Actions**:

1. Find `CRON_SECRET`
2. Click **Update** → paste the new value → **Save**

This updates the `enrich-taxa.yml` and `community-backfill.yml`
workflows so their scheduled/manual triggers keep working.

### Step 4 — Verify

`cron.job_run_details` is misleading (it shows `succeeded` for an
enqueued-but-failed request). Verify against **`net._http_response`**
instead, after the next scheduled tick:

```sql
SELECT status_code, left(content, 140) AS body, created
FROM net._http_response
WHERE created >= now() - interval '20 minutes'
ORDER BY created DESC;
```

Every recent cron EF call should be `200`. A `403` means the three
stores are out of sync (re-check they hold the identical value).

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

## Protected functions (gate on `X-Cron-Secret`; in `CRON_ONLY`)

`recompute-streaks`, `award-badges`, `plantnet-monitor`, `streak-push`,
`recompute-user-stats` (also used by `community-backfill.yml`),
`retry-unidentified`, `enrich-taxon` (also `enrich-taxa.yml`),
`refresh-taxon-ranges`, `kairos-fire`, `recompute-taxa-cache`,
`weekly-digest`, `refresh-conservation-status`, `gc-orphan-media`.

The authoritative list is the `CRON_ONLY` string in
`.github/workflows/deploy-functions.yml` (line ~214). **Adding a new
cron-triggered EF means adding it there AND a `verify_jwt = false`
block in `supabase/config.toml`** — otherwise the gateway 401s it.

## NOT verify_jwt, but not pure-cron (`OTHER_NO_JWT`)

| Function | Reason |
|---|---|
| `share-card` | Public OG scrapers (Twitter/Facebook) need anonymous access |
| `mcp` / `api` | Gate internally on `rst_*` tokens (not JWTs) |
| `identify` | Self-gates: `auth.getUser` when JWT present, else anon IP rate-limit |
| `sponsorships` | Self-gates: user JWT for UI paths + Bearer cron token for the weekly `ai_credentials_heartbeat` job |

---

## Bootstrap (first-time setup)

If `CRON_SECRET` doesn't exist yet (all three stores empty → cron EFs
return `500 CRON_SECRET unset on EF`):

1. Generate: `openssl rand -hex 32` (in your own terminal; keep it in a
   password manager — never paste it into a transcript or commit it)
2. **Edge Functions → Secrets**: add `CRON_SECRET` = the value
3. **Vault → Add secret**: name **`cron_secret`** (lowercase) = the same value
4. **GitHub → Settings → Secrets → Actions**: `gh secret set CRON_SECRET` = the same value
5. Re-run `db-apply.yml` so `cron-schedules.sql` is (re)applied with the Vault reads
6. Confirm every cron EF is in `CRON_ONLY`/`OTHER_NO_JWT` **and** has a
   `verify_jwt = false` block in `config.toml`, then redeploy them
   (`gh workflow run deploy-functions.yml -f function=all`) so the
   `--no-verify-jwt` flag is actually applied — it is not retroactive.
7. Verify via the `net._http_response` query in Step 4 (not
   `cron.job_run_details`).

---

## Token leak response

If the secret is suspected to be leaked:
1. **Immediately** rotate (start at Step 1 above)
2. Check Supabase EF logs for unusual POST patterns in the last 24h
3. Check pg_cron run history for unexpected extra runs

---

## Cross-links

- **VAPID keys** (parallel procedure for Web Push signing keys): [`vapid-keys-deploy.md`](vapid-keys-deploy.md)
- Kairos pipeline that uses both secrets: [`kairos-prompts.md`](kairos-prompts.md)
