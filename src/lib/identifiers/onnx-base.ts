/**
 * EfficientNet-Lite0 ONNX base classifier (client-side, planned v0.3).
 *
 * Stub today — when we ship the ONNX weights to public/models/, isAvailable()
 * will report ready and the cascade engine will route to it as the offline
 * vision fallback (much smaller and species-aware vs. Phi-3.5-vision).
 */
import type { Identifier, IDResult, IdentifyInput } from './types';

export const onnxBaseIdentifier: Identifier = {
  id: 'onnx_efficientnet_lite0',
  name: 'EfficientNet-Lite0 (on-device, regional)',
  description: 'Compact species classifier fine-tuned on iNaturalist + GBIF. Runs offline with onnxruntime-web. ~3 MB.',
  capabilities: {
    media: ['photo'],
    taxa: ['*'],
    runtime: 'client',
    license: 'free',
    cost_per_id_usd: 0,
  },
  async isAvailable() {
    return { ready: false, reason: 'model_not_bundled', message: 'Weights ship in v0.3.' };
  },
  async identify(_input: IdentifyInput): Promise<IDResult> {
    throw new Error('EfficientNet-Lite0 weights are not yet bundled. Available in v0.3.');
  },
};
