import { describe, it, expect, vi } from 'vitest';
import { isChunkLoadError, recoverFromChunkLoadError } from './chunk-reload';

function fakeStorage(initial: Record<string, string> = {}) {
  const m = new Map(Object.entries(initial));
  return {
    getItem: (k: string) => (m.has(k) ? (m.get(k) as string) : null),
    setItem: (k: string, v: string) => void m.set(k, v),
  };
}

describe('isChunkLoadError', () => {
  it('is true for the Vite/Chrome dynamic-import failure', () => {
    expect(
      isChunkLoadError(
        new TypeError(
          'Failed to fetch dynamically imported module: https://rastrum.org/_astro/claude-availability.DmTXbHnd.js',
        ),
      ),
    ).toBe(true);
  });

  it('is true for the Safari "Importing a module script failed" message', () => {
    expect(isChunkLoadError(new Error('Importing a module script failed.'))).toBe(true);
  });

  it('is true for a named ChunkLoadError', () => {
    const e = new Error('loading chunk 42 failed');
    e.name = 'ChunkLoadError';
    expect(isChunkLoadError(e)).toBe(true);
  });

  it('is false for an unrelated runtime error', () => {
    expect(isChunkLoadError(new TypeError("Cannot read properties of null (reading 'x')"))).toBe(
      false,
    );
  });

  it('is false for non-error values', () => {
    expect(isChunkLoadError(undefined)).toBe(false);
    expect(isChunkLoadError('nope')).toBe(false);
  });
});

describe('recoverFromChunkLoadError', () => {
  const chunkErr = new TypeError('Failed to fetch dynamically imported module: /x.js');

  it('reloads once and records a one-shot guard on first chunk failure', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    const recovered = recoverFromChunkLoadError(chunkErr, { storage, reload });
    expect(recovered).toBe(true);
    expect(reload).toHaveBeenCalledTimes(1);
    expect(storage.getItem('rastrum.chunkReload')).toBeTruthy();
  });

  it('does not reload again if the guard is already set (no reload loop)', () => {
    const storage = fakeStorage({ 'rastrum.chunkReload': '1' });
    const reload = vi.fn();
    const recovered = recoverFromChunkLoadError(chunkErr, { storage, reload });
    expect(recovered).toBe(false);
    expect(reload).not.toHaveBeenCalled();
  });

  it('ignores non-chunk errors (caller handles them normally)', () => {
    const storage = fakeStorage();
    const reload = vi.fn();
    const recovered = recoverFromChunkLoadError(new Error('boom'), { storage, reload });
    expect(recovered).toBe(false);
    expect(reload).not.toHaveBeenCalled();
    expect(storage.getItem('rastrum.chunkReload')).toBeNull();
  });
});
