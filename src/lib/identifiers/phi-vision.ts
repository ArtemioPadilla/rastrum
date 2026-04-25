/**
 * Phi-3.5-vision plugin (client-side via WebLLM).
 *
 * General-purpose VLM with NO taxonomic training. Confidence is
 * hard-capped at 0.4 by the database trigger; we set the cap at 0.35
 * here to make the intent visible in the cascade engine.
 */
import type { Identifier, IDResult, IdentifyInput } from './types';

export const phiVisionIdentifier: Identifier = {
  id: 'webllm_phi35_vision',
  name: 'Phi-3.5-vision (on-device)',
  description: 'General vision-language model, runs entirely in your browser. ~4 GB download. Hard-capped at low confidence — never reaches research-grade.',
  capabilities: {
    media: ['photo'],
    taxa: ['*'],
    runtime: 'client',
    license: 'free',
    confidence_ceiling: 0.35,
    cost_per_id_usd: 0,
  },
  async isAvailable() {
    if (typeof navigator === 'undefined' || !('gpu' in navigator)) {
      return { ready: false, reason: 'unsupported', message: 'WebGPU not available.' };
    }
    const { getModelCacheStatus, VISION_MODEL_ID } = await import('../local-ai');
    const status = await getModelCacheStatus(VISION_MODEL_ID);
    if (!status.cached) return { ready: false, reason: 'needs_download', message: '~4 GB download' };
    return { ready: true };
  },
  async identify(input: IdentifyInput): Promise<IDResult> {
    if (input.media.kind === 'url') {
      // Fetch and turn into a data URL so the model can read it
      const res = await fetch(input.media.url);
      const blob = await res.blob();
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(blob);
      });
      const { identifyImageLocal } = await import('../local-ai');
      const local = await identifyImageLocal(dataUrl, input.onProgress ?? (() => {}), {
        lat: input.location?.lat, lng: input.location?.lng, habitat: input.habitat ?? undefined,
      });
      return {
        scientific_name: local.scientific_name,
        common_name_en: local.common_name_en,
        common_name_es: local.common_name_es,
        family: local.family,
        kingdom: local.kingdom,
        confidence: Math.min(local.confidence, 0.35),
        source: 'webllm_phi35_vision',
        raw: local,
        warning: local.warning,
      };
    }
    if (input.media.kind === 'blob') {
      const dataUrl = await new Promise<string>((resolve, reject) => {
        const r = new FileReader();
        r.onload = () => resolve(r.result as string);
        r.onerror = () => reject(r.error);
        r.readAsDataURL(input.media.kind === 'blob' ? input.media.blob : new Blob());
      });
      const { identifyImageLocal } = await import('../local-ai');
      const local = await identifyImageLocal(dataUrl, input.onProgress ?? (() => {}));
      return {
        scientific_name: local.scientific_name,
        common_name_en: local.common_name_en,
        common_name_es: local.common_name_es,
        family: local.family,
        kingdom: local.kingdom,
        confidence: Math.min(local.confidence, 0.35),
        source: 'webllm_phi35_vision',
        raw: local,
        warning: local.warning,
      };
    }
    throw new Error('phi-vision: media.kind=bytes not supported');
  },
};
