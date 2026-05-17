/**
 * Per-source confidence ceiling — the single source of truth. Capped
 * on-device identifiers can never exceed these, which keeps them below
 * the ≥0.4 research-grade floor (consensus integrity, #1128 R2). Cloud /
 * human / unknown sources are uncapped (ceiling 1).
 */
export const CONFIDENCE_CEILING: Readonly<Record<string, number>> = {
  onnx_efficientnet_lite0: 0.4,
  camera_trap_megadetector: 0.4,
  webllm_phi35_vision: 0.35,
  phi_vision: 0.35,
  onnx_gemma4_vision: 0.35,
  speciesnet: 0.85,
};

export function ceilingForSource(source: string | null | undefined): number {
  if (!source) return 1;
  return CONFIDENCE_CEILING[source] ?? 1;
}

/** Clamp a confidence into [0, ceilingForSource(source)]. */
export function capConfidence(source: string | null | undefined, confidence: number | null | undefined): number {
  const c = Number.isFinite(confidence as number) ? (confidence as number) : 0;
  return Math.max(0, Math.min(ceilingForSource(source), c));
}
