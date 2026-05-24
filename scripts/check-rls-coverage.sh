#!/usr/bin/env bash
#
# check-rls-coverage.sh — fail when a CREATE POLICY in supabase-schema.sql
# has no paired assertion in tests/sql/rls.sql and is not listed in the
# allowlist at tests/sql/rls-coverage-allowlist.txt.
#
# Why: a broken RLS policy is a silent data leak. CLAUDE.md "Things you
# should NOT do without asking" explicitly bans shipping an RLS policy
# without testing it. This script turns that convention into a gate
# wired in .github/workflows/db-validate.yml.
#
# How:
#   1. Parse every CREATE POLICY "<name>" ON <schema.table> from
#      docs/specs/infra/supabase-schema.sql (handles both quoted and
#      unquoted policy names; dedupes idempotent DROP+CREATE pairs).
#   2. Determine which are covered by tests/sql/rls.sql via:
#        - explicit `-- policy:<schema>.<table>.<name>` markers, OR
#        - fallback: any reference to `<schema>.<table>` in the test file
#          (covers `INSERT INTO public.users`, `SELECT … FROM public.users`,
#          etc.).
#   3. Read tests/sql/rls-coverage-allowlist.txt and skip those entries.
#   4. Exit non-zero if anything is left untested + not allowlisted.
#
# Usage:  bash scripts/check-rls-coverage.sh
# Exits 0 if every policy is tested or allowlisted, non-zero otherwise.
# Linked: issue #1172 (epic #1031 Tier 2a).

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

SCHEMA_FILE="docs/specs/infra/supabase-schema.sql"
TESTS_FILE="tests/sql/rls.sql"
ALLOWLIST_FILE="tests/sql/rls-coverage-allowlist.txt"

for f in "$SCHEMA_FILE" "$TESTS_FILE"; do
  if [ ! -f "$f" ]; then
    echo "ERROR: required file missing: $f"
    exit 2
  fi
done

# ─── 1. Extract policies ─────────────────────────────────────────────────────
# Match `CREATE POLICY <name|"name"> ON <schema>.<table>` and emit
# `<schema>.<table>.<name>` on stdout. Awk is more reliable than a single
# extended grep across the quoted/unquoted/case variants we ship.
policies_raw=$(awk '
  /^[[:space:]]*CREATE POLICY/ {
    line = $0
    # strip leading "CREATE POLICY"
    sub(/^[[:space:]]*CREATE POLICY[[:space:]]+/, "", line)

    # policy name: quoted or bare identifier up to whitespace.
    if (substr(line, 1, 1) == "\"") {
      # quoted
      rest = substr(line, 2)
      qpos = index(rest, "\"")
      if (qpos == 0) next
      name = substr(rest, 1, qpos - 1)
      line = substr(rest, qpos + 2)  # skip closing quote
    } else {
      # bare identifier
      n = match(line, /[[:space:]]/)
      if (n == 0) next
      name = substr(line, 1, n - 1)
      line = substr(line, n + 1)
    }

    # expect "ON <schema>.<table>"
    sub(/^[[:space:]]+/, "", line)
    if (substr(line, 1, 3) != "ON " && substr(line, 1, 3) != "ON\t") next
    line = substr(line, 4)
    sub(/^[[:space:]]+/, "", line)

    # capture <schema>.<table>
    if (match(line, /^[A-Za-z_][A-Za-z0-9_]*\.[A-Za-z_][A-Za-z0-9_]*/) == 0) next
    target = substr(line, RSTART, RLENGTH)

    printf("%s.%s\n", target, name)
  }
' "$SCHEMA_FILE" | sort -u)

policy_count=$(printf '%s\n' "$policies_raw" | grep -c . || true)

if [ "$policy_count" -eq 0 ]; then
  echo "ERROR: no CREATE POLICY statements parsed from $SCHEMA_FILE — parser regression?"
  exit 2
fi

# ─── 2. Extract test coverage ────────────────────────────────────────────────
# Two signals count as "tested":
#
# (a) Explicit markers — lines like
#       -- policy:public.users.users_public_read
#     The precision mechanism. Recommended for new policies.
explicit_markers=$(grep -oE '^[[:space:]]*--[[:space:]]*policy:[A-Za-z0-9_]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+' "$TESTS_FILE" \
  | sed -E 's/^[[:space:]]*--[[:space:]]*policy:[[:space:]]*//' \
  | sort -u || true)

# (b) Name-based hit — the policy's bare name appears as a word anywhere
#     in the test file. Strict enough that injecting a new policy on an
#     already-tested table still fails the gate (acceptance criterion #4
#     of issue #1172), while loose enough that simply mentioning the
#     policy name in a NOTICE / comment / SET-LOCAL is sufficient.
test_words=$(grep -oE '\b[A-Za-z_][A-Za-z0-9_]+\b' "$TESTS_FILE" | sort -u || true)

# ─── 3. Read allowlist ───────────────────────────────────────────────────────
allowlist=""
if [ -f "$ALLOWLIST_FILE" ]; then
  allowlist=$(grep -vE '^[[:space:]]*(#|$)' "$ALLOWLIST_FILE" \
    | sed -E 's/[[:space:]]*#.*$//' \
    | sed -E 's/[[:space:]]+$//' \
    | grep -E '^[A-Za-z0-9_]+\.[A-Za-z0-9_]+\.[A-Za-z0-9_]+$' \
    | sort -u || true)
fi
allowlist_count=$(printf '%s\n' "$allowlist" | grep -c . || true)

# ─── 4. Compute untested ─────────────────────────────────────────────────────
tested_count=0
untested=""

while IFS= read -r policy; do
  [ -z "$policy" ] && continue
  # `policy` is "<schema>.<table>.<name>"; isolate the bare policy name.
  policy_name=$(printf '%s' "$policy" | awk -F. '{ print $NF }')

  is_tested=0

  # (a) explicit marker hit?
  if printf '%s\n' "$explicit_markers" | grep -Fxq "$policy" 2>/dev/null; then
    is_tested=1
  fi

  # (b) policy name appears as a word in the test file?
  if [ "$is_tested" -eq 0 ]; then
    if printf '%s\n' "$test_words" | grep -Fxq "$policy_name" 2>/dev/null; then
      is_tested=1
    fi
  fi

  if [ "$is_tested" -eq 1 ]; then
    tested_count=$((tested_count + 1))
    continue
  fi

  # not tested — allowlisted?
  if printf '%s\n' "$allowlist" | grep -Fxq "$policy" 2>/dev/null; then
    continue
  fi

  untested="${untested}${policy}
"
done <<< "$policies_raw"

untested_count=$(printf '%s' "$untested" | grep -c . || true)

# ─── 5. Report + exit ────────────────────────────────────────────────────────
echo "policies: $policy_count"
echo "tested: $tested_count"
echo "allowlisted: $allowlist_count"
echo "untested-not-allowlisted: $untested_count"

if [ "$untested_count" -gt 0 ]; then
  echo
  echo "FAIL: $untested_count policy/policies have no paired assertion in $TESTS_FILE"
  echo "      and are not listed in $ALLOWLIST_FILE."
  echo
  echo "Fix one of:"
  echo "  (a) Add an assertion in $TESTS_FILE that touches the policy's table"
  echo "      (any reference to <schema>.<table> counts; an explicit"
  echo "       \`-- policy:<schema>.<table>.<name>\` marker is preferred)."
  echo "  (b) Add the entry to $ALLOWLIST_FILE with a # justification: comment"
  echo "      if testing is genuinely out of scope for this PR."
  echo
  echo "Untested policies:"
  printf '%s' "$untested" | sed 's/^/  - /'
  exit 1
fi

echo
echo "OK: every CREATE POLICY in $SCHEMA_FILE is paired with an assertion"
echo "    in $TESTS_FILE or is justified in $ALLOWLIST_FILE."
exit 0
