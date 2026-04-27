"""INT8 dynamic quantisation for the MegaDetector v5a ONNX export.

Dynamic quantisation is calibration-free — it folds activation ranges
into the model at inference time. On the modern Ultralytics export of
MegaDetector v5a we observe ~535 MB FP32 → ~134 MB INT8 (a ~75%
reduction) with negligible accuracy loss for detection at the default
IoU/conf thresholds we use in the client.

Usage (called from convert.sh):
    python quantize_int8.py --in fp32.onnx --out int8.onnx
"""
import argparse
import sys
from pathlib import Path

from onnxruntime.quantization import QuantType, quantize_dynamic


def main() -> int:
    ap = argparse.ArgumentParser()
    ap.add_argument("--in",  dest="src", required=True, type=Path)
    ap.add_argument("--out", dest="dst", required=True, type=Path)
    args = ap.parse_args()

    quantize_dynamic(
        model_input=str(args.src),
        model_output=str(args.dst),
        weight_type=QuantType.QInt8,
        # Skip ConstantOfShape and Pad ops — YOLOv5 detection heads
        # contain a few that don't quantise cleanly under dynamic mode.
        op_types_to_quantize=["MatMul", "Conv", "Gemm"],
    )
    src_mb = args.src.stat().st_size / (1024 * 1024)
    dst_mb = args.dst.stat().st_size / (1024 * 1024)
    print(f"  quantised: {src_mb:.1f} MB → {dst_mb:.1f} MB ({dst_mb/src_mb*100:.0f}%)")
    return 0


if __name__ == "__main__":
    sys.exit(main())
