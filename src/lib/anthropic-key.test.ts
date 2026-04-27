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

describe('validateAnthropicKey', () => {
  const origFetch = globalThis.fetch;
  afterEach(() => {
    globalThis.fetch = origFetch;
  });

  it('rejects shape mismatches without hitting the network', async () => {
    const spy = vi.fn();
    globalThis.fetch = spy as unknown as typeof fetch;
    const { validateAnthropicKey } = await import('./anthropic-key');
    const r = await validateAnthropicKey('not-a-key');
    expect(r).toEqual({ valid: false, status: 0, reason: 'shape', message: 'Invalid key format' });
    expect(spy).not.toHaveBeenCalled();
  });

  it('returns valid:true on a 200', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 200 })) as unknown as typeof fetch;
    const { validateAnthropicKey } = await import('./anthropic-key');
    const r = await validateAnthropicKey('sk-ant-' + 'a'.repeat(40));
    expect(r).toEqual({ valid: true, status: 200 });
  });

  it('returns reason=auth on 401', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 401 })) as unknown as typeof fetch;
    const { validateAnthropicKey } = await import('./anthropic-key');
    const r = await validateAnthropicKey('sk-ant-' + 'b'.repeat(40));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('auth');
  });

  it('returns reason=network on fetch rejection', async () => {
    globalThis.fetch = vi.fn(async () => { throw new Error('offline'); }) as unknown as typeof fetch;
    const { validateAnthropicKey } = await import('./anthropic-key');
    const r = await validateAnthropicKey('sk-ant-' + 'c'.repeat(40));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('network');
  });

  it('returns reason=other on 500', async () => {
    globalThis.fetch = vi.fn(async () => new Response('{}', { status: 500 })) as unknown as typeof fetch;
    const { validateAnthropicKey } = await import('./anthropic-key');
    const r = await validateAnthropicKey('sk-ant-' + 'd'.repeat(40));
    expect(r.valid).toBe(false);
    if (!r.valid) expect(r.reason).toBe('other');
  });
});
