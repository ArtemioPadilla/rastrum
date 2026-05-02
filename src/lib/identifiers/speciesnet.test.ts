import { describe, it, expect, beforeEach } from 'vitest';
import {
  speciesnetIdentifier,
  SPECIESNET_PLUGIN_ID,
} from './speciesnet';
import { registry } from './registry';
import { bootstrapIdentifiers } from './index';
import { getSpeciesNetWeightsUrl } from './speciesnet-cache';
import {
  SPECIESNET_LABELS,
  lookupSpeciesNetLabel,
} from './speciesnet-labels';
import type { SpeciesNetLabel } from './speciesnet-labels';

beforeEach(() => {
  const env = import.meta.env as unknown as Record<string, unknown>;
  delete env.PUBLIC_SPECIESNET_WEIGHTS_URL;
});

describe('speciesnet plugin (on-device)', () => {
  it('exposes a stable plugin id', () => {
    expect(SPECIESNET_PLUGIN_ID).toBe('speciesnet_distilled');
    expect(speciesnetIdentifier.id).toBe(SPECIESNET_PLUGIN_ID);
  });

  it('has the correct name and description', () => {
    expect(speciesnetIdentifier.name).toBe('SpeciesNet (distilled)');
    expect(speciesnetIdentifier.description).toMatch(/on-device animal species classifier/i);
  });

  it('declares photo media + Animalia taxa + client runtime', () => {
    const cap = speciesnetIdentifier.capabilities;
    expect(cap.media).toContain('photo');
    expect(cap.taxa).toContain('Animalia');
    expect(cap.runtime).toBe('client');
    expect(cap.license).toBe('free');
    expect(cap.confidence_ceiling).toBe(0.85);
    expect(cap.cost_per_id_usd).toBe(0);
  });

  it('is registered into the singleton via bootstrapIdentifiers()', () => {
    bootstrapIdentifiers();
    const got = registry.get(SPECIESNET_PLUGIN_ID);
    expect(got).toBeDefined();
    expect(got?.id).toBe(SPECIESNET_PLUGIN_ID);
  });

  it('reports model_not_bundled when env var is unset', async () => {
    expect(getSpeciesNetWeightsUrl()).toBeNull();
    const av = await speciesnetIdentifier.isAvailable();
    expect(av.ready).toBe(false);
    if (!av.ready) {
      expect(av.reason).toBe('model_not_bundled');
      expect(av.message).toMatch(/PUBLIC_SPECIESNET_WEIGHTS_URL/);
    }
  });

  it('reports needs_download when env set but cache is empty', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_SPECIESNET_WEIGHTS_URL = 'https://example.com/models';
    const av = await speciesnetIdentifier.isAvailable();
    expect(av.ready).toBe(false);
    if (!av.ready) {
      expect(av.reason).toBe('needs_download');
    }
  });

  it('strips trailing slash in getSpeciesNetWeightsUrl', () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_SPECIESNET_WEIGHTS_URL = 'https://example.com/models/';
    expect(getSpeciesNetWeightsUrl()).toBe('https://example.com/models');
  });

  it('throws when identify is called without a cached model', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_SPECIESNET_WEIGHTS_URL = 'https://example.com/models';
    await expect(
      speciesnetIdentifier.identify({
        media: { kind: 'url', url: 'https://example.com/x.jpg' },
        mediaKind: 'photo',
      }),
    ).rejects.toThrow(/not cached|SpeciesNet|onnxruntime/i);
  });

  it('rejects non-photo media', async () => {
    (import.meta.env as unknown as Record<string, string>).PUBLIC_SPECIESNET_WEIGHTS_URL = 'https://example.com/models';
    await expect(
      speciesnetIdentifier.identify({
        media: { kind: 'url', url: 'https://example.com/x.wav' },
        mediaKind: 'audio',
      }),
    ).rejects.toThrow(/mediaKind=photo/);
  });

  it('is found by registry.findFor for photo + Animalia', () => {
    bootstrapIdentifiers();
    const matches = registry.findFor({ media: 'photo', taxa: 'Animalia' }).map(p => p.id);
    expect(matches).toContain(SPECIESNET_PLUGIN_ID);
  });
});

describe('speciesnet-labels', () => {
  it('contains 20 placeholder species', () => {
    expect(SPECIESNET_LABELS.length).toBe(20);
  });

  it('has contiguous indices starting from 0', () => {
    const indices = SPECIESNET_LABELS.map(l => l.index);
    for (let i = 0; i < indices.length; i++) {
      expect(indices[i]).toBe(i);
    }
  });

  it('every label has kingdom Animalia', () => {
    for (const label of SPECIESNET_LABELS) {
      expect(label.kingdom).toBe('Animalia');
    }
  });

  it('every label has non-empty scientific_name, common_name_en, common_name_es, family', () => {
    for (const label of SPECIESNET_LABELS) {
      expect(label.scientific_name.length).toBeGreaterThan(0);
      expect(label.common_name_en.length).toBeGreaterThan(0);
      expect(label.common_name_es.length).toBeGreaterThan(0);
      expect(label.family.length).toBeGreaterThan(0);
    }
  });

  it('lookupSpeciesNetLabel returns the correct entry by index', () => {
    const label = lookupSpeciesNetLabel(5);
    expect(label).toBeDefined();
    expect((label as SpeciesNetLabel).scientific_name).toBe('Panthera onca');
    expect((label as SpeciesNetLabel).common_name_en).toBe('Jaguar');
    expect((label as SpeciesNetLabel).common_name_es).toBe('Jaguar');
  });

  it('lookupSpeciesNetLabel returns undefined for out-of-range index', () => {
    expect(lookupSpeciesNetLabel(999)).toBeUndefined();
    expect(lookupSpeciesNetLabel(-1)).toBeUndefined();
  });

  it('includes expected species', () => {
    const names = SPECIESNET_LABELS.map(l => l.scientific_name);
    expect(names).toContain('Odocoileus virginianus');
    expect(names).toContain('Panthera onca');
    expect(names).toContain('Tapirus bairdii');
    expect(names).toContain('Crax rubra');
    expect(names).toContain('Penelope purpurascens');
  });
});
