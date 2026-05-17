#!/usr/bin/env bash
#
# e2e-for-changed.sh — given the files changed on this branch, print the
# e2e specs that reference the DOM ids / data-attributes they touch.
#
# Why: a UI change that relocates or hides a DOM region can pass
# `tsc` + `vitest` + `npm run build` + `smoke.spec.ts` and still break
# the spec that targets that exact surface (e.g. #1127 relocated the
# identifier registry behind a <details> and only `ai-tab.spec.ts`
# caught it, in CI, after the round-trip). This makes "run the spec for
# the surface you changed" mechanical instead of memory-dependent.
#
# Usage:  bash scripts/e2e-for-changed.sh [base-ref]   (default origin/main)
# Output: a suggested `npx playwright test …` line, or a note that
#         smoke coverage is sufficient. Advisory — never fails the build.
#
# Bash 3.2 compatible (macOS system bash): no mapfile / assoc arrays.

set -euo pipefail

BASE="${1:-origin/main}"
ROOT="$(git rev-parse --show-toplevel)"
cd "$ROOT"

# Changed source files on this branch (added/modified, not deleted).
CHANGED="$(git diff --name-only --diff-filter=d "${BASE}...HEAD" -- \
  'src/*.astro' 'src/**/*.astro' 'src/**/*.ts' 'src/**/*.tsx' 2>/dev/null || true)"

if [ -z "$CHANGED" ]; then
  echo "e2e-for-changed: no .astro/.ts UI changes vs ${BASE} — smoke coverage is sufficient."
  exit 0
fi

# Collect DOM tokens the changed files define/use: id="x",
# getElementById('x'), querySelector('#x' / '[data-x]'), data-* names.
tokens="$(echo "$CHANGED" | tr '\n' '\0' | xargs -0 grep -hoE \
  'id="[a-zA-Z0-9_-]+"|getElementById\(['"'"'"'"'"'][a-zA-Z0-9_-]+|data-[a-z-]+|#[a-zA-Z][a-zA-Z0-9_-]+' \
  2>/dev/null \
  | sed -E 's/^id="//; s/^getElementById\(.//; s/^#//' \
  | tr -d "\"'" \
  | sort -u | sed '/^$/d' | grep -vE '^data-?$' || true)"

if [ -z "$tokens" ]; then
  echo "e2e-for-changed: no DOM ids/data-attrs in the diff — smoke coverage is sufficient."
  exit 0
fi

# Which e2e specs reference any of those tokens?
specs=""
while IFS= read -r tok; do
  [ -z "$tok" ] && continue
  hits="$(grep -rl --include='*.spec.ts' -F "$tok" tests/e2e 2>/dev/null || true)"
  [ -n "$hits" ] && specs="${specs}${hits}"$'\n'
done <<EOF
$tokens
EOF

specs="$(printf '%s' "$specs" | sort -u | sed '/^$/d')"

if [ -z "$specs" ]; then
  echo "e2e-for-changed: changed DOM tokens match no dedicated spec — verify smoke.spec.ts + the journey covering this page."
  exit 0
fi

echo "e2e-for-changed: the changed DOM surface is referenced by these specs — run them before pushing:"
echo
echo "  npx playwright test $(printf '%s ' $specs)--project=chromium"
echo
echo "(Build dist with .env.local present + serve it, or /profile/* will fail"
echo " locally with 'supabaseUrl is required' and mask real regressions.)"
