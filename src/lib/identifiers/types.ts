/**
 * Identifier plugin contract — see docs/specs/modules/13-identifier-registry.md.
 *
 * An "identifier" is any model or service capable of guessing what species
 * is in a piece of media. PlantNet, Claude Vision, Phi-3.5-vision (WebLLM),
 * BirdNET-Lite, on-device ONNX classifiers — all implement this same
 * interface, so the cascade engine can pick the right one for a given
 * observation without knowing how it works internally.
 *
 * Both client-side (browser/PWA) and server-side (Edge Function) registries
 * use the same shape. Plugins that only make sense on one side declare
 * `runtime: 'client' | 'server'` so the host environment skips the others.
 */

/** Standardised identification result. */
export interface IDResult {
  scientific_name: string;
  common_name_en: string | null;
  common_name_es: string | null;
  family: string | null;
  kingdom: 'Plantae' | 'Animalia' | 'Fungi' | 'Chromista' | 'Bacteria' | 'Unknown';
  /** 0–1. May be capped per identifier (e.g. Phi-3.5-vision is hard-capped at 0.4). */
  confidence: number;
  /** Stable identifier of the plugin that produced this result. */
  source: string;
  /** Provider's raw response, kept verbatim for the database column raw_response. */
  raw: unknown;
  /** Optional warning to surface to the user (e.g. "general VLM, may hallucinate"). */
  warning?: string;
}

export type MediaKind = 'photo' | 'audio' | 'video';
export type Runtime = 'client' | 'server';
export type LicenseKind =
  | 'free'              // free with no caveats
  | 'free-nc'           // free for non-commercial use only (e.g. BirdNET-Lite CC BY-NC-SA)
  | 'free-quota'        // free with rate limits / monthly quota (e.g. PlantNet free tier)
  | 'byo-key'           // user supplies their own API key (e.g. Claude BYO)
  | 'paid';             // operator pays per-call

/** Filter set telling the cascade engine when a plugin is a viable choice. */
export interface IdentifierCapabilities {
  /** Which media kinds the plugin can ingest. */
  media: MediaKind[];
  /** Which kingdoms the plugin's training covers. '*' = generalist. */
  taxa: Array<'Plantae' | 'Animalia' | 'Animalia.Aves' | 'Fungi' | '*'>;
  runtime: Runtime;
  license: LicenseKind;
  /** Hard ceiling on `confidence` regardless of the model's own report. */
  confidence_ceiling?: number;
  /** Approximate $ cost per identification (operator-side). 0 if free. */
  cost_per_id_usd?: number;
}

/** Per-plugin status surfaced to the UI. */
export type IdentifierAvailability =
  | { ready: true }
  | { ready: false; reason: 'needs_key' | 'needs_download' | 'unsupported' | 'model_not_bundled' | 'disabled'; message?: string };

/** Context passed to identify(). All fields optional. */
export interface IdentifyInput {
  /** Either a fetchable URL or a Blob/Uint8Array depending on runtime. */
  media:
    | { kind: 'url'; url: string; mime?: string }
    | { kind: 'bytes'; bytes: Uint8Array; mime: string }
    | { kind: 'blob'; blob: Blob; mime: string };
  mediaKind: MediaKind;
  user_hint?: 'plant' | 'animal' | 'fungi' | 'bird' | 'unknown';
  location?: { lat: number; lng: number };
  habitat?: string | null;
  /** Identifiers may chain — pass earlier results forward for context. */
  prior_candidates?: Array<Pick<IDResult, 'scientific_name' | 'confidence'>>;
  /** User's BYO Anthropic key (only applicable to plugins that need one). */
  byo_keys?: { anthropic?: string };
  /** Progress callback for slow / large operations (model load, etc.). */
  onProgress?: (p: { progress: number; text: string }) => void;
}

/** A single plugin. */
export interface Identifier {
  /** Stable string id used as `identifications.source` value. */
  id: string;
  /** Human-readable name shown in UI. */
  name: string;
  description: string;
  /** Static metadata for cascade decisions. */
  capabilities: IdentifierCapabilities;
  /** True when the plugin can run right now (env vars set, model downloaded). */
  isAvailable(): Promise<IdentifierAvailability>;
  /** Run the identification. May throw — caller catches and falls through. */
  identify(input: IdentifyInput): Promise<IDResult>;
}

/** Registry interface — both client and server implementations conform. */
export interface IdentifierRegistry {
  register(p: Identifier): void;
  get(id: string): Identifier | undefined;
  list(): Identifier[];
  /** All plugins that match the capability filter (used by the cascade). */
  findFor(opts: { media: MediaKind; taxa?: string; runtime?: Runtime }): Identifier[];
}
