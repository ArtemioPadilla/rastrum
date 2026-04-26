import { describe, it, expect, beforeEach } from 'vitest';
import {
  cameraTrapMegadetectorIdentifier,
  CAMERA_TRAP_PLUGIN_ID,
  getCameraTrapEndpoint,
} from './camera-trap-megadetector';
import { registry } from './registry';
import { bootstrapIdentifiers } from './index';

beforeEach(() => {
  // Reset env between tests — the env var controls isAvailable behaviour.
  const env = import.meta.env as unknown as Record<string, unknown>;
  delete env.PUBLIC_MEGADETECTOR_ENDPOINT;
});

describe('camera-trap-megadetector plugin', () => {
  it('exposes a stable plugin id', () => {
    expect(CAMERA_TRAP_PLUGIN_ID).toBe('camera_trap_megadetector');
    expect(cameraTrapMegadetectorIdentifier.id).toBe(CAMERA_TRAP_PLUGIN_ID);
  });

  it('declares photo media + camera-trap-friendly capabilities', () => {
    const cap = cameraTrapMegadetectorIdentifier.capabilities;
    expect(cap.media).toContain('photo');
    expect(cap.runtime).toBe('server');
    expect(cap.taxa).toContain('Animalia');
  });

  it('is registered into the singleton via bootstrapIdentifiers()', () => {
    bootstrapIdentifiers();
    const got = registry.get(CAMERA_TRAP_PLUGIN_ID);
    expect(got).toBeDefined();
    expect(got?.id).toBe(CAMERA_TRAP_PLUGIN_ID);
  });

  it('reports model_not_bundled when endpoint env var is unset', async () => {
    expect(getCameraTrapEndpoint()).toBeNull();
    const av = await cameraTrapMegadetectorIdentifier.isAvailable();
    expect(av.ready).toBe(false);
    if (!av.ready) {
      expect(av.reason).toBe('model_not_bundled');
      expect(av.message).toMatch(/PUBLIC_MEGADETECTOR_ENDPOINT|not implemented/i);
    }
  });

  it('still reports model_not_bundled even when endpoint is set (stub today)', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_ENDPOINT = 'https://example.com/md';
    expect(getCameraTrapEndpoint()).toBe('https://example.com/md');
    const av = await cameraTrapMegadetectorIdentifier.isAvailable();
    expect(av.ready).toBe(false);
    if (!av.ready) {
      expect(av.reason).toBe('model_not_bundled');
    }
  });

  it('strips trailing slash in getCameraTrapEndpoint', () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_ENDPOINT = 'https://example.com/md/';
    expect(getCameraTrapEndpoint()).toBe('https://example.com/md');
  });

  it('throws a clear "not implemented" error when identify is called', async () => {
    await expect(
      cameraTrapMegadetectorIdentifier.identify({
        media: { kind: 'url', url: 'https://example.com/x.jpg' },
        mediaKind: 'photo',
      }),
    ).rejects.toThrow(/stub|not implemented|module 09/i);
  });

  it('is found by registry.findFor for photo media', () => {
    bootstrapIdentifiers();
    const matches = registry.findFor({ media: 'photo' }).map(p => p.id);
    expect(matches).toContain(CAMERA_TRAP_PLUGIN_ID);
  });
});
