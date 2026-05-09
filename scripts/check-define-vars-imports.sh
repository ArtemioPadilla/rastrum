#!/usr/bin/env bash
#
# check-define-vars-imports.sh — fail when a `<script ... define:vars ...>`
# block contains a dynamic `import(` call.
#
# Why: `define:vars` implicitly enables `is:inline=true` on Astro scripts,
# which disables bundling. A dynamic `import('../lib/foo')` then ships as
# raw text and the browser resolves it relative to the page URL → 404.
# See CLAUDE.md "Astro define:vars + dynamic-import pitfall" and PR #825.
#
# Usage:  bash scripts/check-define-vars-imports.sh
#         npm run check:define-vars
# Exits 0 if no violations, non-zero otherwise.

set -euo pipefail

ROOT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$ROOT_DIR"

violations=0
files_scanned=0

while IFS= read -r file; do
  files_scanned=$((files_scanned + 1))

  # AWK state machine, BSD/POSIX awk compatible (no \> word boundaries):
  #   - open_buf accumulates a `<script ... >` opening tag (may span lines).
  #   - When the closing `>` of the opening tag is reached, decide whether
  #     it had `define:vars` — if yes, in_block = 1.
  #   - Inside the block, flag any `import(` (after stripping line comments
  #     to avoid false positives).
  out=$(awk '
    BEGIN { in_open = 0; in_block = 0; open_buf = "" }
    {
      line = $0
      # Strip // line comments and /* ... */ same-line block comments so a
      # commented-out `import(` does not trigger.
      stripped = line
      sub(/\/\/.*$/, "", stripped)
      gsub(/\/\*[^*]*\*\//, "", stripped)

      if (in_block) {
        if (index(stripped, "</script>") > 0) {
          in_block = 0
          next
        }
        # Match `import(` allowing whitespace between identifier and paren.
        if (match(stripped, /import[ \t]*\(/)) {
          printf("%d\n", NR)
        }
        next
      }

      if (!in_open) {
        # Look for the start of an opening <script tag on this line.
        pos = index(stripped, "<script")
        if (pos == 0) next
        # Ensure it is the opening tag boundary (`<script` followed by
        # `>`, whitespace, `\t`, or end of line) — not e.g. `<scriptable>`.
        next_char = substr(stripped, pos + length("<script"), 1)
        if (next_char != "" && next_char != ">" && next_char != " " && next_char != "\t") {
          next
        }
        in_open = 1
        open_buf = substr(stripped, pos)
      } else {
        open_buf = open_buf " " stripped
      }

      # If we now have the closing `>` of the opening tag, evaluate.
      gt_pos = index(open_buf, ">")
      if (gt_pos > 0) {
        opening = substr(open_buf, 1, gt_pos)
        if (index(opening, "define:vars") > 0) {
          in_block = 1
        }
        in_open = 0
        open_buf = ""
        # Trailing content on this line after the opening tag may itself
        # contain </script> or import( — handle by re-feeding the tail.
        tail = substr(stripped, length(stripped) - length(open_buf) + 1)
        # (Tail handling intentionally minimal — none of our real files put
        # script body on the same line as the opening tag.)
      }
    }
  ' "$file") || true

  if [ -n "$out" ]; then
    while IFS= read -r lineno; do
      [ -z "$lineno" ] && continue
      echo "ERROR  $file:$lineno  <script define:vars> + import() — would 404 at runtime (see CLAUDE.md \"Astro define:vars + dynamic-import pitfall\")"
      violations=$((violations + 1))
    done <<< "$out"
  fi
done < <(find src -type f -name '*.astro')

if [ "$violations" -gt 0 ]; then
  echo
  echo "FAIL: $violations violation(s) across $files_scanned scanned .astro files."
  echo "Fix: drop define:vars; read state from the DOM (e.g. document.documentElement.lang) or data-* attributes. See PR #825 for the canonical pattern."
  exit 1
fi

echo "OK: scanned $files_scanned .astro files, no <script define:vars> + import() violations."
exit 0
