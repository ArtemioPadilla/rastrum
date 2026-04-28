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

/**
 * Declares an API key the user can supply for this plugin. A plugin can
 * declare zero or more KeySpecs; the UI auto-renders inputs for each.
 *
 * Keys are stored in localStorage by the byo-keys module and forwarded
 * per-call when the plugin needs them. They never touch our server-side
 * persistence — only the Edge Function for that single identify call.
 */
export interface KeySpec {
  /** Stable name used by the plugin internally (e.g. 'anthropic', 'plantnet'). */
  name: string;
  /** Human-readable label for the input. */
  label: string;
  /** Format hint shown as placeholder (e.g. 'sk-ant-…'). */
  placeholder?: string;
  /** Short usage hint shown next to the input. */
  hint?: string;
  /** When true, the plugin still works without it (e.g. operator-set fallback). */
  optional?: boolean;
  /** Regex for client-side format validation before save. */
  pattern?: RegExp;
}

/**
 * One step in the user's onboarding flow for a plugin. Rendered as a
 * numbered list when the user clicks "Configure" — clickable link if
 * `link` is set, otherwise plain text.
 */
export interface SetupStep {
  text: string;
  /** Optional URL the step opens in a new tab. */
  link?: string;
  /** Small print rendered under the step. */
  details?: string;
}

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
  /**
   * Optional crop hint produced by an earlier cascade plugin (typically
   * MegaDetector v5a, which finds the animal bbox but doesn't classify
   * species). Plugins that consume it should pre-crop their input to
   * the bbox before running inference — animal-only crops give a ×3-5
   * accuracy bump on small subjects in distant camera-trap frames.
   *
   * Coordinates are in **source-image pixel space**, not the input
   * tensor space. Plugins that don't honor it (e.g. server-side
   * proxies that pass image_url verbatim) ignore the field; the
   * cascade still works, just at full-frame accuracy.
   *
   * `bbox` is `[x1, y1, x2, y2]` (top-left to bottom-right).
   */
  mediaCrop?: {
    bbox: [number, number, number, number];
    /** Plugin id that produced the bbox, for logging. */
    source: string;
  };
  /**
   * BYO API keys keyed by KeySpec.name. Plugins read what they need.
   * Empty when no plugin needs keys (Phi-3.5-vision, BirdNET-Lite, ...)
   */
  byo_keys?: Record<string, string>;
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
  /** Optional list of API keys the user can supply for this plugin. */
  keySpec?: KeySpec[];
  /** Ordered onboarding steps to walk the user through setup. */
  setupSteps?: SetupStep[];
  /** Logo URL or emoji shown next to the name in the UI. */
  brand?: string;
  /** Optional cheap "is this key valid?" probe for the Configure UI. */
  testConnection?(): Promise<{ ok: boolean; message?: string }>;
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
