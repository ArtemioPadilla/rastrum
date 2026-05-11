# Vision providers smoke — secrets runbook (#687)

> **Workflow:** `.github/workflows/vision-providers-smoke.yml`
> **Triggers:** `workflow_dispatch` + nightly cron at 04:00 UTC

The smoke workflow probes all six M32 vision providers against their real
APIs every night. Each secret is optional — missing secrets cause the probe
to emit `SKIP <provider>` rather than fail. The workflow only fails when at
least one provider ran AND all providers that ran returned `FAIL`.

---

## Secrets reference

| Secret name | Provider | Value format | Where to get it |
|---|---|---|---|
| `VISION_PROVIDERS_TEST_ANTHROPIC_API_KEY` | Anthropic (direct — api_key path) | `sk-ant-api03-…` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) → Create key |
| `VISION_PROVIDERS_TEST_ANTHROPIC_OAT` | Anthropic (direct — oauth_token path) | `sk-ant-oat01-…` | [console.anthropic.com/settings/keys](https://console.anthropic.com/settings/keys) → OAuth Application Token (optional; falls back to API key path if absent) |
| `VISION_PROVIDERS_TEST_BEDROCK_JSON` | AWS Bedrock | JSON: `{"region":"us-east-1","accessKeyId":"AKIA…","secretAccessKey":"…","sessionToken":"…optional…"}` | AWS IAM → create user with `AmazonBedrockFullAccess` → Access Keys. `sessionToken` only needed for assumed-role credentials. |
| `VISION_PROVIDERS_TEST_OPENAI_API_KEY` | OpenAI | `sk-…` | [platform.openai.com/api-keys](https://platform.openai.com/api-keys) → Create new secret key |
| `VISION_PROVIDERS_TEST_AZURE_OPENAI_KEY` | Azure OpenAI (key) | Hex string, e.g. `a1b2c3…` | Azure Portal → your Azure OpenAI resource → Keys and Endpoint → KEY 1 |
| `VISION_PROVIDERS_TEST_AZURE_OPENAI_ENDPOINT` | Azure OpenAI (endpoint) | `https://<resource-name>.openai.azure.com/` | Same page as KEY 1 above — the "Endpoint" field |
| `VISION_PROVIDERS_TEST_GEMINI_API_KEY` | Google Gemini | `AIza…` | [aistudio.google.com/app/apikey](https://aistudio.google.com/app/apikey) → Create API key |
| `VISION_PROVIDERS_TEST_VERTEX_SA_JSON` | Google Vertex AI | Full service-account JSON, e.g. `{"type":"service_account","project_id":"…","private_key_id":"…","private_key":"-----BEGIN RSA PRIVATE KEY-----\n…","client_email":"…@….iam.gserviceaccount.com",…}` | GCP Console → IAM & Admin → Service Accounts → create SA with `roles/aiplatform.user` → Keys tab → Add Key → JSON |

---

## Setting secrets via GitHub CLI

Run each command once; the value is read from stdin to avoid shell history
leaking it.

```bash
# Anthropic API key
gh secret set VISION_PROVIDERS_TEST_ANTHROPIC_API_KEY \
  --repo ArtemioPadilla/rastrum \
  --body "sk-ant-api03-…"

# Anthropic OAuth token (optional)
gh secret set VISION_PROVIDERS_TEST_ANTHROPIC_OAT \
  --repo ArtemioPadilla/rastrum \
  --body "sk-ant-oat01-…"

# AWS Bedrock (JSON envelope — note the single quotes around the JSON)
gh secret set VISION_PROVIDERS_TEST_BEDROCK_JSON \
  --repo ArtemioPadilla/rastrum \
  --body '{"region":"us-east-1","accessKeyId":"AKIA…","secretAccessKey":"…"}'

# OpenAI
gh secret set VISION_PROVIDERS_TEST_OPENAI_API_KEY \
  --repo ArtemioPadilla/rastrum \
  --body "sk-…"

# Azure OpenAI — key and endpoint are two separate secrets
gh secret set VISION_PROVIDERS_TEST_AZURE_OPENAI_KEY \
  --repo ArtemioPadilla/rastrum \
  --body "a1b2c3…"

gh secret set VISION_PROVIDERS_TEST_AZURE_OPENAI_ENDPOINT \
  --repo ArtemioPadilla/rastrum \
  --body "https://my-resource.openai.azure.com/"

# Google Gemini
gh secret set VISION_PROVIDERS_TEST_GEMINI_API_KEY \
  --repo ArtemioPadilla/rastrum \
  --body "AIza…"

# Google Vertex AI — pipe the JSON file to avoid escaping issues
gh secret set VISION_PROVIDERS_TEST_VERTEX_SA_JSON \
  --repo ArtemioPadilla/rastrum < /path/to/vertex-sa.json
```

List currently-set secrets (values are redacted):

```bash
gh secret list --repo ArtemioPadilla/rastrum | grep VISION_PROVIDERS_TEST_
```

---

## Verifying the smoke workflow runs

### After setting one or more secrets

Trigger a manual run and watch it:

```bash
gh workflow run vision-providers-smoke.yml --repo ArtemioPadilla/rastrum
# Wait a moment for GitHub to accept the dispatch, then watch:
gh run list --workflow=vision-providers-smoke.yml --repo ArtemioPadilla/rastrum --limit 3
gh run watch <run-id> --repo ArtemioPadilla/rastrum
```

Or open the Actions tab directly:
`https://github.com/ArtemioPadilla/rastrum/actions/workflows/vision-providers-smoke.yml`

### Reading the results

The workflow writes a step summary. Each provider emits one line:

```
PASS anthropic-api-key   claude-haiku-4-5  200 OK  (342ms)
FAIL openai               sk-…             401 Unauthorized
SKIP bedrock             (no BEDROCK_JSON secret configured)
```

- **PASS** — probe hit the provider, got a non-error AI response.
- **FAIL** — probe ran but the provider returned an error. Check the
  message; common causes: wrong model name, expired key, missing scope.
- **SKIP** — secret not configured; this provider is excluded from
  pass/fail accounting.

The workflow fails the job only when ≥ 1 provider emits `FAIL` and
0 providers emit `PASS` (abstraction-level regression). Individual
provider failures with at least one `PASS` are logged but don't fail CI.

### Nightly schedule

The cron fires at 04:00 UTC every day (after `db-apply.yml` at 03:00).
If the nightly run shows unexpected `FAIL` lines, check the provider's
status page first before rotating the secret.

---

## Rotating a secret

```bash
# Example: rotate the Anthropic key
gh secret set VISION_PROVIDERS_TEST_ANTHROPIC_API_KEY \
  --repo ArtemioPadilla/rastrum \
  --body "sk-ant-api03-NEW-KEY-HERE"
```

Re-run the workflow to confirm the new key works before decommissioning
the old one.
