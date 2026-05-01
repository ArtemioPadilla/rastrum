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

`kind = 'vertex_ai'`. **Recommended: store the service-account JSON
envelope as the secret** (PR #209 / issue #155). The provider mints
an OAuth2 access token via JWT-bearer flow inside the Edge Function,
caches it for ~50 minutes, and refreshes transparently. Secret
shape:

```json
{
  "type": "service_account",
  "project_id": "my-proj",
  "private_key_id": "kid-1",
  "private_key": "-----BEGIN PRIVATE KEY-----\n…\n-----END PRIVATE KEY-----\n",
  "client_email": "svc@my-proj.iam.gserviceaccount.com"
}
```

**Legacy (operator-mints-offline) path still works:** when the
secret looks like `ya29.…` instead of JSON, the provider uses it
as-is. Operators on this path own rotation themselves; the
`vertex_token_expiry_monitor` cron (PR #207) emails 5 minutes
before expiry to give them a chance to refresh.

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
| Vertex AI returns 401 after working for ~1h | Access token expired | Migrate the credential to a service-account JSON envelope (PR #209) — auto-rotation kicks in. Legacy `ya29.…` secrets still need manual re-mint. |
| Azure OpenAI 404 | `endpoint` URL doesn't include the deployment path or `?api-version=…` | Copy the full URL including query string from the Azure portal |
| Pool resolution skips a healthy pool | RLS gate on `sponsor_pools` is owner-only — service role bypasses, but check `status = 'active'` and `used < total_cap` | Toggle status, run `consume_pool_slot()` manually as service_role to confirm |
| `preferred_model` mismatched for provider type | DEFAULT `'claude-haiku-4-5'` is Anthropic shorthand; non-Anthropic providers need explicit model ID | UPDATE the `preferred_model` after creation; Bedrock auto-translates the shorthand |

## Shipped 2026-04-30 (v1.1 follow-ups)

- **UI** — provider radio + filtered model dropdown in `SponsoringView` (PR #215 / issue #152)
- **UI** — "Donate to platform pool" section with capacity bar + Pause/Resume (PR #215)
- **Vertex AI auto-rotation** — service-account JWT minted inside the EF, cached ~50 min (PR #209 / issue #155)
- **Vertex token expiry alert** — 10-min cron emails 5 min before expiry for legacy literal-token credentials (PR #207 / issue #159)
- **`monthly_reset` cron** — first-of-month at 00:05 UTC (PR #207 / issue #153)
- **`pool_consumption` vacuum** — daily at 03:30 UTC, drops rows > 90 days (PR #207 / issue #154)
- **End-to-end provider smoke probe** — manual + nightly workflow that calls `validateCredential()` against each real API (PR #210 / issue #158)

Run the smoke workflow on demand from the GitHub Actions UI under
**vision-providers-smoke** (operator must have the
`VISION_PROVIDERS_TEST_*` secrets set).

## v1.1 follow-ups (still open)

- **Sponsor-facing pool dashboard**: capacity / utilisation / **top taxa** (no beneficiary breakdown). Needs `ai_usage.pool_id` column landing first.
- **Cost-per-100-calls table** in the model picker (static, manual updates).
- **Pool karma incentives**: "donate calls, earn karma" loop.
