import { describe, it, expect, beforeEach } from 'vitest';
import {
  deriveCardState,
  runStorageMigration,
  type DerivedStateInput,
} from '../../src/lib/identifier-state';

// localStorage shim (matches the byo-keys.test.ts pattern)
beforeEach(() => {
  const store = new Map<string, string>();
  globalThis.localStorage = {
    getItem: (k) => (store.has(k) ? store.get(k)! : null),
    setItem: (k, v) => store.set(k, v),
    removeItem: (k) => store.delete(k),
    clear: () => store.clear(),
    length: 0,
    key: () => null,
  } as Storage;
});

function input(overrides: Partial<DerivedStateInput> = {}): DerivedStateInput {
  return {
    pluginId: 'webllm_phi35_vision',
    runtime: 'client',
    availability: { ready: true },
    isDisabled: false,
    cacheStatus: { modelId: 'webllm_phi35_vision', cached: true, approxBytes: 4_000_000_000, entries: 15 },
    byoKeysSet: false,
    ...overrides,
  };
}

describe('deriveCardState', () => {
  it('returns active when ready and not disabled', () => {
    expect(deriveCardState(input())).toEqual({ kind: 'active' });
  });

  it('returns disabled when user has flipped the toggle', () => {
    expect(deriveCardState(input({ isDisabled: true }))).toEqual({ kind: 'disabled' });
  });

  it('returns no-key for cloud plugin missing required key', () => {
    const s = deriveCardState(input({
      runtime: 'cloud',
      availability: { ready: false, reason: 'needs_key' },
      cacheStatus: null,
    }));
    expect(s).toEqual({ kind: 'no-key' });
  });

  it('returns not-downloaded for on-device plugin without cache', () => {
    const s = deriveCardState(input({
      cacheStatus: { modelId: 'webllm_phi35_vision', cached: false, approxBytes: 0, entries: 0 },
      availability: { ready: false, reason: 'needs_download' },
    }));
    expect(s).toEqual({ kind: 'not-downloaded' });
  });

  it('returns unsupported for missing WebGPU', () => {
    const s = deriveCardState(input({
      availability: { ready: false, reason: 'unsupported', message: 'WebGPU unavailable' },
    }));
    expect(s).toEqual({ kind: 'unsupported', reason: 'webgpu', message: 'WebGPU unavailable' });
  });

  it('returns unsupported for insufficient memory', () => {
    const s = deriveCardState(input({
      availability: { ready: false, reason: 'insufficient_memory', message: 'Need > 4 GB RAM' },
    }));
    expect(s).toEqual({ kind: 'unsupported', reason: 'memory', message: 'Need > 4 GB RAM' });
  });

  it('disabled state takes precedence over availability', () => {
    expect(deriveCardState(input({ isDisabled: true }))).toEqual({ kind: 'disabled' });
  });
});

describe('runStorageMigration', () => {
  it('is a no-op when no legacy keys are present (brand-new browser)', () => {
    runStorageMigration();
    expect(localStorage.getItem('rastrum.disabledPlugins')).toBeNull();
  });

  it('migrates usePhiVision=false → adds webllm_phi35_vision to disabledPlugins', () => {
    localStorage.setItem('rastrum.prefs.usePhiVision', 'false');
    runStorageMigration();
    expect(JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]'))
      .toContain('webllm_phi35_vision');
    expect(localStorage.getItem('rastrum.prefs.usePhiVision')).toBeNull();
  });

  it('migrates usePhiVision=true → does NOT add to disabledPlugins, removes legacy key', () => {
    localStorage.setItem('rastrum.prefs.usePhiVision', 'true');
    runStorageMigration();
    expect(JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]'))
      .not.toContain('webllm_phi35_vision');
    expect(localStorage.getItem('rastrum.prefs.usePhiVision')).toBeNull();
  });

  it('treats missing usePhiVision (null) the same as false when other legacy keys are present', () => {
    // Review feedback from #673: a user who only set localAiOptIn but never
    // touched usePhiVision had Phi out of the cascade under OLD rules.
    // Migration must preserve that: Phi → disabledPlugins.
    localStorage.setItem('rastrum.localAiOptIn', 'true');
    runStorageMigration();
    expect(JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]'))
      .toContain('webllm_phi35_vision');
  });

  it('migrates useGemmaVision=false the same way', () => {
    localStorage.setItem('rastrum.prefs.useGemmaVision', 'false');
    runStorageMigration();
    expect(JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]'))
      .toContain('onnx_gemma4_vision');
  });

  it('removes localAiOptIn key after processing (no behavioral mapping)', () => {
    localStorage.setItem('rastrum.localAiOptIn', 'true');
    runStorageMigration();
    expect(localStorage.getItem('rastrum.localAiOptIn')).toBeNull();
  });

  it('is idempotent — running twice does not duplicate disabledPlugins entries', () => {
    localStorage.setItem('rastrum.prefs.usePhiVision', 'false');
    runStorageMigration();
    runStorageMigration();
    const list = JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]');
    expect(list.filter((id: string) => id === 'webllm_phi35_vision')).toHaveLength(1);
  });

  it('preserves existing disabledPlugins entries', () => {
    localStorage.setItem('rastrum.disabledPlugins', JSON.stringify(['claude_haiku']));
    localStorage.setItem('rastrum.prefs.usePhiVision', 'false');
    runStorageMigration();
    const list = JSON.parse(localStorage.getItem('rastrum.disabledPlugins') ?? '[]');
    expect(list).toContain('claude_haiku');
    expect(list).toContain('webllm_phi35_vision');
  });
});
