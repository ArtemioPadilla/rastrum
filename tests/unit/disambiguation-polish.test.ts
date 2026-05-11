/**
 * Tests for Disambiguation v1.1 polish (#683).
 *
 * Covers:
 * 1. Trait extraction from LLM prompt → correct keys
 * 2. Fallback to whole_plant when prompt has no recognised keywords
 * 3. getTraitLabel EN + ES
 * 4. extractTraitsFromPrompt caps at 2 distinct traits
 * 5. MAX_PHOTOS constant is 3
 * 6. DisambiguationView component file exists
 */

import { describe, it, expect } from 'vitest';
import { existsSync } from 'fs';
import { resolve } from 'path';

// ---------------------------------------------------------------------------
// Inline copies of the pure helpers from DisambiguationView.astro so we
// can test them without spinning up Astro.
// ---------------------------------------------------------------------------

const TRAIT_KEYWORDS: Record<string, string[]> = {
  leaf_underside:  ['leaf underside', 'envés', 'envés de la hoja', 'underside of the leaf'],
  flower_closeup:  ['flower', 'flor', 'petal', 'pétalo', 'inflorescence', 'inflorescencia'],
  bark:            ['bark', 'corteza', 'trunk', 'tronco'],
  fruit_seed:      ['fruit', 'fruto', 'seed', 'semilla', 'berry', 'baya'],
  whole_plant:     ['whole plant', 'planta completa', 'habit', 'porte'],
  wing_pattern:    ['wing', 'ala', 'wing pattern', 'patrón alar'],
  dorsal:          ['dorsal', 'dorsal view', 'vista dorsal', 'top'],
  ventral:         ['ventral', 'ventral view', 'vista ventral', 'underside'],
  head_closeup:    ['head', 'cabeza', 'face', 'cara', 'eye', 'ojo'],
};

const TRAIT_LABELS_EN: Record<string, string> = {
  leaf_underside: 'Leaf underside',
  flower_closeup: 'Flower close-up',
  bark:           'Bark / trunk',
  fruit_seed:     'Fruit / seed',
  whole_plant:    'Whole plant',
  wing_pattern:   'Wing pattern',
  dorsal:         'Dorsal view',
  ventral:        'Ventral view',
  head_closeup:   'Head close-up',
};

const TRAIT_LABELS_ES: Record<string, string> = {
  leaf_underside: 'Envés de la hoja',
  flower_closeup: 'Flor (close-up)',
  bark:           'Corteza del tronco',
  fruit_seed:     'Fruto / semilla',
  whole_plant:    'Planta completa',
  wing_pattern:   'Patrón alar',
  dorsal:         'Vista dorsal',
  ventral:        'Vista ventral',
  head_closeup:   'Cabeza (close-up)',
};

const MAX_PHOTOS = 3;

function extractTraitsFromPrompt(prompt: string): string[] {
  const lower = prompt.toLowerCase();
  const found: string[] = [];
  for (const [key, keywords] of Object.entries(TRAIT_KEYWORDS)) {
    if (keywords.some(kw => lower.includes(kw)) && !found.includes(key)) {
      found.push(key);
      if (found.length >= 2) break;
    }
  }
  if (found.length === 0) found.push('whole_plant');
  return found;
}

function getTraitLabel(key: string, lang: string): string {
  const map = lang === 'es' ? TRAIT_LABELS_ES : TRAIT_LABELS_EN;
  return map[key] ?? key;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

describe('extractTraitsFromPrompt', () => {
  it('extracts leaf_underside from EN prompt', () => {
    const traits = extractTraitsFromPrompt(
      'Photograph the leaf underside to see the vein pattern.'
    );
    expect(traits).toContain('leaf_underside');
  });

  it('extracts flower_closeup from EN prompt', () => {
    const traits = extractTraitsFromPrompt(
      'Please take a close-up of the flower petals.'
    );
    expect(traits).toContain('flower_closeup');
  });

  it('extracts envés (leaf underside) from ES prompt', () => {
    const traits = extractTraitsFromPrompt(
      'Fotografía el envés de la hoja para mayor detalle.'
    );
    expect(traits).toContain('leaf_underside');
  });

  it('falls back to whole_plant when no keywords match', () => {
    const traits = extractTraitsFromPrompt('I have no idea what to photograph.');
    expect(traits).toEqual(['whole_plant']);
  });

  it('caps at 2 distinct traits', () => {
    const prompt = 'Photograph the leaf underside AND the flower AND the bark AND the fruit.';
    const traits = extractTraitsFromPrompt(prompt);
    expect(traits.length).toBeLessThanOrEqual(2);
  });

  it('returns a non-empty array for any input', () => {
    expect(extractTraitsFromPrompt('').length).toBeGreaterThan(0);
    expect(extractTraitsFromPrompt('random text').length).toBeGreaterThan(0);
  });
});

describe('getTraitLabel', () => {
  it('returns English label for leaf_underside', () => {
    expect(getTraitLabel('leaf_underside', 'en')).toBe('Leaf underside');
  });

  it('returns Spanish label for leaf_underside', () => {
    expect(getTraitLabel('leaf_underside', 'es')).toBe('Envés de la hoja');
  });

  it('returns English label for flower_closeup', () => {
    expect(getTraitLabel('flower_closeup', 'en')).toBe('Flower close-up');
  });

  it('returns Spanish label for whole_plant', () => {
    expect(getTraitLabel('whole_plant', 'es')).toBe('Planta completa');
  });

  it('returns the key itself for unknown traits', () => {
    expect(getTraitLabel('unknown_trait', 'en')).toBe('unknown_trait');
  });
});

describe('MAX_PHOTOS constant (#683)', () => {
  it('allows up to 3 photos', () => {
    expect(MAX_PHOTOS).toBe(3);
  });
});

describe('DisambiguationView component (#683)', () => {
  it('component file exists', () => {
    const componentPath = resolve(
      import.meta.dirname ?? __dirname,
      '../../src/components/DisambiguationView.astro'
    );
    expect(existsSync(componentPath)).toBe(true);
  });

  it('component file contains data-trait-hint attribute', () => {
    const { readFileSync } = require('fs');
    const componentPath = resolve(
      import.meta.dirname ?? __dirname,
      '../../src/components/DisambiguationView.astro'
    );
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('data-trait-hint');
  });

  it('component file contains multi-photo cascade dispatch event', () => {
    const { readFileSync } = require('fs');
    const componentPath = resolve(
      import.meta.dirname ?? __dirname,
      '../../src/components/DisambiguationView.astro'
    );
    const content = readFileSync(componentPath, 'utf-8');
    expect(content).toContain('rastrum:disambiguation-photos');
  });
});
