# sponsorships Edge Function

CRUD for AI sponsorship credentials and beneficiaries. JWT-gated except `/heartbeat` (cron-only).

## Secrets required

| Name | Source |
|---|---|
| `SUPABASE_URL` | Project default |
| `SUPABASE_SERVICE_ROLE_KEY` | Project default |
| `SPONSORSHIPS_CRON_TOKEN` | `gh secret set SPONSORSHIPS_CRON_TOKEN` (matches `app.cron_token` PG setting) |

## Deploy

Auto-deploys on push to `main` when files under `supabase/functions/sponsorships/**` change (since PR #62). Manual:

```bash
gh workflow run deploy-functions.yml --ref main -f function=sponsorships
```

## Endpoints

| Method | Path | Purpose | Auth |
|---|---|---|---|
| POST   | `/credentials` | Create + Vault-store | JWT |
| GET    | `/credentials` | List own (no secret) | JWT |
| POST   | `/credentials/:id/rotate` | Atomic Vault swap; reactivates `cred:invalid`-paused sponsorships | JWT (owner) |
| DELETE | `/credentials/:id` | Soft revoke + cascade pause | JWT (owner) |
| POST   | `/sponsorships` | Create | JWT (sponsor) |
| GET    | `/sponsorships?role=sponsor\|beneficiary` | List | JWT |
| PATCH  | `/sponsorships/:id` | Update cap/priority/status/visibility (role-gated fields) | JWT |
| POST   | `/sponsorships/:id/unpause` | Reactivate after auto-pause; 409 on 3-strike | JWT (sponsor) |
| DELETE | `/sponsorships/:id` | Revoke (either party) | JWT |
| GET    | `/sponsorships/:id/usage` | Analytics | JWT (party) |
| POST   | `/heartbeat` | Cron-only credential probe | Bearer cron token |
