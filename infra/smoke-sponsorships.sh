#!/usr/bin/env bash
set -euo pipefail

# Smokes the sponsorships Edge Function post-deploy.
# Requires SUPABASE_URL and SUPABASE_TEST_USER_TOKEN in env.

SUPABASE_URL="${SUPABASE_URL:-https://reppvlqejgoqvitturxp.supabase.co}"
TOKEN="${SUPABASE_TEST_USER_TOKEN:?SUPABASE_TEST_USER_TOKEN required}"

echo "→ POST /credentials with invalid prefix (should reject)"
RESPONSE=$(curl -s -w "\n%{http_code}" -X POST "$SUPABASE_URL/functions/v1/sponsorships/credentials" \
  -H "Authorization: Bearer $TOKEN" -H "Content-Type: application/json" \
  -d '{"label":"smoke","secret":"not-a-real-key"}')
BODY=$(echo "$RESPONSE" | head -n -1)
CODE=$(echo "$RESPONSE" | tail -n 1)
if [ "$CODE" != "400" ]; then
  echo "FAIL: expected 400, got $CODE"; echo "$BODY"; exit 1
fi
if ! echo "$BODY" | grep -q "unrecognized_secret_prefix"; then
  echo "FAIL: expected unrecognized_secret_prefix"; echo "$BODY"; exit 1
fi
echo "PASS: invalid secret rejected"

echo "→ GET /credentials (should return list)"
RESPONSE=$(curl -s -w "\n%{http_code}" "$SUPABASE_URL/functions/v1/sponsorships/credentials" \
  -H "Authorization: Bearer $TOKEN")
CODE=$(echo "$RESPONSE" | tail -n 1)
if [ "$CODE" != "200" ]; then
  echo "FAIL: expected 200, got $CODE"; exit 1
fi
echo "PASS: list endpoint works"

echo "All smoke checks passed."
