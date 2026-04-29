# sponsorships Edge Function

CRUD for AI sponsorship credentials and beneficiaries. JWT-gated except `/heartbeat` (cron-only).

## Secrets required

| Name | Source |
|---|---|
| `SUPABASE_URL` | Project default |
| `SUPABASE_SERVICE_ROLE_KEY` | Project default |
| `SPONSORSHIPS_CRON_TOKEN` | `gh secret set SPONSORSHIPS_CRON_TOKEN` (matches `app.cron_token` PG setting) |
| `RESEND_API_KEY` | Used to send threshold + auto-pause emails to sponsors. Already synced by `deploy-functions.yml`. |
| `OPERATOR_EMAIL` | `From:` address for outbound emails (e.g. `hello@rastrum.org`). Already synced by `deploy-functions.yml`. |

## Email notifications

When a sponsorship hits 80% or 100% of its monthly cap, the sponsor receives an HTML+text email via Resend (idempotent — once per (sponsorship, threshold, year_month) row in `notifications_sent`). Auto-pauses also trigger a separate email.

If `RESEND_API_KEY` isn't configured, emails fall back to `console.warn` log lines (no exception thrown — feature degrades gracefully).

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
| POST   | `/requests` | Beneficiary requests sponsorship by `sponsor_username` (+ optional 280-char message) | JWT (requester) |
| GET    | `/requests?role=requester\|sponsor` | List own requests (sent or received) | JWT |
| POST   | `/requests/:id/approve` | Sponsor approves; creates `sponsorships` row inline (`credential_id` + cap) | JWT (sponsor) |
| POST   | `/requests/:id/reject` | Sponsor rejects pending request | JWT (sponsor) |
| DELETE | `/requests/:id` | Requester withdraws own pending request | JWT (requester) |
| POST   | `/heartbeat` | Cron-only credential probe | Bearer cron token |
