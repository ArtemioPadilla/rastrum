import { describe, it, expect, beforeEach, vi } from 'vitest';

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

import { mountAudioPlayer } from './audio-player';
import { __resetForTests } from './audio-player/registry';

vi.mock('wavesurfer.js', () => {
  class FakeWS {
    private listeners: Record<string, ((arg?: unknown) => void)[]> = {};
    static create(_opts: unknown) { return new FakeWS(); }
    on(e: string, cb: (arg?: unknown) => void) { (this.listeners[e] ||= []).push(cb); }
    play() { return Promise.resolve(); }
    pause() {}
    seekTo(_n: number) {}
    setVolume(_v: number) {}
    getCurrentTime() { return 0; }
    getDuration() { return 10; }
    isPlaying() { return false; }
    getMediaElement() { return null; }
    destroy() {}
  }
  return { default: FakeWS };
});
vi.mock('wavesurfer.js/plugins/spectrogram', () => ({
  default: { create: () => ({}) },
}));

describe('mountAudioPlayer', () => {
  beforeEach(() => {
    __resetForTests();
    _store.clear();
    document.body.innerHTML = '';
  });

  it('returns a cleanup function for xs', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const cleanup = mountAudioPlayer(c, 'data:audio/wav;base64,', { size: 'xs', lang: 'en' });
    expect(typeof cleanup).toBe('function');
    expect(c.querySelector('canvas')).not.toBeNull();
    expect(c.querySelector('button[aria-label]')).not.toBeNull();
    cleanup();
    expect(c.children.length).toBe(0);
  });

  it('builds an md shell with spectrogram + volume slider', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const cleanup = mountAudioPlayer(c, 'http://example/a.mp3', { size: 'md', lang: 'en', obsId: 'x' });
    await new Promise(r => setTimeout(r, 0));
    expect(c.querySelector('input[type="range"]')).not.toBeNull();
    cleanup();
  });

  it('builds an sm shell with popover volume (no inline slider)', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const cleanup = mountAudioPlayer(c, 'http://example/a.mp3', { size: 'sm', lang: 'en' });
    await new Promise(r => setTimeout(r, 0));
    expect(c.querySelector('input[type="range"]')).toBeNull();
    expect(c.querySelector('button[data-volume-toggle]')).not.toBeNull();
    cleanup();
  });

  it('cleanup is idempotent', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const cleanup = mountAudioPlayer(c, 'data:audio/wav;base64,', { size: 'xs', lang: 'en' });
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });
});
