#!/usr/bin/env bash
#
# audit-edge-cors.sh — verify every deployed Edge Function returns proper
# CORS headers on an OPTIONS preflight from rastrum.org. Catches the class
# of bug that masked our get-upload-url outage for 12 hours on launch day.
#
# Usage: ./scripts/audit-edge-cors.sh
# Env:   SUPABASE_PROJECT_REF (defaults to the production project)
#
# Exits 1 if any function fails the audit.

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-reppvlqejgoqvitturxp}"
ORIGIN="${ORIGIN:-https://rastrum.org}"
BASE="https://${PROJECT_REF}.supabase.co/functions/v1"

# Functions that accept browser POSTs and therefore MUST return CORS.
# The cron-triggered functions (recompute-streaks, award-badges,
# streak-push, plantnet-monitor) are deployed --no-verify-jwt and only
# called server-to-server, so we don't audit them.
FUNCTIONS=(
  identify
  enrich-environment
  share-card
  get-upload-url
  export-dwca
  api
  mcp
  sync-error
  delete-observation
  follow
  react
  report
)

failed=0
warned=0
for fn in "${FUNCTIONS[@]}"; do
  url="${BASE}/${fn}"
  echo "→ ${fn}"
  hdrs=$(curl -sS -X OPTIONS "$url" \
    -H "Origin: ${ORIGIN}" \
    -H "Access-Control-Request-Method: POST" \
    -H "Access-Control-Request-Headers: authorization,content-type" \
    -D - -o /dev/null \
    --max-time 10 || true)
  status=$(printf '%s\n' "$hdrs" | head -1 | awk '{print $2}')
  acao=$(printf '%s\n' "$hdrs" | grep -i '^access-control-allow-origin:' || true)

  # 404 = function never deployed (or recently undeployed). Not a CORS
  # bug — just absent. Warn so we're aware, but don't fail the gate;
  # otherwise a single-function deploy fails because of unrelated
  # functions that legitimately don't exist yet.
  if [[ "$status" == "404" ]]; then
    echo "    ⚠ 404 not deployed (skip)"
    warned=$((warned + 1))
    continue
  fi

  if [[ -z "$status" || ! "$status" =~ ^(200|204)$ ]]; then
    echo "    ✗ unexpected status: $status"
    failed=$((failed + 1))
    continue
  fi
  if [[ -z "$acao" ]]; then
    echo "    ✗ missing Access-Control-Allow-Origin"
    failed=$((failed + 1))
    continue
  fi
  echo "    ✓ ${status} | ${acao#access-control-allow-origin: }"
done

echo
if (( failed > 0 )); then
  echo "${failed} function(s) failed the CORS audit."
  (( warned > 0 )) && echo "${warned} function(s) skipped (not deployed)."
  exit 1
fi
if (( warned > 0 )); then
  echo "$(( ${#FUNCTIONS[@]} - warned )) edge functions pass the CORS audit; ${warned} skipped (not deployed yet)."
else
  echo "All ${#FUNCTIONS[@]} edge functions pass the CORS audit."
fi
