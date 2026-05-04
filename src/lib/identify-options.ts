/**
 * Single source of truth for cascade option-building across all UI
 * surfaces that call runCascade() (#583).
 *
 * Without this helper, sync.ts / share/obs / chat / observe each
 * re-implemented exclusion + preferred logic divergently — so user
 * preferences (disabled plugins, BYO key, local-AI opt-out, EfficientNet
 * cache state) didn't propagate consistently.
 */

import { getKey } from './byo-keys';
import { getOnnxBaseCacheStatus, getOnnxBaseWeightsBaseUrl } from './identifiers/onnx-base-cache';
import { getDisabledPlugins } from './identifier-prefs';
import { isLocalAIEnabled } from './local-ai-prefs';

export interface IdentifyContext {
  mediaKind: 'photo' | 'audio' | 'video';
  evidenceType?: string;
  userHint?: 'plant' | 'animal' | 'fungi' | 'unknown';
}

export interface IdentifyContextResult {
  excluded: string[];
  preferred: string[];
  taxa?: string;
}

export async function buildCascadeOptions(ctx: IdentifyContext): Promise<IdentifyContextResult> {
  const excluded: string[] = [];

  // 1. User-disabled plugins (registry UI toggle)
  for (const id of getDisabledPlugins()) {
    if (!excluded.includes(id)) excluded.push(id);
  }

  // 2. WebLLM Phi + BirdNET gated on local-AI bandwidth opt-in
  if (!isLocalAIEnabled()) {
    if (!excluded.includes('webllm_phi35_vision')) excluded.push('webllm_phi35_vision');
    if (!excluded.includes('birdnet_lite')) excluded.push('birdnet_lite');
  }

  // 3. EfficientNet only when its weights are cached
  const efficientNetCached = getOnnxBaseWeightsBaseUrl()
    ? await getOnnxBaseCacheStatus().then(s => s.modelCached && s.labelsCached).catch(() => false)
    : false;
  if (!efficientNetCached && !excluded.includes('onnx_efficientnet_lite0')) {
    excluded.push('onnx_efficientnet_lite0');
  }

  // 4. Claude needs a BYO key (sponsorship gate happens server-side, see #595)
  if (!getKey('claude_haiku', 'anthropic') && !excluded.includes('claude_haiku')) {
    excluded.push('claude_haiku');
  }

  // 5. Camera-trap evidence biases the cascade toward MegaDetector
  const preferred: string[] = [];
  if (ctx.mediaKind === 'photo' && ctx.evidenceType === 'camera_trap') {
    preferred.push('camera_trap_megadetector');
  }

  // 6. Audio defaults to Aves until non-bird audio plugins arrive
  const taxa = ctx.mediaKind === 'audio' ? 'Animalia.Aves' : undefined;

  return { excluded, preferred, taxa };
}
