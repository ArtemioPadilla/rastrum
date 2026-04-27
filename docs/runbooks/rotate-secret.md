# Runbook — Rotating a leaked secret

> Use this whenever a secret is exposed: pasted in chat, committed to
> git, captured in a screenshot, dumped to logs, screen-shared, or
> otherwise out of your control. Treat the worst case (it's been
> indexed by a search engine) until proven otherwise.

The order is fixed: **rotate first, audit second, communicate third.**
A leaked key is "live" the second it leaves your machine — every minute
between exposure and rotation is exploitable. Don't audit, don't
brainstorm causes, don't drop a ticket. Rotate.

---

## 1. Rotate first

Pick the section that matches what leaked. Each rotation is idempotent;
running it twice is fine. Each ends with the new secret deployed
through CI so a stale workflow can't reuse the old one.

### PlantNet API key (`PUBLIC_PLANTNET_KEY`)

This is one of the rare "PUBLIC_" prefixed secrets — it ends up in the
client bundle so leaking it is functionally a key swap, not a database
exposure. Still rotate, because PlantNet quotas are per-key.

```bash
# 1. Revoke the leaked key on PlantNet:
#    https://my.plantnet.org/account → Tokens → Revoke

# 2. Generate a new key on the same page.

# 3. Push it into the repo:
gh secret set PUBLIC_PLANTNET_KEY

# 4. Re-deploy the static site so the new key ships in the bundle:
gh workflow run deploy.yml --ref main
gh run watch
```

End users on cached HTML keep using the old key for up to one
service-worker cycle. If the leak is severe (key hit the wild), tell
users to hard-refresh (`Cmd+Shift+R` or close + reopen the tab).

### Anthropic API key (`ANTHROPIC_API_KEY`)

Two flavours:

- **Operator key** (set as a Supabase secret on the `identify` Edge
  Function — used for free-tier cascade fallback when the user has no
  BYO key).
- **User BYO key** (lives in the user's `localStorage[rastrum.byoKeys]`,
  forwarded per-call as `client_keys.anthropic` and never persisted
  server-side).

```bash
# Operator key:
# 1. Revoke at console.anthropic.com → API Keys → Revoke.
# 2. Issue a new key.
# 3. Update Supabase secret:
gh secret set ANTHROPIC_API_KEY     # if used by Edge Functions
# Or Dashboard → Project Settings → Edge Functions → Secrets → ANTHROPIC_API_KEY.
# 4. Re-deploy the identify function:
gh workflow run deploy-functions.yml -f function=identify
```

If the leaked key was a **user BYO key** (e.g. user pasted theirs in a
public bug report):

1. Tell that user to revoke at `console.anthropic.com` → API Keys.
2. Tell them to update at `https://rastrum.org/profile/edit` (BYO Keys
   section → Anthropic → Clear → enter new).
3. No server-side action needed — Rastrum never stored it.

### Supabase service role key (`SUPABASE_SERVICE_ROLE_KEY`)

This is the highest-blast-radius secret in the system. Bypasses RLS,
talks to every table.

```bash
# 1. Roll the key:
#    Dashboard → Project Settings → API → service_role → Roll
#    (the dashboard generates a new key and immediately invalidates the old one).

# 2. Update the GitHub Actions secret:
gh secret set SUPABASE_SERVICE_ROLE_KEY

# 3. Update any operator-side env (.env.local, Make targets relying on
#    PGURL with the service-role key embedded). Verify with:
make db-verify

# 4. Re-deploy every Edge Function that uses it:
gh workflow run deploy-functions.yml -f function=all
gh run watch
```

### Cloudflare R2 access key (`R2_ACCESS_KEY_ID` + `R2_SECRET_ACCESS_KEY`)

```bash
# 1. Cloudflare → R2 → Manage R2 API Tokens → revoke the leaked token.
# 2. Create a new token scoped to the rastrum-media bucket only.
#    Permissions: Object Read + Write.
# 3. Push both halves:
gh secret set R2_ACCESS_KEY_ID
gh secret set R2_SECRET_ACCESS_KEY
# 4. Re-deploy the Edge Functions that sign uploads:
gh workflow run deploy-functions.yml -f function=get-upload-url
gh workflow run deploy-functions.yml -f function=share-card
```

Verify a fresh presigned URL works against `media.rastrum.org/...`
before closing the incident.

### User API token (`rst_*`)

The simplest case. Tokens are SHA-256 hashed at rest, scoped per-row.

1. User visits `https://rastrum.org/profile/tokens`.
2. Clicks "Revoke" on the leaked row. Done.
3. (Optional) Issue a replacement and update the consumer
   (Claude Desktop config, Copilot Coding Agent secret, MCP client, …).

No further server action is needed. Revocation is immediate (the
`api` and `mcp` Edge Functions read `user_api_tokens` per request and
will reject the next call).

### Other secrets you might encounter

- **`PUBLIC_SUPABASE_URL` / `PUBLIC_SUPABASE_ANON_KEY`** — these are
  meant to be public (RLS is the protection layer). Leaking them is
  not an incident. Don't rotate.
- **GitHub Actions OIDC tokens** — short-lived (hours). Investigate
  the workflow that produced them but don't try to "rotate" the
  token; it's already expired.
- **Custom SMTP password (Resend, Gmail App Password)** — revoke at
  the provider, generate new, update Supabase Auth → SMTP.

---

## 2. Audit

Once the secret is dead, look at what happened with it before you
killed it.

- **Supabase logs.** Dashboard → Logs Explorer → filter by
  `request.headers.authorization` or by IP. For service-role abuse,
  filter by `auth_method = service_role` for the exposure window.
  Look for: bulk reads of `users`, writes to `observations` from
  unfamiliar IPs, attempts to delete RLS policies.
- **R2 bucket access.** Cloudflare → R2 → `rastrum-media` → Metrics.
  Look at object download volume by IP for the exposure window.
  Anomalies: large `LIST` operations, downloads from regions the user
  base doesn't live in.
- **PlantNet quota.** my.plantnet.org → API tokens → look at the
  per-day call count. A spike = someone else used your key.
- **Anthropic console.** Check usage by API key for the exposure
  window. Anthropic also has IP-based audit logs accessible via support
  if you need them.
- **GitHub Actions runs.** Has a workflow run that you didn't trigger
  used the secret? `gh run list --workflow deploy.yml` and look for
  unexpected `actor` fields.

Document the audit in a private note (don't open a public issue with
the leaked-key value in the title). If user data was touched, escalate
to step 3.

---

## 3. Communicate

Most rotations stop at step 2 — no user data implicated, just clean
up internal docs and move on. Communicate when:

- The leaked secret could read `users`, `observations`, or `media_files`
  rows it shouldn't (service-role, R2 keys, or a misconfigured
  function).
- A user-supplied BYO key is involved (tell that user, even if no
  data of theirs leaked from Rastrum).
- The audit shows a non-zero number of "unexpected" requests.

When you do communicate:

- **GitHub Discussions.** Post in the security category with a
  redacted timeline (when, what, what was rotated, what you found).
  Don't include the leaked value or any sample of suspicious data.
- **Email affected users** if rows in `users` were touched. Use the
  Supabase Auth admin API or pgsql to scope to the affected
  `auth.users.email`. Be specific: what data, what you've done, what
  they should do.
- **Update `AGENTS.md`** if the leak was caused by a development
  workflow gap — add a row to the "things you should NOT do without
  asking" list so the next contributor sees it.

---

## After the dust settles

- File a follow-up to harden whatever leaked the secret in the first
  place: pre-commit hook (e.g. `gitleaks`), CI scan, screenshot redact
  workflow, etc. Most leaks are repeats.
- If the rotation invalidated a long-running cron, re-run
  `make db-cron-test` to confirm the nightly jobs still authenticate.
- If the rotation was for a key referenced in docs (like an example
  `PUBLIC_PLANTNET_KEY` value), search the repo and replace the dummy
  value so we don't redocument the leaked one.

```bash
# Quick sweep for accidental committed secrets:
git log --all -p -G '(rst_|sk-ant-|sb_publishable_|sb_service_|cf_)' \
  --source --remotes | head -50
```

If that returns hits, treat each as a fresh leak and re-run this
runbook from the top.
