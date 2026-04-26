/**
 * Camera-trap MegaDetector / SpeciesNet plugin — STUB.
 *
 * Mirrors the BirdNET-Lite shape (model_not_bundled until weights are
 * hosted). The intent is to eventually run MegaDetector v5a (animal
 * detection) and SpeciesNet (species classification) entirely server-side
 * — see docs/specs/modules/09-camera-trap.md for the cost model.
 *
 * STATUS: not wired to inference. `isAvailable()` always returns
 * `{ ready: false, reason: 'model_not_bundled' }` so the cascade engine
 * skips it, but the plugin is registered so the registry shows it (and
 * the cascade attempts log mentions why it skipped). When weights /
 * endpoint are available, fill in `identify()` and update `isAvailable()`.
 *
 * TODO — path to enabling real inference:
 *   1. Decide hosting: Modal.com (cheap GPU), AWS Lambda (CPU, slower),
 *      or Replicate (highest cost, easiest setup). Module 09 sketches
 *      cost numbers.
 *   2. Convert weights:
 *      - MegaDetector v5a checkpoint → ONNX  (animal/person/vehicle/empty bbox)
 *      - SpeciesNet → ONNX                  (taxon classifier given a bbox crop)
 *   3. Either:
 *      a) Ship a Supabase Edge Function `megadetector` that proxies the
 *         hosted endpoint and returns the standard IDResult shape, OR
 *      b) Run MegaDetector client-side via onnxruntime-web like BirdNET.
 *         Likely too heavy on phones — server-side is the realistic path.
 *   4. Replace `isAvailable()` with an env-var check (analogous to
 *      getBirdNETWeightsBaseUrl). Replace `identify()` with the call.
 *   5. Keep the same `confidence_ceiling` policy as Phi-3.5-vision —
 *      route low-confidence detections to `status='needs_review'`.
 *   6. License: SpeciesNet is Apache-2.0 (Google, March 2025). MegaDetector
 *      is MIT (Microsoft AI for Earth). Both safe for commercial use.
 *
 * License: code MIT (this file). Model: Apache-2.0 (SpeciesNet) + MIT
 * (MegaDetector).
 *
 * Refs:
 *   - https://github.com/agentmorris/SpeciesNet
 *   - https://github.com/agentmorris/MegaDetector
 *   - https://github.com/google/species-net
 */
import type { Identifier, IDResult, IdentifierAvailability, IdentifyInput } from './types';

export const CAMERA_TRAP_PLUGIN_ID = 'camera_trap_megadetector';

/**
 * Read the configured endpoint base URL. When unset (the default today),
 * the plugin reports `model_not_bundled` and the cascade skips it.
 */
export function getCameraTrapEndpoint(): string | null {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const url = env?.PUBLIC_MEGADETECTOR_ENDPOINT?.trim();
  return url && url.length > 0 ? url.replace(/\/$/, '') : null;
}

export const cameraTrapMegadetectorIdentifier: Identifier = {
  id: CAMERA_TRAP_PLUGIN_ID,
  name: 'MegaDetector + SpeciesNet (camera trap)',
  brand: '🎥',
  description:
    'Two-stage camera-trap pipeline: MegaDetector filters animal frames, SpeciesNet classifies to species. Server-hosted; not yet enabled until weights are deployed.',
  setupSteps: [
    {
      text: 'Self-host MegaDetector v5a + SpeciesNet behind an HTTPS endpoint, then set PUBLIC_MEGADETECTOR_ENDPOINT.',
      link: 'https://github.com/agentmorris/SpeciesNet',
      details:
        'See docs/specs/modules/09-camera-trap.md for hosting options (Modal / Lambda / Replicate) and cost estimates.',
    },
    {
      text: 'Best results: only enable for evidence_type=camera_trap observations. Use the batch importer at /profile/import/camera-trap/.',
    },
  ],
  capabilities: {
    media: ['photo'],
    taxa: ['Animalia', '*'],
    runtime: 'server',
    license: 'free',
    cost_per_id_usd: 0.005,
    confidence_ceiling: 0.95,
  },
  async isAvailable(): Promise<IdentifierAvailability> {
    if (!getCameraTrapEndpoint()) {
      return {
        ready: false,
        reason: 'model_not_bundled',
        message:
          'PUBLIC_MEGADETECTOR_ENDPOINT is not set — host the model and configure the endpoint.',
      };
    }
    // Placeholder: even when the env var is set, we still return false
    // until inference is actually wired. Remove this branch when the real
    // identify() lands.
    return {
      ready: false,
      reason: 'model_not_bundled',
      message: 'Inference path not implemented yet — see TODO in camera-trap-megadetector.ts.',
    };
  },
  async identify(_input: IdentifyInput): Promise<IDResult> {
    throw new Error(
      'camera_trap_megadetector: identify() is a stub. Wire MegaDetector + SpeciesNet endpoint per docs/specs/modules/09-camera-trap.md.',
    );
  },
};
