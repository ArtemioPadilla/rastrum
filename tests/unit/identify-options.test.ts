import { describe, it, expect, beforeEach, vi } from 'vitest';

const store = new Map<string, string>();
Object.defineProperty(globalThis, 'localStorage', {
  value: {
    getItem: (k: string) => store.get(k) ?? null,
    setItem: (k: string, v: string) => store.set(k, v),
    removeItem: (k: string) => store.delete(k),
    clear: () => store.clear(),
    get length() { return store.size; },
    key: (i: number) => [...store.keys()][i] ?? null,
  },
  writable: true,
  configurable: true,
});

vi.mock('../../src/lib/byo-keys', () => ({
  getKey: vi.fn(() => null),
}));

vi.mock('../../src/lib/identifiers/onnx-base-cache', () => ({
  getOnnxBaseWeightsBaseUrl: vi.fn(() => null),
  getOnnxBaseCacheStatus: vi.fn(async () => ({ modelCached: false, labelsCached: false })),
}));

import { buildCascadeOptions } from '../../src/lib/identify-options';
import { getKey } from '../../src/lib/byo-keys';
import { getOnnxBaseWeightsBaseUrl } from '../../src/lib/identifiers/onnx-base-cache';
import { setDisabledPlugins } from '../../src/lib/identifier-prefs';

const getKeyMock = getKey as ReturnType<typeof vi.fn>;
const onnxUrlMock = getOnnxBaseWeightsBaseUrl as ReturnType<typeof vi.fn>;

describe('buildCascadeOptions (#583)', () => {
  beforeEach(() => {
    store.clear();
    getKeyMock.mockReset().mockReturnValue(null);
    onnxUrlMock.mockReset().mockReturnValue(null);
  });

  it('excludes Claude when no BYO key is set', async () => {
    const r = await buildCascadeOptions({ mediaKind: 'photo' });
    expect(r.excluded).toContain('claude_haiku');
  });

  it('does NOT exclude Claude when BYO key is set', async () => {
    getKeyMock.mockReturnValueOnce('sk-ant-test');
    const r = await buildCascadeOptions({ mediaKind: 'photo' });
    expect(r.excluded).not.toContain('claude_haiku');
  });

  it('excludes Phi + BirdNET when localAI is opted out', async () => {
    localStorage.setItem('rastrum.localAiOptIn', 'false');
    const r = await buildCascadeOptions({ mediaKind: 'photo' });
    expect(r.excluded).toContain('webllm_phi35_vision');
    expect(r.excluded).toContain('birdnet_lite');
  });

  it('excludes EfficientNet when weights are not cached', async () => {
    onnxUrlMock.mockReturnValueOnce(null);
    const r = await buildCascadeOptions({ mediaKind: 'photo' });
    expect(r.excluded).toContain('onnx_efficientnet_lite0');
  });

  it('honors user-disabled plugin list from identifier-prefs', async () => {
    setDisabledPlugins(['plantnet']);
    const r = await buildCascadeOptions({ mediaKind: 'photo' });
    expect(r.excluded).toContain('plantnet');
  });

  it('prefers MegaDetector for camera-trap evidence type', async () => {
    const r = await buildCascadeOptions({ mediaKind: 'photo', evidenceType: 'camera_trap' });
    expect(r.preferred).toContain('camera_trap_megadetector');
  });

  it('does NOT add MegaDetector preference for non camera-trap', async () => {
    const r = await buildCascadeOptions({ mediaKind: 'photo', evidenceType: 'direct_sighting' });
    expect(r.preferred).not.toContain('camera_trap_megadetector');
  });

  it('audio mediaKind sets Animalia.Aves taxa filter', async () => {
    const r = await buildCascadeOptions({ mediaKind: 'audio' });
    expect(r.taxa).toBe('Animalia.Aves');
  });

  it('photo mediaKind has no taxa filter', async () => {
    const r = await buildCascadeOptions({ mediaKind: 'photo' });
    expect(r.taxa).toBeUndefined();
  });
});
