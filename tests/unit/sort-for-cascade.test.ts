import { describe, it, expect } from 'vitest';
import { sortForCascade } from '../../src/lib/identifiers/cascade';

const make = (id: string, license: string, ceiling = 1) => ({
  id,
  capabilities: { license, confidence_ceiling: ceiling },
});

describe('sortForCascade (#594)', () => {
  it('sorts free before BYO before paid', () => {
    const sorted = sortForCascade(
      [make('a', 'paid'), make('b', 'free'), make('c', 'byo-key')],
      {},
    );
    expect(sorted.map(s => s.id)).toEqual(['b', 'c', 'a']);
  });

  it('among same license, higher confidence_ceiling wins', () => {
    const sorted = sortForCascade(
      [make('low', 'free', 0.4), make('high', 'free', 1.0)],
      {},
    );
    expect(sorted.map(s => s.id)).toEqual(['high', 'low']);
  });

  it('preferred items go first in declared order', () => {
    const sorted = sortForCascade(
      [make('a', 'free'), make('b', 'free'), make('c', 'free')],
      { preferred: ['c', 'a'] },
    );
    expect(sorted.map(s => s.id)).toEqual(['c', 'a', 'b']);
  });

  it('does not mutate the input array', () => {
    const input = [make('a', 'paid'), make('b', 'free')];
    sortForCascade(input, {});
    expect(input.map(s => s.id)).toEqual(['a', 'b']);
  });
});
