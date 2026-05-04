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

import { mountVolumeControl } from './volume-control';
import { __resetForTests } from './registry';

describe('mountVolumeControl', () => {
  beforeEach(() => {
    __resetForTests();
    _store.clear();
    document.body.innerHTML = '';
  });

  it('mounts an inline slider for size md/lg', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'md');
    const range = host.querySelector('input[type="range"]');
    expect(range).not.toBeNull();
    expect(host.querySelector('button[data-volume-toggle]')).toBeNull();
  });

  it('mounts an icon button (popover trigger) for size sm', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'sm');
    const btn = host.querySelector('button[data-volume-toggle]');
    expect(btn).not.toBeNull();
    const range = host.querySelector('input[type="range"]');
    expect(range).toBeNull();
  });

  it('writes slider changes through to setStoredVolume', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'md');
    const range = host.querySelector('input[type="range"]') as HTMLInputElement;
    range.value = '0.25';
    range.dispatchEvent(new Event('input'));
    expect(_store.get('rastrum.audio.volume')).toBe('0.25');
  });

  it('initializes slider from stored volume', () => {
    _store.set('rastrum.audio.volume', '0.6');
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'lg');
    const range = host.querySelector('input[type="range"]') as HTMLInputElement;
    expect(range.value).toBe('0.6');
  });

  it('opens popover with slider when sm icon clicked', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'sm');
    const btn = host.querySelector('button[data-volume-toggle]') as HTMLButtonElement;
    btn.click();
    const range = host.querySelector('input[type="range"]');
    expect(range).not.toBeNull();
  });

  it('is a no-op for size xs', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'xs');
    expect(host.children.length).toBe(0);
  });
});
