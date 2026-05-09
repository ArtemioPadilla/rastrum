import { describe, it, expect, beforeEach } from 'vitest';
import { registry } from './registry';
import type { EntitySpec } from './types';

const fakeSpec = (kind: EntitySpec['kind']): EntitySpec => ({
  kind,
  icon: '·',
  label: { en: 'X', es: 'X' },
  async fetchCard() { return null; },
  suggestedTools: [],
});

beforeEach(() => {
  (registry as unknown as { _resetForTests: () => void })._resetForTests();
});

describe('chat-entities registry', () => {
  it('registers and retrieves a spec', () => {
    const spec = fakeSpec('observation');
    registry.register(spec);
    expect(registry.get('observation')).toBe(spec);
  });

  it('throws on duplicate kind registration', () => {
    registry.register(fakeSpec('species'));
    expect(() => registry.register(fakeSpec('species'))).toThrow(/collision/);
  });

  it('list returns every registered spec', () => {
    registry.register(fakeSpec('observation'));
    registry.register(fakeSpec('species'));
    expect(registry.list().map(s => s.kind).sort()).toEqual(['observation', 'species']);
  });

  it('get returns undefined for unregistered kind', () => {
    expect(registry.get('project')).toBeUndefined();
  });
});
