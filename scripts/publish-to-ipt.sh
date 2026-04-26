#!/usr/bin/env bash
# publish-to-ipt.sh — fetch a fresh DwC-A from the export-dwca Edge Function
# and (optionally) drop it onto a remote GBIF IPT host.
#
# This script does NOT register the resource inside the IPT instance for you;
# IPT requires manual versioning + DOI minting from its admin UI. What it does
# do is automate the boring step: pull the latest archive, name it with the
# date, copy it to where the IPT operator expects new sources to land.
#
# Usage:
#   export SUPABASE_URL=https://<ref>.supabase.co
#   export SUPABASE_SERVICE_ROLE_KEY=eyJ...
#   ./scripts/publish-to-ipt.sh \
#       --since 2025-01-01 \
#       --until 2026-04-25 \
#       --quality research_grade \
#       --license CC0-1.0 \
#       --output ./out/rastrum-dwca.zip
#
# Optional: copy the ZIP to a remote IPT host.
#   IPT_HOST=ipt.example.org IPT_USER=ipt IPT_DROP_DIR=/var/lib/ipt/sources \
#       ./scripts/publish-to-ipt.sh ...   # requires SSH key on PATH
#
# See docs/gbif-ipt.md for the full operator workflow.

set -euo pipefail

SINCE=""
UNTIL=""
BBOX=""
QUALITY="research_grade"
LICENSE="CC0-1.0"
INCLUDE_MULTIMEDIA="0"
OUTPUT=""

while [ $# -gt 0 ]; do
  case "$1" in
    --since)              SINCE="$2"; shift 2 ;;
    --until)              UNTIL="$2"; shift 2 ;;
    --bbox)               BBOX="$2"; shift 2 ;;
    --quality)            QUALITY="$2"; shift 2 ;;
    --license)            LICENSE="$2"; shift 2 ;;
    --include-multimedia) INCLUDE_MULTIMEDIA="1"; shift ;;
    --output|-o)          OUTPUT="$2"; shift 2 ;;
    -h|--help)
      sed -n '2,28p' "$0" | sed 's/^# \{0,1\}//'
      exit 0
      ;;
    *)
      echo "Unknown argument: $1" >&2
      exit 1
      ;;
  esac
done

if [ -z "${SUPABASE_URL:-}" ] || [ -z "${SUPABASE_SERVICE_ROLE_KEY:-}" ]; then
  echo "✗ SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set." >&2
  echo "  See https://supabase.com/dashboard/project/<ref>/settings/api" >&2
  exit 1
fi

if [ -z "$OUTPUT" ]; then
  OUTPUT="rastrum-dwca-$(date -u +%Y-%m-%d).zip"
fi

# Build query string
PARAMS=""
add() { PARAMS="${PARAMS}${PARAMS:+&}$1=$2"; }
[ -n "$SINCE"   ] && add since   "$SINCE"
[ -n "$UNTIL"   ] && add until   "$UNTIL"
[ -n "$BBOX"    ] && add bbox    "$BBOX"
add quality "$QUALITY"
add license "$LICENSE"
[ "$INCLUDE_MULTIMEDIA" = "1" ] && add include_multimedia 1

URL="${SUPABASE_URL%/}/functions/v1/export-dwca${PARAMS:+?$PARAMS}"

echo "→ Fetching $URL"
HTTP_CODE=$(curl -sS -w '%{http_code}' -o "$OUTPUT" \
  -H "Authorization: Bearer $SUPABASE_SERVICE_ROLE_KEY" \
  -D /tmp/rastrum-dwca-headers.txt \
  "$URL")

if [ "$HTTP_CODE" != "200" ]; then
  echo "✗ HTTP $HTTP_CODE" >&2
  cat "$OUTPUT" >&2 || true
  exit 1
fi

RECORDS=$(grep -i '^x-rastrum-records:' /tmp/rastrum-dwca-headers.txt | awk '{print $2}' | tr -d '\r' || echo '?')
MEDIA=$(grep -i '^x-rastrum-multimedia:' /tmp/rastrum-dwca-headers.txt | awk '{print $2}' | tr -d '\r' || echo '?')
SIZE=$(wc -c < "$OUTPUT" | awk '{print $1}')
echo "✓ wrote $OUTPUT ($SIZE bytes, $RECORDS records, $MEDIA media)"

if [ -n "${IPT_HOST:-}" ] && [ -n "${IPT_USER:-}" ] && [ -n "${IPT_DROP_DIR:-}" ]; then
  REMOTE="$IPT_USER@$IPT_HOST:$IPT_DROP_DIR/"
  echo "→ Copying to $REMOTE"
  scp -p "$OUTPUT" "$REMOTE"
  echo "✓ uploaded. Next:"
  echo "  1. Log into the IPT admin UI at https://$IPT_HOST/ipt"
  echo "  2. Open the Rastrum resource → Source Data"
  echo "  3. Replace the source ZIP with $(basename "$OUTPUT")"
  echo "  4. Click 'Publish' to create a new version (DOI is minted automatically if configured)"
else
  echo "→ Next: upload $OUTPUT to your GBIF IPT instance manually."
  echo "  IPT does not support unattended publishing — operator action is required to mint a DOI."
fi
