# CI smoke checks runbook

> What to do when a CI smoke job goes red.

The repo runs **two kinds** of automated smoke checks:

1. **Playwright smoke** (`tests/e2e/smoke.spec.ts`) — per-route HTTP +
   console-error checks. Triggered on every PR (via `e2e.yml`) and
   nightly at 09:17 UTC against production (via `nightly-smoke.yml`).
   Tracking issues are auto-opened on failure under the `smoke-test`
   label; the workflow comments on the existing tracker rather than
   fanning out a new issue per night.
2. **Model-asset smoke** (`infra/smoke-model-assets.sh`) — curls every
   operator-configured `PUBLIC_*_URL` and asserts:
   - HTTP 200
   - `access-control-allow-origin` header present (browsers reject the
     on-device fetch otherwise)
   - content-length within a sane minimum range per asset (catches the
     "wrong file uploaded to the right key" foot-gun)

   Wired into `deploy.yml` (post-deploy job) and `nightly-smoke.yml`
   (extra step after the Playwright run).

This runbook focuses on the model-asset flavour — the Playwright one is
covered by the auto-opened tracking issue + its attached HTML report.

## What the script checks

```text
$ bash infra/smoke-model-assets.sh

  ▶     BirdNET ONNX           → ${PUBLIC_BIRDNET_WEIGHTS_URL}/birdnet_v2.4.onnx
        ✓ HTTP/2 200 , 51722453 bytes, CORS=https://rastrum.org
  ▶     BirdNET labels         → …/BirdNET_GLOBAL_6K_V2.4_Labels.txt
        ✓ HTTP/2 200 , 259740 bytes, CORS=https://rastrum.org
  ▶     EfficientNet ONNX      → ${PUBLIC_ONNX_BASE_URL}/efficientnet_lite0.onnx
        ✓ HTTP/2 200 , 18560054 bytes, CORS=https://rastrum.org
  ▶     ImageNet labels        → …/imagenet_labels.txt
        ✓ HTTP/2 200 , 31675 bytes, CORS=https://rastrum.org
  ▶     pmtiles MX             → ${PUBLIC_PMTILES_MX_URL}
        ✓ HTTP/2 200 , 50436660 bytes, CORS=https://rastrum.org
  ▶     MegaDetector v5a       → ${PUBLIC_MEGADETECTOR_WEIGHTS_URL}/megadetector_v5a.onnx
        ✓ HTTP/2 200 , 140858212 bytes, CORS=https://rastrum.org

✓ All 6 configured model asset(s) reachable.
```

Unconfigured `PUBLIC_*_URL`s are skipped silently — the project ships
gracefully without any of them; missing assets only mean the matching
on-device plugin reports `model_not_bundled` and the cascade falls
through.

## Failure modes + fixes

### `unreachable: HTTP/2 404`

The bucket key was renamed or deleted. Look at `wrangler r2 object list
rastrum-media --remote` to confirm what's actually there. If you renamed
deliberately, also update the env var at GitHub Settings → Secrets and
the spec module that documents the asset.

### `unreachable: HTTP/2 401` or `403`

Bucket private or auth required. R2 buckets used for on-device models
must be **public** (or behind a custom domain proxying public). The
project pattern is `media.rastrum.org/<asset-path>` resolving to a
public R2 bucket. Verify with `wrangler r2 bucket info rastrum-media`.

### `missing access-control-allow-origin header`

The file is reachable but CORS isn't set. R2 returns the header **only
when an Origin request header is present** — but for browser fetches
that's always set. The smoke script always sends `Origin:
https://rastrum.org` so any failure here is a real config gap. Open the
bucket in the Cloudflare dashboard → Settings → CORS Policy, ensure
`https://rastrum.org` (and `localhost:4321` for dev if needed) is
allow-listed. Allowed methods: `GET`, `HEAD`. Headers: `*`. Max age:
86400.

### `content-length=X is below min=Y — wrong file?`

Operator uploaded the wrong file to the right key, or the upload
truncated. Re-run `infra/megadetector/convert.sh` (for MegaDetector) or
the matching bundle-models workflow run, and re-upload. The minimum
sizes encoded in the script are conservative — set to roughly half the
expected production size, so a legit alternate quantisation level
shouldn't trip them.

### `unreachable: curl: (28) Operation timed out`

Network or Cloudflare hiccup. The smoke step has a 30 s per-asset
timeout. If it persists across two runs, check Cloudflare's status
page (https://www.cloudflarestatus.com/) before assuming it's the
asset.

## Adding a new asset

1. Add the env var to `.github/workflows/deploy.yml`'s build step
   (`env:` block) AND the `smoke-model-assets` job's `env:` block AND
   `nightly-smoke.yml`'s smoke step.
2. Add a `check` line to `infra/smoke-model-assets.sh` with a sensible
   minimum content-length.
3. Add the secret in GitHub Settings → Secrets.
4. Document the asset in the relevant module spec under
   [`docs/specs/modules/`](../specs/modules/).

## Disabling a check temporarily

If a hosted asset is intentionally being rotated (e.g. you're swapping
the MegaDetector quant level), unset the GitHub repo secret. The
smoke script will treat it as "not configured" and skip it. Don't
delete the env-var line from the workflows — that's a permanent change
that's harder to undo cleanly.

## See also

- `infra/smoke-model-assets.sh` — the script itself
- `.github/workflows/deploy.yml` — `smoke-model-assets` job
- `.github/workflows/nightly-smoke.yml` — extra step after Playwright
- [`docs/runbooks/onboarding-events.md`](onboarding-events.md) — sibling runbook
- [`docs/specs/modules/09-camera-trap.md`](../specs/modules/09-camera-trap.md) — canonical example of an operator-hosted asset URL
