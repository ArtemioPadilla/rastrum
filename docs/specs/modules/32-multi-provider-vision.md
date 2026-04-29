# M32 — Multi-provider vision + per-sponsor model + platform pool

> **Status:** v1 in progress.
> **Owner:** Artemio.
> **Surfaces:** `_shared/vision-provider.ts` + extensions to `identify/index.ts` + new `sponsor_pools` schema.
> **Closes:** #115, #116, #118.

This module bundles three closely-coupled M27 extensions that ship together because they share the same provider abstraction:

1. **#116** — AWS Bedrock provider + per-sponsor `preferred_model` (Haiku / Sonnet / Opus or their Bedrock equivalents).
2. **#118** — OpenAI / Azure OpenAI / Google Gemini / Vertex AI providers.
3. **#115** — Platform-wide call pool (`sponsor_pools` table + `consume_pool_slot` RPC).

## Provider abstraction

`supabase/functions/_shared/vision-provider.ts` exports a `VisionProvider` interface implemented by six concrete providers. `buildProvider(credential)` is the single dispatcher; the cascade in `identify/index.ts` calls it once per request.

| `CredentialKind` | Provider class | Auth | Endpoint |
|---|---|---|---|
| `api_key` | AnthropicProvider | `x-api-key` header | `api.anthropic.com` |
| `oauth_token` | AnthropicProvider | `Authorization: Bearer` | `api.anthropic.com` |
| `bedrock` | BedrockProvider | AWS Sig V4 (hand-rolled) | `bedrock-runtime.<region>.amazonaws.com` |
| `openai_api_key` | OpenAIProvider | `Authorization: Bearer` | `api.openai.com` (or override via `endpoint`) |
| `azure_openai` | AzureOpenAIProvider | `api-key` header | full deployment URL in `endpoint` column |
| `gemini_api_key` | GeminiProvider | `?key=` query param | `generativelanguage.googleapis.com` |
| `vertex_ai` | VertexAIProvider | `Authorization: Bearer` (operator-minted access token) | `<region>-aiplatform.googleapis.com` |

Bedrock secrets are JSON envelopes: `{ region, accessKeyId, secretAccessKey, sessionToken? }`. The Sig V4 signer is hand-rolled (~70 LOC) instead of bundling `@aws-sdk/client-bedrock-runtime` (~3 MB) into the Edge Function — the request shape is narrow enough.

Vertex AI access tokens are derived from a service-account JSON; minting the JWT inside an Edge Function is non-trivial, so v1 expects the operator to mint the token offline and store it as `secret`. Auto-rotation is a v1.1 follow-up.

## Schema additions

### Multi-provider (#116, #118)

```sql
ALTER TYPE public.ai_provider          ADD VALUE 'bedrock' / 'openai' / 'azure_openai' / 'gemini' / 'vertex_ai';
ALTER TYPE public.ai_credential_kind   ADD VALUE 'bedrock' / 'openai_api_key' / 'azure_openai' / 'gemini_api_key' / 'vertex_ai';

ALTER TABLE public.sponsor_credentials
  ADD COLUMN preferred_model text NOT NULL DEFAULT 'claude-haiku-4-5',
  ADD COLUMN endpoint        text;  -- Azure URL / Vertex region; NULL for direct providers
```

`resolve_sponsorship` extended to return `preferred_model` + `endpoint` so the cascade can build a `ResolvedCredential` without a second round-trip.

### Platform pool (#115)

```sql
CREATE TABLE public.sponsor_pools (
  id, sponsor_id, credential_id, total_cap, used, monthly_reset,
  status enum('active','paused','exhausted'),
  preferred_model, daily_user_cap, ...
);

CREATE TABLE public.pool_consumption (
  user_id, day, count,
  PRIMARY KEY (user_id, day)
);

CREATE FUNCTION public.consume_pool_slot(p_user_id uuid)
  RETURNS TABLE (pool_id, credential_id, preferred_model);
```

The RPC is `SECURITY DEFINER`, atomic via `FOR UPDATE SKIP LOCKED`, and enforces the per-user `daily_user_cap` before incrementing. Service-role only; the identify EF wraps it with the rest of the work.

## Resolution order in `identify`

```
1. BYO key (client_keys.anthropic) — always wins
2. User's personal sponsorship (existing M27 1-to-1)
3. Platform pool — round-robin via consume_pool_slot()
4. Skip Claude (PlantNet only — no operator-key fallback)
```

## Privacy

- Pool consumers' `user_id` lands in `pool_consumption` but is **never** joined to `auth.users.email` in any RPC visible to a sponsor.
- Sponsors see only aggregate stats (calls used, taxa identified) on their `sponsor_pools` rows — no beneficiary breakdown.

## Out of v1 (tracked)

- UI for picking provider + model in `SponsoringView` (form-only update — backend already enforces).
- "Donate to platform pool" tab in `SponsoringView`.
- Sponsor-facing pool dashboard (capacity / utilization / top taxa).
- Cost-per-100-calls pricing table in the model picker (static, manual updates).
- Vertex AI access-token auto-rotation (mint JWT inside the EF from a service-account JSON in Vault).
- Per-pool monthly reset cron job.
- Pool karma incentives — "donate calls, earn karma" loop.

These follow-ups inherit from this PR's foundation and can ship incrementally without touching the abstraction.

## Testing

- `vision-provider.test.ts` — `buildProvider` exhaustiveness + `parseModelJson` + `parseBedrockSecret` + `toVisionResult` + `detectKind` + `defaultModelFor`. Pure helpers only — no network in CI.
- `sponsorship.test.ts` — unchanged; covers the legacy direct-Anthropic path that still works for BYO keys.
- Network paths (each provider's actual API integration) are exercised via manual end-to-end runs against a staging Supabase project with each provider's credentials supplied.
