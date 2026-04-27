import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';

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

beforeEach(() => {
  _store.clear();
  // Reset module cache so each test gets fresh import.meta.env semantics.
  vi.resetModules();
});

afterEach(() => {
  delete (globalThis as unknown as { window?: { __RASTRUM_ANTHROPIC_KEY__?: string } }).window;
});

describe('resolveAnthropicKey', () => {
  it('returns runtime injection first', async () => {
    (globalThis as unknown as { window: { __RASTRUM_ANTHROPIC_KEY__?: string } }).window =
      { __RASTRUM_ANTHROPIC_KEY__: 'sk-ant-runtime' };
    const { resolveAnthropicKey } = await import('./anthropic-key');
    const r = await resolveAnthropicKey();
    expect(r.key).toBe('sk-ant-runtime');
    expect(r.source).toBe('runtime');
  });

  it('falls through to BYO when no runtime/env key is set', async () => {
    const { setKey } = await import('./byo-keys');
    setKey('claude_haiku', 'anthropic', 'sk-ant-byo');
    const { resolveAnthropicKey } = await import('./anthropic-key');
    const r = await resolveAnthropicKey();
    expect(r.key).toBe('sk-ant-byo');
    expect(r.source).toBe('byo');
  });

  it('returns none when nothing is set', async () => {
    const { resolveAnthropicKey } = await import('./anthropic-key');
    const r = await resolveAnthropicKey();
    expect(r.key).toBe('');
    expect(r.source).toBe('none');
  });

  it('hasAnthropicKey returns false when nothing is set', async () => {
    const { hasAnthropicKey } = await import('./anthropic-key');
    expect(await hasAnthropicKey()).toBe(false);
  });

  it('hasAnthropicKey returns true with runtime injection', async () => {
    (globalThis as unknown as { window: { __RASTRUM_ANTHROPIC_KEY__?: string } }).window =
      { __RASTRUM_ANTHROPIC_KEY__: 'sk-ant-x' };
    const { hasAnthropicKey } = await import('./anthropic-key');
    expect(await hasAnthropicKey()).toBe(true);
  });
});
