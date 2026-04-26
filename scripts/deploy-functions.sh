#!/usr/bin/env bash
# Deploy Supabase Edge Functions via the Management API, bypassing the broken
# CLI 2.90.0 schema validation.
#
# Usage:
#   export SB_ACCESS_TOKEN=sbp_xxx     # from supabase.com/dashboard/account/tokens
#   ./scripts/deploy-functions.sh                   # deploy all
#   ./scripts/deploy-functions.sh get-upload-url    # deploy one
#
# Requires: curl, jq

set -euo pipefail

PROJECT_REF=reppvlqejgoqvitturxp
FUNCTIONS_DIR="$(cd "$(dirname "$0")/../supabase/functions" && pwd)"

if [ -z "${SB_ACCESS_TOKEN:-}" ]; then
  echo "✗ SB_ACCESS_TOKEN not set."
  echo "  Get one from: https://supabase.com/dashboard/account/tokens"
  exit 1
fi

# Map function name → verify_jwt setting (true = require JWT, false = public).
declare -A VERIFY_JWT=(
  [get-upload-url]=true
  [identify]=true
  [enrich-environment]=true
  [recompute-streaks]=true
  [award-badges]=true
  [share-card]=false   # OG scrapers need anonymous access
  [export-dwca]=true   # accepts user JWT or service-role bearer (cron / IPT cli)
)

deploy_one() {
  local fn="$1"
  local dir="$FUNCTIONS_DIR/$fn"
  local entry="$dir/index.ts"
  local verify="${VERIFY_JWT[$fn]:-true}"

  if [ ! -f "$entry" ]; then
    echo "✗ $fn — no $entry"
    return 1
  fi

  echo "→ deploying $fn (verify_jwt=$verify) …"

  # Build a multipart form: metadata JSON + bundled source as a file
  local body_file
  body_file="$(mktemp -t rastrum-deploy.XXXXXX.eszip)"
  trap "rm -f $body_file" RETURN

  # The Management API accepts a single tarball with the function source.
  ( cd "$dir" && tar -czf "$body_file" --exclude='*.bak' . )

  local res
  res=$(curl -sS -w "\n%{http_code}" \
    -X POST "https://api.supabase.com/v1/projects/${PROJECT_REF}/functions/deploy?slug=${fn}" \
    -H "Authorization: Bearer $SB_ACCESS_TOKEN" \
    -H "Content-Type: application/octet-stream" \
    -H "x-verify-jwt: $verify" \
    --data-binary "@$body_file")

  local code body
  code=$(echo "$res" | tail -n1)
  body=$(echo "$res" | sed '$d')

  if [ "$code" -ge 200 ] && [ "$code" -lt 300 ]; then
    echo "  ✓ deployed"
  else
    echo "  ✗ HTTP $code"
    echo "  $body"
    return 1
  fi
}

if [ $# -gt 0 ]; then
  for fn in "$@"; do
    deploy_one "$fn"
  done
else
  for fn in "${!VERIFY_JWT[@]}"; do
    deploy_one "$fn"
  done
fi

echo "✓ done"
