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
  brand: '🧠',
  description: 'Microsoft Phi-3.5 vision-language model running entirely in your browser via WebLLM. ~4 GB one-time download. Generalist — confidence is hard-capped because it has no taxonomic training.',
  setupSteps: [
    { text: 'Profile → Edit → AI settings → "On-device AI" → "Download vision model".' },
    { text: 'You only download once. The model stays cached for next time.', details: 'Requires WebGPU. ~4 GB download + ~5 GB free disk space.' },
  ],
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
    let dataUrl: string;
    if (input.media.kind === 'url') {
      const res = await fetch(input.media.url);
      const blob = await res.blob();
      dataUrl = await blobToDataUrl(blob);
    } else if (input.media.kind === 'blob') {
      dataUrl = await blobToDataUrl(input.media.blob);
    } else {
      throw new Error('phi-vision: media.kind=bytes not supported');
    }

    // Bbox crop forwarded by an upstream plugin (typically MegaDetector
    // for camera-trap photos). Pre-cropping to the animal lifts Phi's
    // accuracy substantially on small subjects in distant frames.
    if (input.mediaCrop?.bbox) {
      try {
        const { cropDataUrlToBbox } = await import('./bbox-crop');
        dataUrl = await cropDataUrlToBbox(dataUrl, { bbox: input.mediaCrop.bbox });
      } catch {
        // Crop failed (image decode, no canvas, etc.) — fall through to
        // full-frame inference. Better to identify with reduced accuracy
        // than to fail the cascade entirely.
      }
    }

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
  },
};

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onload = () => resolve(r.result as string);
    r.onerror = () => reject(r.error);
    r.readAsDataURL(blob);
  });
}
