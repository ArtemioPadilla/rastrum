import { describe, it, expect } from 'vitest';
import { deriveHintFromConversation, kingdomToHint } from '../../src/lib/chat-hint';

describe('chat-hint (#593)', () => {
  describe('kingdomToHint', () => {
    it.each([
      ['Plantae',  'plant'],
      ['Fungi',    'fungi'],
      ['Animalia', 'animal'],
      ['',         'unknown'],
      [null,       'unknown'],
      [undefined,  'unknown'],
    ])('kingdomToHint(%j) === %s', (k, expected) => {
      expect(kingdomToHint(k as string | null)).toBe(expected);
    });
  });

  describe('deriveHintFromConversation — current turn', () => {
    it.each([
      ['what plant is this?', 'plant'],
      ['¿qué planta es?', 'plant'],
      ['identify this tree', 'plant'],
      ['this mushroom', 'fungi'],
      ['un hongo extraño', 'fungi'],
      ['this bird', 'animal'],
      ['un pájaro azul', 'animal'],
      ['what is this insect?', 'animal'],
      ['murciélago en el techo', 'animal'],
      ['hello there', 'unknown'],
    ])('"%s" → %s', (text, expected) => {
      expect(deriveHintFromConversation(text, [])).toBe(expected);
    });
  });

  describe('deriveHintFromConversation — kingdom propagation', () => {
    it('propagates kingdom from prior winning id', () => {
      const hist = [
        { role: 'user' as const, content: 'identify' },
        {
          role: 'assistant' as const,
          content: 'Quetzal',
          cascadeResult: { best: { kingdom: 'Animalia' } },
        },
      ];
      expect(deriveHintFromConversation('and this one?', hist)).toBe('animal');
    });

    it('current-turn keywords override history kingdom', () => {
      const hist = [
        {
          role: 'assistant' as const,
          content: 'Quetzal',
          cascadeResult: { best: { kingdom: 'Animalia' } },
        },
      ];
      expect(deriveHintFromConversation('what plant is this?', hist)).toBe('plant');
    });

    it('falls back to recent history keywords when no kingdom', () => {
      const hist = [
        { role: 'user' as const, content: 'this is a plant question' },
        { role: 'assistant' as const, content: 'sure' },
      ];
      expect(deriveHintFromConversation('and this?', hist)).toBe('plant');
    });
  });
});
