import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import {
  showToast,
  TOAST_CONTAINER_ID,
  _resetToastContainer,
} from './toast';

function mountContainer(lang: 'en' | 'es' = 'en') {
  const c = document.createElement('div');
  c.id = TOAST_CONTAINER_ID;
  c.setAttribute('role', 'status');
  c.setAttribute('aria-live', 'polite');
  c.dataset.lang = lang;
  c.dataset.dismissLabel = lang === 'es' ? 'Descartar' : 'Dismiss';
  document.body.appendChild(c);
  return c;
}

describe('showToast', () => {
  beforeEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
    vi.useRealTimers();
  });

  it('appends a toast into the mounted container', () => {
    const c = mountContainer();
    showToast({ message: 'Saved' });
    expect(c.children.length).toBe(1);
    expect(c.querySelector('span')?.textContent).toBe('Saved');
  });

  it('lazily creates the container if absent (safety net)', () => {
    expect(document.getElementById(TOAST_CONTAINER_ID)).toBeNull();
    showToast({ message: 'No container yet', variant: 'info' });
    const c = document.getElementById(TOAST_CONTAINER_ID);
    expect(c).not.toBeNull();
    expect(c?.children.length).toBe(1);
  });

  it('maps variant → palette class', () => {
    const c = mountContainer();
    showToast({ message: 'ok', variant: 'success' });
    showToast({ message: 'bad', variant: 'error' });
    showToast({ message: 'fyi', variant: 'info' });
    const els = Array.from(c.children) as HTMLElement[];
    expect(els[0].className).toContain('bg-emerald-700');
    expect(els[1].className).toContain('bg-red-700');
    expect(els[2].className).toContain('bg-zinc-800');
  });

  it('defaults to the info variant', () => {
    const c = mountContainer();
    showToast({ message: 'default' });
    expect((c.firstElementChild as HTMLElement).className).toContain('bg-zinc-800');
  });

  it('sets role=alert only on error toasts', () => {
    const c = mountContainer();
    showToast({ message: 'oops', variant: 'error' });
    showToast({ message: 'fine', variant: 'success' });
    const els = Array.from(c.children) as HTMLElement[];
    expect(els[0].getAttribute('role')).toBe('alert');
    expect(els[1].getAttribute('role')).toBeNull();
  });

  it('renders a dismiss button with the container aria-label (ES)', () => {
    const c = mountContainer('es');
    showToast({ message: 'hola' });
    const btn = c.querySelector('button');
    expect(btn).not.toBeNull();
    expect(btn?.getAttribute('aria-label')).toBe('Descartar');
  });

  it('auto-dismisses after the default duration', () => {
    vi.useFakeTimers();
    const c = mountContainer();
    showToast({ message: 'transient' });
    expect(c.children.length).toBe(1);
    vi.advanceTimersByTime(4000);
    vi.advanceTimersByTime(300);
    expect(c.children.length).toBe(0);
  });

  it('respects a custom durationMs', () => {
    vi.useFakeTimers();
    const c = mountContainer();
    showToast({ message: 'quick', durationMs: 1000 });
    vi.advanceTimersByTime(900);
    expect(c.children.length).toBe(1);
    vi.advanceTimersByTime(100 + 300);
    expect(c.children.length).toBe(0);
  });

  it('durationMs:0 stays until manually dismissed', () => {
    vi.useFakeTimers();
    const c = mountContainer();
    showToast({ message: 'sticky', durationMs: 0 });
    vi.advanceTimersByTime(60_000);
    expect(c.children.length).toBe(1);
    const btn = c.querySelector('button')!;
    btn.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(300);
    expect(c.children.length).toBe(0);
  });

  it('manual dismiss clears the auto-dismiss timer (no double-remove throw)', () => {
    vi.useFakeTimers();
    const c = mountContainer();
    showToast({ message: 'click me' });
    const btn = c.querySelector('button')!;
    btn.dispatchEvent(new Event('click'));
    vi.advanceTimersByTime(300);
    expect(c.children.length).toBe(0);
    // Original auto-dismiss timer must not fire / throw later.
    expect(() => vi.advanceTimersByTime(10_000)).not.toThrow();
    expect(c.children.length).toBe(0);
  });

  it('is a no-op when document is undefined (SSR)', () => {
    const realDoc = globalThis.document;
    // simulate SSR by removing the global document
    delete (globalThis as { document?: unknown }).document;
    expect(() => showToast({ message: 'ssr' })).not.toThrow();
    (globalThis as { document?: unknown }).document = realDoc;
  });

  it('_resetToastContainer removes the existing container', () => {
    mountContainer();
    showToast({ message: 'x' });
    expect(document.getElementById(TOAST_CONTAINER_ID)).not.toBeNull();
    _resetToastContainer();
    expect(document.getElementById(TOAST_CONTAINER_ID)).toBeNull();
  });
});
