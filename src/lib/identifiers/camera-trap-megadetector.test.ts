import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  cameraTrapMegadetectorIdentifier,
  CAMERA_TRAP_PLUGIN_ID,
  getCameraTrapEndpoint,
} from './camera-trap-megadetector';
import { registry } from './registry';
import { bootstrapIdentifiers } from './index';

const origFetch = globalThis.fetch;

beforeEach(() => {
  const env = import.meta.env as unknown as Record<string, unknown>;
  delete env.PUBLIC_MEGADETECTOR_ENDPOINT;
});

afterEach(() => {
  globalThis.fetch = origFetch;
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
      expect(av.message).toMatch(/PUBLIC_MEGADETECTOR_ENDPOINT/);
    }
  });

  it('reports ready:true once the endpoint is set', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_ENDPOINT = 'https://example.com/md';
    expect(getCameraTrapEndpoint()).toBe('https://example.com/md');
    const av = await cameraTrapMegadetectorIdentifier.isAvailable();
    expect(av.ready).toBe(true);
  });

  it('strips trailing slash in getCameraTrapEndpoint', () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_ENDPOINT = 'https://example.com/md/';
    expect(getCameraTrapEndpoint()).toBe('https://example.com/md');
  });

  it('throws when identify is called without a configured endpoint', async () => {
    await expect(
      cameraTrapMegadetectorIdentifier.identify({
        media: { kind: 'url', url: 'https://example.com/x.jpg' },
        mediaKind: 'photo',
      }),
    ).rejects.toThrow(/PUBLIC_MEGADETECTOR_ENDPOINT/);
  });

  it('POSTs the image_url and parses a SpeciesNet response into IDResult', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_ENDPOINT = 'https://example.com/md';
    const calls: { url: string; body: unknown }[] = [];
    globalThis.fetch = vi.fn(async (url: string | URL | Request, init?: RequestInit) => {
      calls.push({
        url: String(url),
        body: init?.body ? JSON.parse(String(init.body)) : null,
      });
      return new Response(JSON.stringify({
        filtered_label: null,
        scientific_name: 'Lynx rufus',
        common_name_en: 'Bobcat',
        common_name_es: 'Lince rojo',
        family: 'Felidae',
        kingdom: 'Animalia',
        confidence: 0.87,
      }), { status: 200 });
    }) as unknown as typeof fetch;

    const result = await cameraTrapMegadetectorIdentifier.identify({
      media: { kind: 'url', url: 'https://media.rastrum.org/observations/abc/img.jpg' },
      mediaKind: 'photo',
    });

    expect(calls).toHaveLength(1);
    expect(calls[0].url).toBe('https://example.com/md');
    expect((calls[0].body as { image_url: string }).image_url).toBe(
      'https://media.rastrum.org/observations/abc/img.jpg',
    );
    expect(result.scientific_name).toBe('Lynx rufus');
    expect(result.confidence).toBe(0.87);
    expect(result.kingdom).toBe('Animalia');
    expect(result.source).toBe(CAMERA_TRAP_PLUGIN_ID);
  });

  it('throws with filtered_label attached on empty/human/vehicle frames', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_ENDPOINT = 'https://example.com/md';
    globalThis.fetch = vi.fn(async () => new Response(JSON.stringify({
      filtered_label: 'human',
    }), { status: 200 })) as unknown as typeof fetch;

    try {
      await cameraTrapMegadetectorIdentifier.identify({
        media: { kind: 'url', url: 'https://example.com/img.jpg' },
        mediaKind: 'photo',
      });
      throw new Error('should have thrown');
    } catch (err) {
      const e = err as Error & { filtered_label?: string };
      expect(e.message).toMatch(/filtered as human/);
      expect(e.filtered_label).toBe('human');
    }
  });

  it('throws when the endpoint returns non-200', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_MEGADETECTOR_ENDPOINT = 'https://example.com/md';
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 503 })) as unknown as typeof fetch;
    await expect(
      cameraTrapMegadetectorIdentifier.identify({
        media: { kind: 'url', url: 'https://example.com/img.jpg' },
        mediaKind: 'photo',
      }),
    ).rejects.toThrow(/HTTP 503/);
  });

  it('is found by registry.findFor for photo media', () => {
    bootstrapIdentifiers();
    const matches = registry.findFor({ media: 'photo' }).map(p => p.id);
    expect(matches).toContain(CAMERA_TRAP_PLUGIN_ID);
  });
});
