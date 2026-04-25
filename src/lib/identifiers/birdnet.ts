/**
 * BirdNET-Lite plugin (client-side via TFLite/ONNX, planned v0.5).
 *
 * Shipped as a stub today — the model weights aren't bundled yet. Once we
 * package BirdNET-Lite as ONNX (or TFLite via tfjs-converter) and wire
 * onnxruntime-web's audio inference, this plugin lights up automatically.
 *
 * License: code MIT, model CC BY-NC-SA 4.0. Free for non-commercial use.
 * Cornell commercial license needed before v2.0 B2G dashboard ships.
 *
 * See docs/specs/modules/12-birdnet-audio.md.
 */
import type { Identifier, IDResult, IdentifyInput } from './types';

export const birdnetIdentifier: Identifier = {
  id: 'birdnet_lite',
  name: 'BirdNET-Lite (audio)',
  brand: '🐦',
  description: 'Cornell Lab\'s bird-call identifier, compiled to TFLite. Runs entirely on-device. Free for non-commercial use; attribution required.',
  setupSteps: [
    { text: 'Coming in v0.5 — Rastrum will host the ~50 MB model on its own CDN so you don\'t need an account.' },
    { text: 'Once shipped: Profile → Edit → AI settings → BirdNET-Lite → Download.' },
  ],
  capabilities: {
    media: ['audio', 'video'],
    taxa: ['Animalia.Aves'],
    runtime: 'client',
    license: 'free-nc',
    cost_per_id_usd: 0,
  },
  async isAvailable() {
    return { ready: false, reason: 'model_not_bundled', message: 'BirdNET-Lite weights ship in v0.5.' };
  },
  async identify(_input: IdentifyInput): Promise<IDResult> {
    throw new Error('BirdNET-Lite is not yet bundled. Available in v0.5.');
  },
};
