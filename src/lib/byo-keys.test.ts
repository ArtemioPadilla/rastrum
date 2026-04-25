import { describe, it, expect, beforeEach } from 'vitest';

// Node 22's experimental localStorage shadows happy-dom's and is missing
// most of the Storage API. Install our own Map-backed shim before the
// module-under-test imports, so getKey/setKey/etc. exercise a real Storage.
const _store = new Map<string, string>();
const shim: Storage = {
  get length() { return _store.size; },
  clear() { _store.clear(); },
  getItem(k) { return _store.get(k) ?? null; },
  key(i) { return Array.from(_store.keys())[i] ?? null; },
  removeItem(k) { _store.delete(k); },
  setItem(k, v) { _store.set(k, String(v)); },
};
Object.defineProperty(globalThis, 'localStorage', { configurable: true, value: shim });

import {
  getKey, setKey, clearKey, clearAllKeys,
  getAllKeysForPlugin, hasKeysForPlugin,
} from './byo-keys';

beforeEach(() => {
  _store.clear();
});

describe('byo-keys', () => {
  it('round-trips a single key', () => {
    setKey('claude_haiku', 'anthropic', 'sk-ant-test');
    expect(getKey('claude_haiku', 'anthropic')).toBe('sk-ant-test');
  });

  it('returns undefined for unset keys', () => {
    expect(getKey('plantnet', 'plantnet')).toBeUndefined();
  });

  it('isolates keys across plugins', () => {
    setKey('claude_haiku', 'anthropic', 'sk-ant-A');
    setKey('plantnet',     'plantnet',  '2b10-B');
    expect(getKey('claude_haiku', 'anthropic')).toBe('sk-ant-A');
    expect(getKey('plantnet',     'plantnet')).toBe('2b10-B');
    expect(getKey('claude_haiku', 'plantnet')).toBeUndefined();
  });

  it('treats whitespace as empty', () => {
    setKey('claude_haiku', 'anthropic', '   ');
    expect(getKey('claude_haiku', 'anthropic')).toBeUndefined();
  });

  it('clearKey removes a single entry without touching others', () => {
    setKey('claude_haiku', 'anthropic', 'sk-ant-A');
    setKey('plantnet',     'plantnet',  '2b10-B');
    clearKey('claude_haiku', 'anthropic');
    expect(getKey('claude_haiku', 'anthropic')).toBeUndefined();
    expect(getKey('plantnet',     'plantnet')).toBe('2b10-B');
  });

  it('getAllKeysForPlugin returns only that plugin\'s keys', () => {
    setKey('plantnet', 'plantnet', '2b10-X');
    setKey('plantnet', 'username', 'optional-X');
    setKey('claude_haiku', 'anthropic', 'sk-ant-Y');
    const pn = getAllKeysForPlugin('plantnet');
    expect(pn).toEqual({ plantnet: '2b10-X', username: 'optional-X' });
    expect(getAllKeysForPlugin('claude_haiku')).toEqual({ anthropic: 'sk-ant-Y' });
  });

  it('hasKeysForPlugin reflects state', () => {
    expect(hasKeysForPlugin('claude_haiku')).toBe(false);
    setKey('claude_haiku', 'anthropic', 'sk-ant-test');
    expect(hasKeysForPlugin('claude_haiku')).toBe(true);
    clearKey('claude_haiku', 'anthropic');
    expect(hasKeysForPlugin('claude_haiku')).toBe(false);
  });

  it('migrates legacy rastrum.byoAnthropicKey on first read', () => {
    localStorage.setItem('rastrum.byoAnthropicKey', 'legacy-sk-ant-old');
    expect(getKey('claude_haiku', 'anthropic')).toBe('legacy-sk-ant-old');
    // legacy slot is wiped after migration
    expect(localStorage.getItem('rastrum.byoAnthropicKey')).toBeNull();
    // re-reading still returns the migrated value
    expect(getKey('claude_haiku', 'anthropic')).toBe('legacy-sk-ant-old');
  });

  it('legacy migration does not overwrite a newer value', () => {
    setKey('claude_haiku', 'anthropic', 'new-sk-ant');
    localStorage.setItem('rastrum.byoAnthropicKey', 'legacy-old');
    expect(getKey('claude_haiku', 'anthropic')).toBe('new-sk-ant');
  });

  it('clearAllKeys wipes everything', () => {
    setKey('claude_haiku', 'anthropic', 'A');
    setKey('plantnet',     'plantnet',  'B');
    clearAllKeys();
    expect(getKey('claude_haiku', 'anthropic')).toBeUndefined();
    expect(getKey('plantnet',     'plantnet')).toBeUndefined();
    expect(localStorage.getItem('rastrum.byoKeys')).toBeNull();
  });
});
