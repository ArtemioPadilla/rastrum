# Social features — operator runbook

> Module 26 (asymmetric follow + reactions + reports + inbox).
> Last updated 2026-04-29.

This runbook covers the operator-side of the social layer: env vars,
email setup, monitoring, and when each surface fails what to look at
first.

---

## Required env vars

| Secret (GitHub Actions) | Used by | Notes |
|---|---|---|
| `SUPABASE_DB_URL` | `db-apply.yml` | Already required pre-M26 — applies the schema + cron. |
| `SUPABASE_ACCESS_TOKEN` | `deploy-functions.yml` | Already required pre-M26. |
| `RESEND_API_KEY` | `report` Edge Function | NEW. Without it the function still inserts the row and returns 200 — only the operator email is best-effort suppressed. Free tier: 100 emails/day. |
| `OPERATOR_EMAIL` | `report` Edge Function | NEW. Defaults to `artemiopadilla@gmail.com` if unset; override per environment. |

The deploy-functions workflow auto-syncs all of the above into
Supabase Edge Function secrets when `sync_secrets=true` (the
`workflow_dispatch` default). Push-triggered auto-deploys never
sync secrets — that path is reserved for explicit dispatch.

---

## Email deliverability (`reports@rastrum.org`)

The `report` Edge Function sends the operator email via Resend with
`from: "reports@rastrum.org"`. For deliverability:

1. **Verify the `rastrum.org` domain in Resend dashboard.** Add the
   DKIM CNAME records they provide to your DNS (Cloudflare).
2. **Add SPF for `rastrum.org`:**
   ```
   v=spf1 include:_spf.resend.com ~all
   ```
3. **Optional — DMARC** at `_dmarc.rastrum.org`:
   ```
   v=DMARC1; p=none; rua=mailto:dmarc@rastrum.org
   ```

Without DKIM/SPF, Resend may drop messages or Gmail / iCloud may
silently spam-filter them. The function never fails the user request
on email error — check the Resend dashboard if a report didn't land.

---

## Schema apply

The m26 schema is part of `docs/specs/infra/supabase-schema.sql` and
auto-applies on push to `main` via `db-apply.yml` when the SQL file
changes. To force a re-apply (for example, after editing a single
trigger):

```bash
gh workflow run db-apply.yml --ref main
gh run watch
```

The 90-day notification prune cron is in
`docs/specs/infra/cron-schedules.sql`; `make db-cron-schedule` (or
the workflow on push) re-registers it idempotently.

To smoke-test the schema after apply:

```bash
psql "$SUPABASE_DB_URL" -f tests/sql/social-rls.sql
# expects: NOTICE:  social-rls regression OK
```

---

## When something breaks — first look

| Symptom | First check |
|---|---|
| Bell shows no badge for a user with unread notifications | `select count(*) from public.notifications where user_id = '<uid>' and read_at is null` — if 0, the issue is upstream (trigger fan-out or the source action). If > 0, investigate the BellIcon poll (browser console, network tab). |
| Follow button never moves off "Follow" after clicking | Edge Function logs in Supabase dashboard → `follow`. Common cause: rate-limit (429 `rate_limited`) — the user hit 30 follows/hr or 5 collab requests/day. |
| Reactions disappear after toggling | Most likely RLS — a reaction row exists in the table but the viewer's RLS predicate filters it (e.g., the observation became `obscure_level = 'full'`, or one of the parties blocked the other). |
| Report submitted but no email arrives | `reports` table has the row? If yes, check Resend dashboard for delivery / bounce. If no, check the `report` Edge Function logs for an error other than email. |
| Unread badge stays at "9+" forever | The 90-day prune cron only deletes **read** notifications. A user with 100+ unread will see "9+" until they mark-all-read. The "mark all read" button at the top of `/inbox/` does this in one update. |
| `db-apply` workflow fails after a schema change | Run it manually via `gh run view <id> --log-failed`. The most common cause is a SQL incompatibility (e.g., the `min(uuid)` bug fixed in PR #62 — Postgres lacks `min()` for the uuid type; cast through text). |

---

## Operations / monitoring

There is no dedicated `social_metrics` view yet — `progress.json`
tracks it as a follow-up. For now:

- **Daily volume:**
  ```sql
  select date_trunc('day', created_at) as d, count(*)
    from public.notifications group by 1 order by 1 desc limit 30;
  ```
- **Most-followed users:**
  ```sql
  select u.username, u.follower_count
    from public.users u
   order by u.follower_count desc nulls last limit 20;
  ```
- **Open reports queue:**
  ```sql
  select * from public.reports where status = 'open' order by created_at desc;
  ```

Reports → moderate by hand for now (set `status` to `triaged` /
`resolved` / `dismissed`); a moderator UI is on the M28+ roadmap.

---

## Useful URLs

| What | URL |
|---|---|
| Resend dashboard | https://resend.com/emails |
| Supabase Edge Function logs | https://supabase.com/dashboard/project/reppvlqejgoqvitturxp/functions |
| Supabase auth users | https://supabase.com/dashboard/project/reppvlqejgoqvitturxp/auth/users |
| GitHub Actions — `deploy-functions.yml` | https://github.com/ArtemioPadilla/rastrum/actions/workflows/deploy-functions.yml |
| GitHub Actions — `db-apply.yml` | https://github.com/ArtemioPadilla/rastrum/actions/workflows/db-apply.yml |

---

## Related runbooks

- [`docs/runbooks/admin-bootstrap.md`](admin-bootstrap.md) — granting
  the first admin role.
- [`docs/runbooks/admin-audit.md`](admin-audit.md) — reading the audit
  log.
- [`docs/runbooks/onboarding-events.md`](onboarding-events.md) —
  onboarding tour signal handling (referenced from the inbox icon
  semantically).
