import { describe, it, expect, beforeEach } from 'vitest';

// Map-backed localStorage shim for Node (vitest runs in Node, not browser)
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

import {
  setKey, getKey, clearKey,
  listConfiguredPluginIds, getKeysSummary, clearAllKeysForPlugin,
} from '../../src/lib/byo-keys';

describe('byo-keys multi-provider helpers', () => {
  beforeEach(() => store.clear());

  it('listConfiguredPluginIds returns unique plugin IDs', () => {
    setKey('claude_haiku', 'anthropic', 'sk-ant-test');
    setKey('plantnet', 'plantnet', '2b10-test');
    expect(listConfiguredPluginIds().sort()).toEqual(['claude_haiku', 'plantnet']);
  });

  it('getKeysSummary returns per-plugin breakdown', () => {
    setKey('claude_haiku', 'anthropic', 'sk-ant-test');
    setKey('plantnet', 'plantnet', '2b10-test');
    const summary = getKeysSummary();
    expect(summary).toHaveLength(2);
    const claude = summary.find(s => s.pluginId === 'claude_haiku');
    expect(claude?.keyCount).toBe(1);
    expect(claude?.keyNames).toEqual(['anthropic']);
  });

  it('clearAllKeysForPlugin removes all keys for a plugin', () => {
    setKey('claude_haiku', 'anthropic', 'sk-ant-test');
    setKey('plantnet', 'plantnet', '2b10-test');
    clearAllKeysForPlugin('claude_haiku');
    expect(getKey('claude_haiku', 'anthropic')).toBeUndefined();
    expect(getKey('plantnet', 'plantnet')).toBe('2b10-test');
  });

  it('listConfiguredPluginIds ignores empty values', () => {
    setKey('claude_haiku', 'anthropic', 'sk-ant-test');
    setKey('claude_haiku', 'anthropic', '');
    expect(listConfiguredPluginIds()).toEqual([]);
  });
});
