import { describe, it, expect, beforeEach } from 'vitest';
import {
  cameraTrapMegadetectorIdentifier,
  CAMERA_TRAP_PLUGIN_ID,
} from './camera-trap-megadetector';
import { registry } from './registry';
import { bootstrapIdentifiers } from './index';
import {
  getMegadetectorWeightsBaseUrl,
} from './megadetector-cache';

beforeEach(() => {
  const env = import.meta.env as unknown as Record<string, unknown>;
  delete env.PUBLIC_MEGADETECTOR_WEIGHTS_URL;
});

describe('camera-trap-megadetector plugin (on-device)', () => {
  it('exposes a stable plugin id', () => {
    expect(CAMERA_TRAP_PLUGIN_ID).toBe('camera_trap_megadetector');
    expect(cameraTrapMegadetectorIdentifier.id).toBe(CAMERA_TRAP_PLUGIN_ID);
  });

  it('declares photo media + on-device runtime', () => {
    const cap = cameraTrapMegadetectorIdentifier.capabilities;
    expect(cap.media).toContain('photo');
    expect(cap.runtime).toBe('client');
    expect(cap.license).toBe('free');
    // Ceiling is intentionally low — detector, not classifier.
    expect(cap.confidence_ceiling).toBeLessThanOrEqual(0.5);
  });

  it('is registered into the singleton via bootstrapIdentifiers()', () => {
    bootstrapIdentifiers();
    const got = registry.get(CAMERA_TRAP_PLUGIN_ID);
    expect(got).toBeDefined();
    expect(got?.id).toBe(CAMERA_TRAP_PLUGIN_ID);
  });

  it('reports model_not_bundled when env var is unset', async () => {
    expect(getMegadetectorWeightsBaseUrl()).toBeNull();
    const av = await cameraTrapMegadetectorIdentifier.isAvailable();
    expect(av.ready).toBe(false);
    if (!av.ready) {
      expect(av.reason).toBe('model_not_bundled');
      expect(av.message).toMatch(/PUBLIC_MEGADETECTOR_WEIGHTS_URL/);
    }
  });

  it('reports needs_download when env set but cache is empty', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_WEIGHTS_URL = 'https://example.com/models';
    // Cache API isn't available in the Node test env, so getMegadetectorCacheStatus
    // returns modelCached=false. The plugin should now report needs_download
    // (not model_not_bundled).
    const av = await cameraTrapMegadetectorIdentifier.isAvailable();
    expect(av.ready).toBe(false);
    if (!av.ready) {
      expect(av.reason).toBe('needs_download');
    }
  });

  it('strips trailing slash in getMegadetectorWeightsBaseUrl', () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_WEIGHTS_URL = 'https://example.com/models/';
    expect(getMegadetectorWeightsBaseUrl()).toBe('https://example.com/models');
  });

  it('throws when identify is called without a cached model', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_WEIGHTS_URL = 'https://example.com/models';
    await expect(
      cameraTrapMegadetectorIdentifier.identify({
        media: { kind: 'url', url: 'https://example.com/x.jpg' },
        mediaKind: 'photo',
      }),
    ).rejects.toThrow(/not cached|MegaDetector|onnxruntime/i);
  });

  it('rejects non-photo media', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_WEIGHTS_URL = 'https://example.com/models';
    await expect(
      cameraTrapMegadetectorIdentifier.identify({
        media: { kind: 'url', url: 'https://example.com/x.wav' },
        mediaKind: 'audio',
      }),
    ).rejects.toThrow(/mediaKind=photo/);
  });

  it('is found by registry.findFor for photo media', () => {
    bootstrapIdentifiers();
    const matches = registry.findFor({ media: 'photo' }).map(p => p.id);
    expect(matches).toContain(CAMERA_TRAP_PLUGIN_ID);
  });
});
