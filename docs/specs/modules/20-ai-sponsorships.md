# Module 20 — AI Sponsorships

**Status:** in implementation (PR feat/ai-sponsorships)
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
