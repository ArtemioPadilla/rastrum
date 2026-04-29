#!/usr/bin/env bash
set -euo pipefail

# Fails the build if any Anthropic secret format leaked into shipped code or logs.

if grep -RIn "sk-ant-" dist/ supabase/functions/ 2>/dev/null \
   | grep -v "_shared/anthropic-validate.ts" \
   | grep -v "_shared/anthropic-validate.test.ts" \
   | grep -v "_shared/sponsorship.test.ts" \
   | grep -v "README" ; then
  echo "FAIL: literal Anthropic key prefix found in shipped code."
  exit 1
fi

# Also check for obvious console.log of secrets/keys in Edge Functions.
if grep -RIn "console.log" supabase/functions/ 2>/dev/null \
   | grep -iE "secret|key|token|credential" \
   | grep -v "// allowed:"; then
  echo "FAIL: console.log of suspected secret/key/token/credential in Edge Function."
  echo "If this is intentional and safe, append a // allowed: <reason> comment."
  exit 1
fi

echo "PASS: no secret leaks detected."
