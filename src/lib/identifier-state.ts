/**
 * State derivation for identifier plugin cards on the AI settings tab.
 *
 * Single source of truth for "what is the card showing right now?". The
 * UI (paintRegistry) and the cascade gates (ObservationForm /
 * ObserveView2) both call deriveCardState so the visual state on the
 * settings tab cannot drift from the runtime gating decision.
 *
 * Also owns the one-shot localStorage migration that retires the
 * pre-redesign keys (`rastrum.localAiOptIn`,
 * `rastrum.prefs.usePhiVision`, `rastrum.prefs.useGemmaVision`) in
 * favor of the single `rastrum.disabledPlugins` source of truth.
 */
import type { IdentifierAvailability } from './identifiers/types';
import type { ModelCacheStatus } from './local-ai';

export interface DerivedStateInput {
  pluginId: string;
  runtime: 'cloud' | 'client';
  availability: IdentifierAvailability;
  isDisabled: boolean;
  /** null for cloud plugins; ModelCacheStatus for on-device. */
  cacheStatus: ModelCacheStatus | null;
  /** True when the plugin needs a key and the user has saved one. */
  byoKeysSet: boolean;
}

export type CardState =
  | { kind: 'active' }
  | { kind: 'disabled' }
  | { kind: 'no-key' }
  | { kind: 'not-downloaded' }
  | { kind: 'downloading'; pct: number; mb: { current: number; total: number } }
  | { kind: 'unsupported'; reason: 'webgpu' | 'memory' | 'env-missing' | 'other'; message?: string };

export function deriveCardState(input: DerivedStateInput): CardState {
  // User-flipped Disable wins over everything except actual unsupportedness.
  if (input.isDisabled && input.availability.ready) {
    return { kind: 'disabled' };
  }
  if (input.availability.ready) {
    return { kind: 'active' };
  }
  // Not ready — translate availability reason into the card's vocabulary.
  switch (input.availability.reason) {
    case 'needs_key':
      return { kind: 'no-key' };
    case 'needs_download':
      return { kind: 'not-downloaded' };
    case 'model_not_bundled':
      return { kind: 'unsupported', reason: 'env-missing', message: input.availability.message };
    case 'unsupported':
      return { kind: 'unsupported', reason: 'webgpu', message: input.availability.message };
    case 'insufficient_memory':
      return { kind: 'unsupported', reason: 'memory', message: input.availability.message };
    case 'disabled':
      return { kind: 'disabled' };
    default:
      return { kind: 'unsupported', reason: 'other', message: input.availability.message };
  }
}

const LEGACY_KEY_LOCAL_AI_OPTIN = 'rastrum.localAiOptIn';
const LEGACY_KEY_USE_PHI = 'rastrum.prefs.usePhiVision';
const LEGACY_KEY_USE_GEMMA = 'rastrum.prefs.useGemmaVision';
const DISABLED_PLUGINS_KEY = 'rastrum.disabledPlugins';

const LEGACY_PLUGIN_MAP: Record<string, string> = {
  [LEGACY_KEY_USE_PHI]: 'webllm_phi35_vision',
  [LEGACY_KEY_USE_GEMMA]: 'onnx_gemma4_vision',
};

/**
 * Idempotent. Migrates the three legacy preference keys to
 * `rastrum.disabledPlugins`. Preserves OLD opt-in semantics: a plugin
 * that was NOT running under OLD rules continues NOT running under NEW
 * rules. Short-circuits for brand-new browsers (no legacy keys at all).
 */
export function runStorageMigration(): void {
  const hasAnyLegacyKey =
    localStorage.getItem(LEGACY_KEY_LOCAL_AI_OPTIN) !== null ||
    localStorage.getItem(LEGACY_KEY_USE_PHI) !== null ||
    localStorage.getItem(LEGACY_KEY_USE_GEMMA) !== null;
  if (!hasAnyLegacyKey) return;

  const raw = localStorage.getItem(DISABLED_PLUGINS_KEY);
  let disabled: Set<string>;
  try {
    disabled = new Set<string>(JSON.parse(raw ?? '[]'));
  } catch {
    disabled = new Set<string>();
  }

  for (const [legacyKey, pluginId] of Object.entries(LEGACY_PLUGIN_MAP)) {
    const value = localStorage.getItem(legacyKey);
    if (value !== 'true') {
      disabled.add(pluginId);
    }
    localStorage.removeItem(legacyKey);
  }

  localStorage.removeItem(LEGACY_KEY_LOCAL_AI_OPTIN);

  localStorage.setItem(DISABLED_PLUGINS_KEY, JSON.stringify([...disabled]));
}
