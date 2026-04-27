# MegaDetector hosting recipe

One-shot conversion of MegaDetector v5a (PyTorch YOLOv5 checkpoint, MIT) to
the INT8-quantised ONNX file the on-device plugin in
`src/lib/identifiers/camera-trap-megadetector.ts` expects.

## Why this exists

The PyPI `megadetector` package ships **inference utilities**, not export.
Conversion to ONNX goes through Ultralytics' YOLOv5 `export.py`, which is
why this recipe clones `ultralytics/yolov5` rather than relying on the
megadetector package directly. After export we INT8-quantise dynamically
via `onnxruntime.quantization` so the on-device download shrinks from
~140 MB FP32 to ~85 MB.

## Usage

```bash
cd infra/megadetector
./convert.sh
```

That's it. The script:

1. Creates a `./venv/` and installs YOLOv5 + onnxruntime + onnx
2. Clones `ultralytics/yolov5` into `./yolov5/` (cached on subsequent runs)
3. Downloads `md_v5a.0.0.pt` from the official MegaDetector release if you
   don't have it already (`--weights /path/to/checkpoint.pt` to override)
4. Runs `yolov5/export.py --weights … --include onnx --imgsz 640 --opset 12 --simplify`
5. Quantises FP32 → INT8 via `quantize_int8.py`
6. Writes `out/megadetector_v5a.onnx` (the file the client expects)

Flags:
- `--weights /path/v5a.pt` — use a custom checkpoint
- `--skip-quantise`        — keep FP32 (~140 MB), useful for accuracy diffing

## After conversion: hosting

Upload `out/megadetector_v5a.onnx` to a CORS-open public URL. The client
fetches `${PUBLIC_MEGADETECTOR_WEIGHTS_URL}/megadetector_v5a.onnx`, so
`PUBLIC_MEGADETECTOR_WEIGHTS_URL` should be the **directory** URL (no
trailing slash).

### Cloudflare R2 (the project's existing pattern — same bucket as pmtiles)

```bash
# Once: bind the rastrum-media bucket if you haven't.
# wrangler r2 bucket create rastrum-media

wrangler r2 object put rastrum-media/models/megadetector_v5a.onnx \
  --file=out/megadetector_v5a.onnx \
  --content-type=application/octet-stream

# Then make sure the bucket has CORS open for media.rastrum.org. The
# project already serves BirdNET, EfficientNet, and pmtiles from the
# same hostname, so CORS should already be configured. Verify with:
curl -I https://media.rastrum.org/models/megadetector_v5a.onnx
```

### CI: set the env var

In GitHub Actions, set:

```yaml
env:
  PUBLIC_MEGADETECTOR_WEIGHTS_URL: https://media.rastrum.org/models
```

(Or wherever you uploaded the file — without the filename.)

Rebuild and deploy. The OnboardingTour download row + Profile → Edit AI
settings download button will activate on the next page load. The cascade
preference for `evidence_type=camera_trap` photos picks up the plugin
automatically.

## Verifying the round-trip

```bash
# Smoke-test the file exists and is correctly served:
curl -I "${PUBLIC_MEGADETECTOR_WEIGHTS_URL}/megadetector_v5a.onnx"
# Should return 200 + content-length ≈ 85_000_000 + access-control-allow-origin
```

In the browser, open DevTools → Application → Cache Storage → look for the
`rastrum/megadetector` cache after triggering the download from the
onboarding modal. Then watch the Network tab during a camera-trap upload:
no fetch to PlantNet/Claude/Phi for empty/human/vehicle frames.

## Licensing reminders

- **MegaDetector v5a:** MIT (Microsoft AI for Earth) — safe for commercial
  use. Attribute Beery, Morris & Yang (2019) in the data export README.
- **YOLOv5:** AGPL-3.0 *for the inference code*. We only use it for
  one-shot export; the resulting ONNX is purely the trained weights and
  inherits MegaDetector's MIT license.
- **Compute for export:** any laptop CPU is fine — export runs in ~30s.
  No GPU required.

## Troubleshooting

**"ModuleNotFoundError: No module named 'megadetector'"** when running
`detection/run_detector_batch.py` from inside the source tree: the megadetector
PyPI package is not the export tool. Use this recipe (which calls YOLOv5
directly), or `python -m megadetector.detection.run_detector_batch` from
**outside** the source tree.

**Export fails with "torch.onnx export not supported"**: ensure
`torch>=2.0` is installed; `convert.sh` pins compatible versions via
`yolov5/requirements.txt`.

**85 MB target not hit (still ~140 MB)**: you ran with `--skip-quantise`.
Re-run without that flag, or run `python quantize_int8.py --in
out/megadetector_v5a.fp32.onnx --out out/megadetector_v5a.onnx`.

## See also

- Spec: [`docs/specs/modules/09-camera-trap.md`](../../docs/specs/modules/09-camera-trap.md)
- Plugin: [`src/lib/identifiers/camera-trap-megadetector.ts`](../../src/lib/identifiers/camera-trap-megadetector.ts)
- YOLO helpers: [`src/lib/identifiers/megadetector-yolo.ts`](../../src/lib/identifiers/megadetector-yolo.ts)
- Cache helpers: [`src/lib/identifiers/megadetector-cache.ts`](../../src/lib/identifiers/megadetector-cache.ts)
