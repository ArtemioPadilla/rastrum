#!/usr/bin/env bash
#
# diagnose-r2-upload.sh — end-to-end R2 PUT diagnostic.
# Calls get-upload-url with a real Supabase JWT, then attempts the PUT.
# R2 returns an XML body on 403 that tells us the actual cause; the
# browser hides this behind a CORS-shaped error.
#
# Usage:
#   1. Sign in at https://rastrum.org and copy your Supabase JWT from
#      DevTools → Application → Local Storage → sb-<ref>-auth-token →
#      access_token.
#   2. SUPABASE_JWT=<paste> ./scripts/diagnose-r2-upload.sh
#
# Output: the actual HTTP status + R2 error body (XML).

set -euo pipefail

PROJECT_REF="${SUPABASE_PROJECT_REF:-reppvlqejgoqvitturxp}"
JWT="${SUPABASE_JWT:-}"

if [[ -z "$JWT" ]]; then
  echo "ERROR: SUPABASE_JWT environment variable is required."
  echo "       Get it from DevTools → Local Storage on rastrum.org."
  exit 1
fi

KEY="diagnostics/r2-test-$(date +%s).jpg"
BODY="$(printf 'JFIF test')"

echo "→ Requesting presigned URL for key: $KEY"
RESP=$(curl -sS -X POST \
  "https://${PROJECT_REF}.supabase.co/functions/v1/get-upload-url" \
  -H "Authorization: Bearer $JWT" \
  -H "Content-Type: application/json" \
  -H "x-rastrum-build: diagnostic" \
  -d "{\"key\": \"$KEY\", \"contentType\": \"image/jpeg\"}")
echo "  get-upload-url response:"
echo "  $RESP"
echo

UPLOAD_URL=$(printf '%s' "$RESP" | sed -n 's/.*"uploadUrl":"\([^"]*\)".*/\1/p')
if [[ -z "$UPLOAD_URL" ]]; then
  echo "ERROR: get-upload-url didn't return an uploadUrl. Check the JSON above."
  exit 1
fi

echo "→ PUT to R2 (this is what the browser does):"
PUT_RESP=$(curl -sS -X PUT "$UPLOAD_URL" \
  -H "Content-Type: image/jpeg" \
  --data-binary "$BODY" \
  -D - --max-time 30 || true)

# Split headers / body
echo
echo "════ R2 Response ════"
printf '%s\n' "$PUT_RESP"
echo
echo "════ Verdict ════"
if printf '%s' "$PUT_RESP" | grep -q '^HTTP/.* 200'; then
  echo "✓ PUT succeeded. The browser-side issue is something else (cached"
  echo "  preflight, service worker, etc). Try hard-refresh on the page."
else
  CODE=$(printf '%s' "$PUT_RESP" | grep -oE '<Code>[^<]+</Code>' | head -1 | sed 's/<\/?Code>//g')
  case "$CODE" in
    InvalidAccessKeyId)
      echo "✗ R2_ACCESS_KEY_ID secret in the Edge Function is wrong or revoked."
      echo "  Fix: regenerate the token, then:"
      echo "    supabase secrets set R2_ACCESS_KEY_ID=<new>"
      echo "    supabase secrets set R2_SECRET_ACCESS_KEY=<new>"
      echo "    gh workflow run deploy-functions.yml -f function=get-upload-url" ;;
    SignatureDoesNotMatch)
      echo "✗ R2_SECRET_ACCESS_KEY doesn't match R2_ACCESS_KEY_ID."
      echo "  Fix: re-paste both secrets fresh from the Cloudflare dashboard." ;;
    AccessDenied)
      echo "✗ Token authenticates, but lacks Object Write on this bucket/key."
      echo "  Fix: ensure the token's bucket scope includes 'rastrum-media'"
      echo "       and Permission is 'Object Read & Write'." ;;
    RequestTimeTooSkewed)
      echo "✗ Clock skew between Supabase Edge Function and R2." ;;
    *)
      echo "✗ Unexpected R2 error code: '$CODE'"
      echo "  Check the response body above for details." ;;
  esac
fi
