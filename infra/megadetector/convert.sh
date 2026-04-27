#!/usr/bin/env bash
# Convert MegaDetector v5a (PyTorch YOLOv5 checkpoint) → ONNX → INT8 quantised
# ONNX, ready to upload to PUBLIC_MEGADETECTOR_WEIGHTS_URL.
#
# MegaDetector v5a is a YOLOv5 model from Microsoft AI for Earth (MIT).
# The export uses Ultralytics' YOLOv5 export.py (not the megadetector PyPI
# package — that one ships inference utilities, not export). After export
# we INT8-quantise via onnxruntime so the client downloads ~134 MB INT8
# instead of ~535 MB FP32 (modern YOLOv5 export is fatter than the
# 2021-era v5a checkpoint; quantisation still wins ~75% off).
#
# Usage:
#   ./convert.sh                          # full pipeline, leaves output in ./out/
#   ./convert.sh --skip-quantise          # FP32 only (~535 MB; usually you want INT8)
#   ./convert.sh --weights /path/v5a.pt   # custom checkpoint path
#
# Output: out/megadetector_v5a.onnx (the file the client expects, INT8 ~134 MB)
#         out/megadetector_v5a.fp32.onnx (kept around for debugging, ~535 MB)
#
# Then upload `out/megadetector_v5a.onnx` to a CORS-open public URL and set
# `PUBLIC_MEGADETECTOR_WEIGHTS_URL` to the directory holding it (no trailing
# slash). The client appends `/megadetector_v5a.onnx` automatically.
#
# Requirements (auto-installed into ./venv/):
#   python >= 3.10, pip, git
set -euo pipefail

HERE="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
OUT="$HERE/out"
VENV="$HERE/venv"
WEIGHTS_URL="https://github.com/agentmorris/MegaDetector/releases/download/v5.0/md_v5a.0.0.pt"
WEIGHTS_PATH=""
SKIP_QUANTISE=0

while [[ $# -gt 0 ]]; do
  case "$1" in
    --weights)        WEIGHTS_PATH="$2"; shift 2 ;;
    --skip-quantise)  SKIP_QUANTISE=1; shift ;;
    -h|--help)        sed -n '1,30p' "$0"; exit 0 ;;
    *)                echo "unknown flag: $1" >&2; exit 1 ;;
  esac
done

mkdir -p "$OUT"

# 1. Set up the venv
if [[ ! -d "$VENV" ]]; then
  echo "▶ Creating venv at $VENV"
  python3 -m venv "$VENV"
fi
# shellcheck disable=SC1091
source "$VENV/bin/activate"
python -m pip install --quiet --upgrade pip

# 2. Clone YOLOv5 if not present
if [[ ! -d "$HERE/yolov5" ]]; then
  echo "▶ Cloning ultralytics/yolov5"
  git clone --depth 1 --quiet https://github.com/ultralytics/yolov5 "$HERE/yolov5"
fi
echo "▶ Installing YOLOv5 requirements + onnxruntime"
pip install --quiet -r "$HERE/yolov5/requirements.txt"
pip install --quiet "onnx>=1.15" "onnxruntime>=1.16" "onnxslim>=0.1"

# 3. Pull the v5a checkpoint if not provided
if [[ -z "$WEIGHTS_PATH" ]]; then
  WEIGHTS_PATH="$HERE/md_v5a.0.0.pt"
  if [[ ! -f "$WEIGHTS_PATH" ]]; then
    echo "▶ Downloading $WEIGHTS_URL → $WEIGHTS_PATH"
    curl -L --fail -o "$WEIGHTS_PATH" "$WEIGHTS_URL"
  fi
fi

# 4. Run YOLOv5's export.py — produces md_v5a.0.0.onnx beside the checkpoint.
# Note: we don't pass --opset; the modern Ultralytics exporter ignores low
# opset requests anyway (uses opset 18 internally) and the downgrade
# attempt fails on Resize ops with a noisy traceback. onnxruntime-web 1.20+
# supports through opset 21, so the default is fine.
echo "▶ Exporting to ONNX (640×640, default opset, CPU)"
( cd "$HERE/yolov5" \
  && python export.py \
       --weights "$WEIGHTS_PATH" \
       --include onnx \
       --imgsz 640 \
       --device cpu \
       --simplify )

# YOLOv5 writes to ${weights%.pt}.onnx — locate and stage it.
FP32_OUT="${WEIGHTS_PATH%.pt}.onnx"
if [[ ! -f "$FP32_OUT" ]]; then
  echo "✗ ONNX export failed — no file at $FP32_OUT" >&2
  exit 1
fi
mv "$FP32_OUT" "$OUT/megadetector_v5a.fp32.onnx"
echo "✓ FP32 ONNX → $OUT/megadetector_v5a.fp32.onnx ($(du -h "$OUT/megadetector_v5a.fp32.onnx" | cut -f1))"

# 5. INT8 dynamic quantisation
if [[ "$SKIP_QUANTISE" -eq 1 ]]; then
  cp "$OUT/megadetector_v5a.fp32.onnx" "$OUT/megadetector_v5a.onnx"
  echo "✓ Skipped quantise — using FP32 weights at $OUT/megadetector_v5a.onnx"
else
  echo "▶ INT8-quantising for the on-device client"
  python "$HERE/quantize_int8.py" \
    --in "$OUT/megadetector_v5a.fp32.onnx" \
    --out "$OUT/megadetector_v5a.onnx"
  echo "✓ INT8 ONNX → $OUT/megadetector_v5a.onnx ($(du -h "$OUT/megadetector_v5a.onnx" | cut -f1))"
fi

echo
echo "Next:"
echo "  1) Upload $OUT/megadetector_v5a.onnx to a CORS-open public URL."
echo "     Example (Cloudflare R2 — note --remote, otherwise it goes to the local Miniflare emulator):"
echo "       wrangler r2 object put rastrum-media/models/megadetector_v5a.onnx \\"
echo "         --file=$OUT/megadetector_v5a.onnx --content-type=application/octet-stream --remote"
echo "  2) Set in CI: PUBLIC_MEGADETECTOR_WEIGHTS_URL=https://media.rastrum.org/models"
echo "  3) Rebuild + deploy. The client picks it up on the next page load."
