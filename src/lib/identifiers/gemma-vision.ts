/**
 * Gemma 4 E2B vision plugin (client-side via transformers.js + ONNX).
 *
 * Parallel to `phi-vision.ts` — both are general-purpose VLMs without
 * taxonomic training. Confidence is hard-capped here at 0.35 (same as
 * Phi) so the database trigger and quality gate route them as
 * needs-review.
 *
 * The two coexist intentionally: when a hardware/driver combo crashes
 * one runtime's WebGPU kernels (MLC for Phi, ORT for Gemma), the user
 * can flip to the other. See docs/runbooks/on-device-vision-fallback.md
 * for the rationale.
 */
import type { Identifier, IDResult, IdentifyInput } from './types';

export const GEMMA_PLUGIN_ID = 'onnx_gemma4_vision';

export const gemmaVisionIdentifier: Identifier = {
  id: GEMMA_PLUGIN_ID,
  name: 'Gemma 4 E2B (on-device)',
  brand: '✨',
  description: 'Google Gemma 4 E2B vision-language model running entirely in your browser via transformers.js + ONNX Runtime Web. ~500 MB one-time download. Apache 2.0 licensed. Generalist — confidence is hard-capped because it has no taxonomic training.',
  setupSteps: [
    { text: 'Profile → Edit → AI settings → "Gemma 4 (experimental)" → "Download model".' },
    { text: 'You only download once. The model stays cached for next time.', details: 'Requires WebGPU and a device with more than 4 GB RAM. ~500 MB download + ~1.3 GB VRAM at inference.' },
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
    const { gemmaSupported } = await import('../onnx-vision');
    if (!gemmaSupported()) {
      const mem = typeof navigator !== 'undefined' ? (navigator as Navigator & { deviceMemory?: number }).deviceMemory : undefined;
      if (typeof mem === 'number' && mem <= 4) {
        return { ready: false, reason: 'insufficient_memory', message: `Device reports ~${mem} GB RAM — Gemma 4 needs more than 4 GB` };
      }
      return { ready: false, reason: 'unsupported', message: 'WebGPU not available' };
    }
    const { getGemmaCacheStatus } = await import('../onnx-vision');
    const status = await getGemmaCacheStatus();
    if (!status.cached) return { ready: false, reason: 'needs_download', message: '~500 MB download' };
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
      throw new Error('gemma-vision: media.kind=bytes not supported');
    }

    if (input.mediaCrop?.bbox) {
      try {
        const { cropDataUrlToBbox } = await import('./bbox-crop');
        dataUrl = await cropDataUrlToBbox(dataUrl, { bbox: input.mediaCrop.bbox });
      } catch {
        // Crop failed — fall through to full-frame inference.
      }
    }

    const { identifyImageWithGemma } = await import('../onnx-vision');
    const local = await identifyImageWithGemma(dataUrl, input.onProgress ?? (() => {}), {
      lat: input.location?.lat, lng: input.location?.lng, habitat: input.habitat ?? undefined,
    });
    return {
      scientific_name: local.scientific_name,
      common_name_en: local.common_name_en,
      common_name_es: local.common_name_es,
      family: local.family,
      kingdom: local.kingdom,
      confidence: Math.min(local.confidence, 0.35),
      source: GEMMA_PLUGIN_ID,
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
