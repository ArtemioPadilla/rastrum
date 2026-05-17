/**
 * Source-trust rank for validate/expert queue ordering (#1128 R3). Lower
 * rank surfaces earlier so on-device-first volume doesn't bury
 * higher-signal items under capped guesses. NOT a consensus weight — pure
 * queue ordering/visibility.
 */
const CLOUD = new Set(['plantnet', 'claude_haiku', 'claude_sonnet', 'bedrock', 'openai', 'azure_openai', 'gemini', 'vertex_ai']);
const CAPPED_ON_DEVICE = new Set(['onnx_efficientnet_lite0', 'camera_trap_megadetector', 'phi_vision', 'webllm_phi35_vision', 'onnx_gemma4_vision', 'birdnet_lite', 'onnx_offline']);

export function sourceTrustRank(source: string | null | undefined): number {
  if (source === 'human') return 0;       // a human primary needing more validators
  if (source && CLOUD.has(source)) return 1;
  if (source && CAPPED_ON_DEVICE.has(source)) return 2;
  return 3;                               // null / unknown — lowest signal
}
