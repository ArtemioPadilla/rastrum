# Module 27 — AI Sponsorships

**Status:** shipped (v1.3 — PRs #78, #84, #94)
**Related modules:** 04 (auth), 13 (identifier registry), 14 (BYO keys), karma module.
**Design doc:** `docs/superpowers/specs/2026-04-28-ai-sponsorships-design.md`

## Scope

Lets any Rastrum user share their Anthropic credential (API key or long-lived OAuth token) with specific beneficiaries. Hard monthly call cap; auto-pause on rate-limit abuse; sponsor karma reward. Removes the operator-key fallback so Claude is invocable only via BYO or sponsorship.

## Out of scope

- Group / club credentials (one pool, many beneficiaries via membership).
- Token-based caps (USD or token count); v1 caps by call count.
- Provider beyond Anthropic in v1 (schema is multi-provider ready).
- Public marketplace of sponsors.

## Tables

`sponsor_credentials`, `sponsorships`, `ai_usage`, `ai_rate_limits`, `ai_usage_monthly`, `ai_errors_log`, `notifications_sent`. All RLS-enabled. See design doc for column-level detail.

## Edge Functions

- `sponsorships` (new) — CRUD for credentials and sponsorships, plus weekly `heartbeat`.
- `identify` (modified) — replaces `ANTHROPIC_API_KEY` fallback with `resolveSponsorship()`.

## Privacy invariants

- Secret value never appears in any SELECT, log, browser-visible state, or audit row. Only `vault_secret_id` is referenced.
- BYO key always wins over sponsorship resolution.
- Sponsor's beneficiary list is public by default (`sponsor_public=true`); beneficiary's "sponsored by" is private by default (`beneficiary_public=false`). Both must opt-in for the relation to appear publicly.

## Karma

`+20` on sponsorship activation, `-20` on revoke/pause; `+1` per call used by beneficiary while under the cap. Self-sponsoring grants no karma. Beneficiary must have ≥10 own karma before per-call karma accrues (Sybil defense).

## Cron jobs

`ai_rate_limits_cleanup` (daily), `ai_usage_monthly_rollup` (nightly), `ai_credentials_heartbeat` (weekly), `ai_notifications_monthly_reset` (1st of month), `ai_errors_log_cleanup` (daily).

## Operator notes

- **`SPONSORSHIPS_CRON_TOKEN`** is upserted to Supabase Vault (as a secret named `sponsorships_cron_token`) by `.github/workflows/db-apply.yml` on every push to `main` that touches `supabase-schema.sql` or `cron-schedules.sql`. The `ai_credentials_heartbeat` pg_cron job reads it via `(SELECT decrypted_secret FROM vault.decrypted_secrets WHERE name = 'sponsorships_cron_token')` to authenticate against the sponsorships Edge Function. We use Vault rather than `ALTER DATABASE … SET` because Supabase managed Postgres restricts database-level GUC writes to superuser. The same secret value is also synced to the Edge Function via `deploy-functions.yml`. To rotate: `gh secret set SPONSORSHIPS_CRON_TOKEN --body $(openssl rand -hex 32)`, then trigger both workflows manually (`gh workflow run db-apply.yml` and `gh workflow run deploy-functions.yml -f function=sponsorships`). No manual `psql` is ever required.
- **`ANTHROPIC_API_KEY`** is **NOT** read by the `identify` Edge Function once this module ships. After cutover, remove the secret from Edge Function env if present (operator step, run via `gh secret delete ANTHROPIC_API_KEY` followed by `gh workflow run deploy-functions.yml -f function=identify` to redeploy without it).

### Email notifications (active)

Threshold (80%/100%) and auto-pause notifications send real emails via Resend SMTP. Requires `RESEND_API_KEY` and `OPERATOR_EMAIL` in Edge Function env (already synced by `deploy-functions.yml`). Idempotency is enforced via `notifications_sent (sponsorship_id, threshold, year_month)` — a sponsor receives at most one 80% email per month and one 100% email per month per sponsorship. Auto-pauses send one email per pause event (no idempotency table; auto-pauses are inherently rare).

If `RESEND_API_KEY` is unset, emails are skipped silently (logged via `console.warn`); sponsorships continue to function — only notifications are degraded.

### Cost notes

- **`validateAnthropicCredential` makes a live Anthropic API call on every credential registration AND on weekly heartbeat.** The probe sends `max_tokens: 1` to `claude-haiku-4-5-20251001` (~$0.0001 per call). Heartbeat processes up to 50 stale credentials per run = ≤50 probe calls per week. Counted against the user's own Anthropic quota (or covered by their Claude subscription for OAT credentials). The `monthly_call_cap` does NOT bound these probe calls.
- **Sponsored `identify` calls add ~3 extra DB round-trips vs BYO**: `resolveSponsorship` (RPC), `decryptCredential` (vault.decrypted_secrets read), `increment_rate_limit_bucket` (RPC). Plus 1 `recordUsage` insert post-call. Acceptable at v1 scale; profile if the quota auto-pause feature ever feels sluggish.

---

## Roadmap — Multi-provider vision (issues #116, #118)

The sponsorship schema and `identify` Edge Function are designed for provider extensibility. Planned providers in order of implementation priority:

| Issue | Provider | Auth | Status |
|---|---|---|---|
| #116 | AWS Bedrock (Claude) | IAM / access keys | Planned |
| #118 | OpenAI direct | `Bearer` API key | Planned |
| #118 | Azure OpenAI | `api-key` + endpoint | Planned |
| #118 | Google Gemini | `x-goog-api-key` | Planned |
| #118 | Google Vertex AI | OAuth2 service account | Planned |

### Provider abstraction target

`supabase/functions/_shared/vision-provider.ts` will define a `VisionProvider` interface. All providers implement `identify(imageBase64, mimeType, prompt, signal?)` and return a normalized `IDResult`. The `identify` Edge Function becomes provider-agnostic.

### Model selection per sponsor (#116)

`sponsor_credentials.preferred_model` and `sponsor_pools.preferred_model` let each sponsor choose the cost/accuracy tradeoff independently. Platform pool defaults to cheapest model per provider. Personal sponsorships can upgrade.

### Credential validation

`anthropic-validate.ts` → `vision-validate.ts` with a per-provider validator. Each makes a 1-token call to verify auth before storing in Vault.
