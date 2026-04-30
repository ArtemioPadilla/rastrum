# Multi-provider vision (M32) — runbook

> **Spec:** [`docs/specs/modules/32-multi-provider-vision.md`](../specs/modules/32-multi-provider-vision.md).
> **Code:** `supabase/functions/_shared/vision-provider.ts`, `vision-validate.ts`.
> **Status:** backend complete in v1; UI for credential creation is v1.1.

The provider abstraction lets a sponsor route Anthropic-direct,
AWS Bedrock, OpenAI, Azure OpenAI, Google Gemini, or Vertex AI calls
through the same `identify` Edge Function cascade.

## Apply schema

```bash
make db-apply
```

Adds 5 enum values to `ai_provider`, 4 to `ai_credential_kind`,
the `preferred_model` + `endpoint` columns on `sponsor_credentials`,
and the `consume_pool_slot` RPC for #115. Idempotent.

## Register a credential (no UI yet)

The UI for picking provider/model in `SponsoringView` is v1.1.
Until then, register credentials via `make db-psql` + Vault. The
Vault decrypted view (`vault.decrypted_secrets`) is service-role
only; Supabase Studio's Vault UI is the recommended path for human
operators.

### Anthropic direct (existing path, no change)

`kind = 'api_key'` or `'oauth_token'`. Secret is the literal API
key / OAT. `preferred_model` defaults to `claude-haiku-4-5` (the
direct API accepts the shorthand).

### AWS Bedrock

`kind = 'bedrock'`. The secret is a **JSON envelope**:

```json
{
  "region":          "us-east-1",
  "accessKeyId":     "AKIA…",
  "secretAccessKey": "…",
  "sessionToken":    "…optional, for assumed roles…"
}
```

Set `preferred_model = 'claude-haiku-4-5'` (Anthropic shorthand —
the `bedrockModelId()` helper auto-translates to
`us.anthropic.claude-haiku-4-5-v1:0`) or use the explicit Bedrock
ID. Set `endpoint` to override the region embedded in the JSON
(falls back to `us-east-1` if neither is set).

### OpenAI direct

`kind = 'openai_api_key'`. Secret is `sk-…`.
`preferred_model = 'gpt-4o-mini'` (default) or `'gpt-4o'`.
`endpoint` NULL → uses `https://api.openai.com/v1/chat/completions`.

### Azure OpenAI

`kind = 'azure_openai'`. Secret is the Azure API key (not a JWT).
`endpoint` is the **full deployment URL**, e.g.

```
https://my-resource.openai.azure.com/openai/deployments/my-deployment/chat/completions?api-version=2024-02-01
```

`preferred_model` is unused at request time (Azure routes by
deployment name in the URL) but the column is required by the
schema; set to the deployment name for documentation.

### Google Gemini direct

`kind = 'gemini_api_key'`. Secret is the `AIza…` API key.
`preferred_model = 'gemini-2.0-flash-exp'` (default).
`endpoint` NULL → `generativelanguage.googleapis.com`.

### Google Vertex AI

`kind = 'vertex_ai'`. **Operator must mint an OAuth2 access token
offline** from the service-account JSON (Vertex tokens last 1 hour;
auto-rotation is a v1.1 follow-up). Secret is the literal access
token (`ya29.…`).

`preferred_model` is the full model resource path:

```
projects/<project-id>/locations/us-central1/publishers/google/models/gemini-2.0-flash
```

`endpoint` is the region (defaults to `us-central1`).

## Validate a credential before storing

`supabase/functions/_shared/vision-validate.ts` exposes
`validateCredential(kind, secret, opts)` which runs a 1×1-PNG probe
against the provider's endpoint. Use it from any privileged write
path that creates a `sponsor_credentials` row:

```typescript
import { validateCredential } from '../_shared/vision-validate.ts';

const r = await validateCredential('bedrock', jsonEnvelope, {
  model: 'us.anthropic.claude-haiku-4-5-v1:0',
});
if (!r.valid) throw new Error(r.error);
```

## Resolution order in `identify`

```
1. BYO key (client_keys.anthropic) — always wins (legacy direct path)
2. User's personal sponsorship → uses preferred_model + endpoint via buildProvider()
3. Platform pool — consume_pool_slot() round-robin
4. Skip Claude (PlantNet only)
```

## Pool resolution debugging

```sql
-- Active pools the cascade can pick from
SELECT id, sponsor_id, used, total_cap, daily_user_cap, preferred_model
  FROM public.sponsor_pools
 WHERE status = 'active' AND used < total_cap
 ORDER BY created_at ASC;

-- A user's daily consumption
SELECT * FROM public.pool_consumption WHERE user_id = '<uuid>' ORDER BY day DESC LIMIT 7;

-- Force-mark a pool exhausted (operator)
UPDATE public.sponsor_pools SET status = 'exhausted' WHERE id = '<uuid>';
```

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| Bedrock provider returns null on every call | Sig V4 signing wrong region OR JSON envelope malformed | Verify `parseBedrockSecret(secret)` returns a non-null result; check `region` field matches the Bedrock endpoint URL |
| Vertex AI returns 401 after working for ~1h | Access token expired | Re-mint the OAuth2 access token from the service-account JSON; v1.1 will auto-rotate |
| Azure OpenAI 404 | `endpoint` URL doesn't include the deployment path or `?api-version=…` | Copy the full URL including query string from the Azure portal |
| Pool resolution skips a healthy pool | RLS gate on `sponsor_pools` is owner-only — service role bypasses, but check `status = 'active'` and `used < total_cap` | Toggle status, run `consume_pool_slot()` manually as service_role to confirm |
| `preferred_model` mismatched for provider type | DEFAULT `'claude-haiku-4-5'` is Anthropic shorthand; non-Anthropic providers need explicit model ID | UPDATE the `preferred_model` after creation; Bedrock auto-translates the shorthand |

## v1.1 follow-ups

- **UI**: provider radio + filtered model dropdown in `SponsoringView`
- **UI**: "Donate to platform pool" tab + cost-per-100-calls table
- **Sponsor-facing pool dashboard**: capacity / utilisation / top taxa (no beneficiary breakdown)
- **Vertex AI auto-rotation**: derive access token from service-account JWT inside the EF
- **Per-pool monthly reset cron**: honour `sponsor_pools.monthly_reset = true`
- **`pool_consumption` vacuum cron**: delete rows older than 90 days
- **Vertex token expiry alert**: notify sponsor 5 minutes before expiry
- **Pool karma incentives**: "donate calls, earn karma" loop
