import { describe, it, expect, beforeEach } from 'vitest';
import { runCascade } from './cascade';
import { registry } from './registry';
import { FilteredFrameError } from './errors';
import type { Identifier } from './types';

function fakePlugin(opts: {
  id: string;
  identifyImpl: NonNullable<Identifier['identify']>;
  ready?: boolean;
}): Identifier {
  return {
    id: opts.id,
    name: opts.id,
    description: 'test',
    capabilities: { media: ['photo'], taxa: ['*'], runtime: 'client', license: 'free' },
    isAvailable: async () => (opts.ready === false
      ? { ready: false as const, reason: 'disabled' as const }
      : { ready: true as const }),
    identify: opts.identifyImpl,
  };
}

beforeEach(() => {
  (registry as unknown as { _resetForTests: () => void })._resetForTests();
});

describe('runCascade — FilteredFrameError short-circuit', () => {
  it('stops calling further plugins after FilteredFrameError', async () => {
    let secondCalled = false;
    const filterer = fakePlugin({
      id: 'test_filter',
      identifyImpl: async () => {
        throw new FilteredFrameError({
          source: 'test_filter',
          filtered_label: 'human',
          raw: { reason: 'human in frame' },
        });
      },
    });
    const speciesId = fakePlugin({
      id: 'test_species',
      identifyImpl: async () => {
        secondCalled = true;
        return {
          scientific_name: 'Lynx rufus',
          common_name_en: 'Bobcat',
          common_name_es: null,
          family: 'Felidae',
          kingdom: 'Animalia' as const,
          confidence: 0.9,
          source: 'test_species',
          raw: {},
        };
      },
    });
    registry.register(filterer);
    registry.register(speciesId);

    const result = await runCascade(
      { media: { kind: 'url', url: 'https://example.com/x.jpg' }, mediaKind: 'photo' },
      { media: 'photo', preferred: ['test_filter'] },
    );

    expect(secondCalled).toBe(false);
    expect(result.best).toBeNull();
    expect(result.filtered).toBeDefined();
    expect(result.filtered?.label).toBe('human');
    expect(result.filtered?.source).toBe('test_filter');
  });

  it('keeps calling further plugins on regular errors', async () => {
    let secondCalled = false;
    const failer = fakePlugin({
      id: 'test_failer',
      identifyImpl: async () => { throw new Error('network error'); },
    });
    const speciesId = fakePlugin({
      id: 'test_species_2',
      identifyImpl: async () => {
        secondCalled = true;
        return {
          scientific_name: 'Lynx rufus',
          common_name_en: 'Bobcat',
          common_name_es: null,
          family: 'Felidae',
          kingdom: 'Animalia' as const,
          confidence: 0.9,
          source: 'test_species_2',
          raw: {},
        };
      },
    });
    registry.register(failer);
    registry.register(speciesId);

    const result = await runCascade(
      { media: { kind: 'url', url: 'https://example.com/x.jpg' }, mediaKind: 'photo' },
      { media: 'photo', preferred: ['test_failer'] },
    );
    expect(secondCalled).toBe(true);
    expect(result.best?.scientific_name).toBe('Lynx rufus');
    expect(result.filtered).toBeUndefined();
  });

  it('forwards animal_bbox from a thrown error to the next plugin as mediaCrop', async () => {
    let receivedCrop: unknown = 'unset';
    const detector = fakePlugin({
      id: 'test_detector',
      identifyImpl: async () => {
        const err = new Error('animal detected, no species') as Error & { animal_bbox?: number[] };
        err.animal_bbox = [100, 200, 400, 600];
        throw err;
      },
    });
    const classifier = fakePlugin({
      id: 'test_classifier',
      identifyImpl: async (input) => {
        receivedCrop = input.mediaCrop;
        return {
          scientific_name: 'Lynx rufus',
          common_name_en: 'Bobcat',
          common_name_es: null,
          family: 'Felidae',
          kingdom: 'Animalia' as const,
          confidence: 0.9,
          source: 'test_classifier',
          raw: {},
        };
      },
    });
    registry.register(detector);
    registry.register(classifier);

    const result = await runCascade(
      { media: { kind: 'url', url: 'https://example.com/x.jpg' }, mediaKind: 'photo' },
      { media: 'photo', preferred: ['test_detector'] },
    );
    expect(result.best?.scientific_name).toBe('Lynx rufus');
    expect(receivedCrop).toEqual({ bbox: [100, 200, 400, 600], source: 'test_detector' });
  });
});
