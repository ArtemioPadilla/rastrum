#!/usr/bin/env bash
# Smoke-test the on-device model assets are reachable + CORS-open.
#
# Each PUBLIC_*_URL env var is checked when set; missing vars are
# treated as "operator hasn't configured this asset yet" and skipped
# (the project ships gracefully without any of them — the plugins
# report `model_not_bundled` and the cascade falls through). The point
# of this script is to catch the case where an env var IS configured
# but the file behind it is unreachable, has the wrong content-length,
# or returns no `access-control-allow-origin` header.
#
# Wired into:
#   - .github/workflows/deploy.yml (post-build, after `npm run build`)
#   - .github/workflows/nightly-smoke.yml (09:17 UTC daily)
#
# Usage (locally):
#   PUBLIC_MEGADETECTOR_WEIGHTS_URL=https://media.rastrum.org/models \
#     bash infra/smoke-model-assets.sh
set -euo pipefail

failed=0
checked=0

# $1=label  $2=full URL  $3=min content-length bytes (0 = no minimum)
check() {
  local label="$1"
  local url="$2"
  local min_size="${3:-0}"

  if [[ -z "$url" ]]; then
    printf "  skip  %-22s (env var not configured)\n" "$label"
    return 0
  fi

  checked=$((checked + 1))
  printf "  ▶     %-22s → %s\n" "$label" "$url"

  local headers
  if ! headers=$(curl -fsSI --max-time 30 -H 'Origin: https://rastrum.org' "$url" 2>&1); then
    printf "        ✗ unreachable: %s\n" "$headers"
    failed=$((failed + 1))
    return 1
  fi

  # Strip carriage returns for cleaner parsing.
  headers=${headers//$'\r'/}

  local status_line
  status_line=$(printf "%s" "$headers" | head -n1)

  local len
  len=$(printf "%s" "$headers" | grep -i '^content-length:' | head -1 | awk '{print $2}')
  local cors
  cors=$(printf "%s" "$headers" | grep -i '^access-control-allow-origin:' | head -1 | awk '{print $2}')

  if [[ -z "$cors" ]]; then
    printf "        ✗ missing access-control-allow-origin header (browser will reject the fetch)\n"
    failed=$((failed + 1))
    return 1
  fi

  if [[ -n "$len" && "$min_size" -gt 0 && "$len" -lt "$min_size" ]]; then
    printf "        ✗ content-length=%s is below min=%s — wrong file?\n" "$len" "$min_size"
    failed=$((failed + 1))
    return 1
  fi

  printf "        ✓ %s%s, CORS=%s\n" "$status_line" "${len:+, $len bytes}" "$cors"
}

echo "Smoke-testing on-device model assets…"
echo

# BirdNET-Lite ONNX (operator-hosted, optional). Cornell Lab v2.4 is ~50 MB.
check "BirdNET ONNX"     "${PUBLIC_BIRDNET_WEIGHTS_URL:+${PUBLIC_BIRDNET_WEIGHTS_URL%/}/birdnet_v2.4.onnx}" 30000000
check "BirdNET labels"   "${PUBLIC_BIRDNET_WEIGHTS_URL:+${PUBLIC_BIRDNET_WEIGHTS_URL%/}/BirdNET_GLOBAL_6K_V2.4_Labels.txt}" 50000

# EfficientNet-Lite0 ONNX (operator-hosted, optional). ~2.8 MB INT8.
check "EfficientNet ONNX" "${PUBLIC_ONNX_BASE_URL:+${PUBLIC_ONNX_BASE_URL%/}/efficientnet_lite0.onnx}" 1000000
check "ImageNet labels"   "${PUBLIC_ONNX_BASE_URL:+${PUBLIC_ONNX_BASE_URL%/}/imagenet_labels.txt}" 5000

# Offline map (Mexico pmtiles archive). The env var IS the file URL,
# unlike the others that point at a directory.
check "pmtiles MX"       "${PUBLIC_PMTILES_MX_URL:-}" 30000000

# MegaDetector v5a INT8 ONNX. ~134 MB — the wire format the on-device
# camera-trap plugin expects.
check "MegaDetector v5a" "${PUBLIC_MEGADETECTOR_WEIGHTS_URL:+${PUBLIC_MEGADETECTOR_WEIGHTS_URL%/}/megadetector_v5a.onnx}" 100000000

echo
if [[ "$failed" -eq 0 ]]; then
  echo "✓ All $checked configured model asset(s) reachable."
  exit 0
fi
echo "✗ $failed of $checked configured asset(s) failed. Affected identifiers"
echo "  will report \`model_not_bundled\` and the cascade will fall through."
echo "  Investigate the URLs above; once fixed, re-run the workflow."
exit 1
