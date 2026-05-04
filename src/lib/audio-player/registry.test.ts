import { describe, it, expect, beforeEach } from 'vitest';

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
  registerHandle,
  unregisterHandle,
  pauseAllExcept,
  getStoredVolume,
  setStoredVolume,
  __resetForTests,
} from './registry';
import type { AudioPlayerHandle } from './types';

interface TrackedHandle extends AudioPlayerHandle {
  pauseCalls: number;
  volumeCalls: number[];
}

function makeHandle(): TrackedHandle {
  const h: TrackedHandle = {
    pauseCalls: 0,
    volumeCalls: [],
    pause() { this.pauseCalls += 1; },
    setVolume(v) { this.volumeCalls.push(v); },
    destroy() {},
  };
  return h;
}

describe('registry', () => {
  beforeEach(() => {
    __resetForTests();
    _store.clear();
  });

  it('pauses all handles except the one passed to pauseAllExcept', () => {
    const a = makeHandle();
    const b = makeHandle();
    const c = makeHandle();
    registerHandle(a);
    registerHandle(b);
    registerHandle(c);
    pauseAllExcept(b);
    expect(a.pauseCalls).toBe(1);
    expect(b.pauseCalls).toBe(0);
    expect(c.pauseCalls).toBe(1);
  });

  it('does not pause handles that have been unregistered', () => {
    const a = makeHandle();
    const b = makeHandle();
    registerHandle(a);
    registerHandle(b);
    unregisterHandle(a);
    pauseAllExcept(b);
    expect(a.pauseCalls).toBe(0);
  });

  it('persists volume to localStorage and broadcasts to all handles', () => {
    const a = makeHandle();
    const b = makeHandle();
    registerHandle(a);
    registerHandle(b);
    setStoredVolume(0.42);
    expect(_store.get('rastrum.audio.volume')).toBe('0.42');
    expect(a.volumeCalls).toEqual([0.42]);
    expect(b.volumeCalls).toEqual([0.42]);
  });

  it('returns 1.0 when no stored volume', () => {
    expect(getStoredVolume()).toBe(1);
  });

  it('returns the stored volume when present', () => {
    _store.set('rastrum.audio.volume', '0.3');
    expect(getStoredVolume()).toBe(0.3);
  });

  it('clamps stored volume into [0, 1]', () => {
    setStoredVolume(2);
    expect(getStoredVolume()).toBe(1);
    setStoredVolume(-0.5);
    expect(getStoredVolume()).toBe(0);
  });
});
