/**
 * Camera-trap MegaDetector + SpeciesNet plugin.
 *
 * Calls an operator-hosted HTTPS endpoint that wraps MegaDetector v5a
 * (animal/person/vehicle bbox filter, MIT) and SpeciesNet (taxon
 * classifier given the animal crop, Apache-2.0). The endpoint URL is
 * read from `PUBLIC_MEGADETECTOR_ENDPOINT` at build time; when unset
 * the plugin reports `model_not_bundled` and the cascade skips it.
 *
 * Operator hosting choices and cost numbers live in
 * `docs/specs/modules/09-camera-trap.md`. Reference servers:
 *   - https://github.com/agentmorris/SpeciesNet
 *   - https://github.com/agentmorris/MegaDetector
 *
 * ── Wire format ────────────────────────────────────────────────────
 *
 * Request:  POST ${PUBLIC_MEGADETECTOR_ENDPOINT}
 *   {
 *     "image_url":      "https://…",       // absolute URL the server can fetch
 *     "lang":           "en" | "es",       // for localised common names
 *     "min_confidence": 0.2                 // MegaDetector bbox threshold
 *   }
 *
 * Response (200):
 *   {
 *     "filtered_label":  null | "empty" | "human" | "vehicle",
 *     "scientific_name": "Lynx rufus",
 *     "common_name_en":  "Bobcat",
 *     "common_name_es":  "Lince rojo",
 *     "family":          "Felidae",
 *     "kingdom":         "Animalia",
 *     "confidence":      0.87,
 *     "alternates":      [{ "scientific_name": "Lynx canadensis", "confidence": 0.05 }],
 *     "detections":      [{ "bbox": [x,y,w,h], "category": "animal", "confidence": 0.92 }]
 *   }
 *
 * When `filtered_label` is set (empty / human / vehicle frame), this
 * plugin THROWS so the cascade falls through and the photo lands in
 * `status='needs_review'`. The bbox stays in the raw response for
 * later review tooling.
 *
 * License: code MIT (this file). Models: MIT (MegaDetector) +
 * Apache-2.0 (SpeciesNet) — both safe for commercial use.
 */
import type {
  Identifier, IDResult, IdentifierAvailability, IdentifyInput,
} from './types';

export const CAMERA_TRAP_PLUGIN_ID = 'camera_trap_megadetector';

/** Operator-configured endpoint; null when unset. Trailing slash stripped. */
export function getCameraTrapEndpoint(): string | null {
  const env = import.meta.env as unknown as Record<string, string | undefined>;
  const url = env?.PUBLIC_MEGADETECTOR_ENDPOINT?.trim();
  return url && url.length > 0 ? url.replace(/\/$/, '') : null;
}

interface CameraTrapResponse {
  filtered_label?: 'empty' | 'human' | 'vehicle' | null;
  scientific_name?: string;
  common_name_en?: string | null;
  common_name_es?: string | null;
  family?: string | null;
  kingdom?: 'Plantae' | 'Animalia' | 'Fungi' | 'Chromista' | 'Bacteria' | 'Unknown';
  confidence?: number;
  alternates?: Array<{ scientific_name: string; confidence: number }>;
  detections?: Array<{ bbox: [number, number, number, number]; category: string; confidence: number }>;
}

export const cameraTrapMegadetectorIdentifier: Identifier = {
  id: CAMERA_TRAP_PLUGIN_ID,
  name: 'MegaDetector + SpeciesNet (camera trap)',
  brand: '🎥',
  description:
    'Two-stage camera-trap pipeline: MegaDetector filters animal frames, SpeciesNet classifies to species. Operator-hosted; auto-routes photos tagged evidence_type=camera_trap.',
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
    return { ready: true };
  },

  async testConnection(): Promise<{ ok: boolean; message?: string }> {
    const endpoint = getCameraTrapEndpoint();
    if (!endpoint) return { ok: false, message: 'Endpoint not configured.' };
    try {
      // Most MegaDetector deployments answer GET / with 200/204/health JSON.
      const res = await fetch(endpoint, { method: 'GET', mode: 'cors' });
      return res.ok || res.status === 405
        ? { ok: true }
        : { ok: false, message: `HTTP ${res.status}` };
    } catch (err) {
      return { ok: false, message: err instanceof Error ? err.message : 'network error' };
    }
  },

  async identify(input: IdentifyInput): Promise<IDResult> {
    const endpoint = getCameraTrapEndpoint();
    if (!endpoint) {
      throw new Error(
        'camera_trap_megadetector: PUBLIC_MEGADETECTOR_ENDPOINT is not configured.',
      );
    }
    if (input.media.kind !== 'url') {
      // The endpoint is server-hosted and fetches by URL. If we ever wire
      // a base64 path, branch here.
      throw new Error('camera_trap_megadetector: only url-form media is supported.');
    }

    const lang = (typeof navigator !== 'undefined' && navigator.language?.startsWith('es'))
      ? 'es' : 'en';

    const res = await fetch(endpoint, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        image_url: input.media.url,
        lang,
        min_confidence: 0.2,
      }),
    });
    if (!res.ok) {
      throw new Error(`camera_trap_megadetector: HTTP ${res.status}`);
    }
    const data = (await res.json()) as CameraTrapResponse;

    // Empty / human / vehicle frames: bail so the cascade can continue
    // (or so the row falls into needs_review). Keep the raw payload on
    // the error so server-side logging can surface why.
    if (data.filtered_label) {
      const err = new Error(
        `camera_trap_megadetector: filtered as ${data.filtered_label}`,
      ) as Error & { filtered_label?: string; raw?: unknown };
      err.filtered_label = data.filtered_label;
      err.raw = data;
      throw err;
    }

    if (!data.scientific_name) {
      throw new Error('camera_trap_megadetector: no species in response');
    }

    return {
      scientific_name: data.scientific_name,
      common_name_en: data.common_name_en ?? null,
      common_name_es: data.common_name_es ?? null,
      family: data.family ?? null,
      kingdom: data.kingdom ?? 'Animalia',
      confidence: typeof data.confidence === 'number' ? data.confidence : 0,
      source: CAMERA_TRAP_PLUGIN_ID,
      raw: data,
    };
  },
};
