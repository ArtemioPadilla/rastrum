/**
 * dropzone-surfaces.test.ts — unit tests for make-drop-target utility (issue #790).
 *
 * Tests the shared drag & drop wiring logic that powers drop targets on:
 *  - ObsManagePanel (photos grid)
 *  - QuickObserveSheet (via DropZone.astro)
 *  - BatchImporter (native implementation, same UX)
 *
 * The happy-dom environment provided by vitest supports DOM event dispatch,
 * so we can test the event listener wiring without a full browser.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';
import { makeDropTarget } from '../../src/lib/make-drop-target';

// ── Helpers ────────────────────────────────────────────────────────────────

function createFile(name = 'test.jpg', type = 'image/jpeg'): File {
  return new File(['dummy'], name, { type });
}

function fireDropEvent(element: HTMLElement, files: File[]): void {
  const dt = {
    files: {
      // DataTransfer.files-like object
      [Symbol.iterator]: function* () { yield* files; },
      length: files.length,
      item: (i: number) => files[i],
    } as unknown as FileList,
  };
  const event = new DragEvent('drop', { bubbles: true, cancelable: true });
  Object.defineProperty(event, 'dataTransfer', { value: dt });
  element.dispatchEvent(event);
}

function fireDragEnter(element: HTMLElement): void {
  element.dispatchEvent(new DragEvent('dragenter', { bubbles: true, cancelable: true }));
}

function fireDragLeave(element: HTMLElement, relatedTarget: Node | null = null): void {
  const event = new DragEvent('dragleave', { bubbles: true, cancelable: true, relatedTarget });
  element.dispatchEvent(event);
}

// ── Tests ──────────────────────────────────────────────────────────────────

describe('makeDropTarget — basic wiring', () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  it('calls onFiles with dropped files', () => {
    const spy = vi.fn();
    makeDropTarget(el, spy);
    const files = [createFile('a.jpg'), createFile('b.png', 'image/png')];
    fireDropEvent(el, files);
    expect(spy).toHaveBeenCalledOnce();
    expect(spy.mock.calls[0][0]).toHaveLength(2);
  });

  it('does not call onFiles when drop has no files', () => {
    const spy = vi.fn();
    makeDropTarget(el, spy);
    fireDropEvent(el, []);
    expect(spy).not.toHaveBeenCalled();
  });
});

describe('makeDropTarget — MIME type filtering', () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  it('passes only accepted MIME types to onFiles', () => {
    const spy = vi.fn();
    makeDropTarget(el, spy, { accept: ['image/'] });
    const files = [
      createFile('photo.jpg', 'image/jpeg'),
      createFile('doc.pdf',   'application/pdf'),
    ];
    fireDropEvent(el, files);
    expect(spy).toHaveBeenCalledOnce();
    const received: File[] = spy.mock.calls[0][0];
    expect(received).toHaveLength(1);
    expect(received[0].name).toBe('photo.jpg');
  });

  it('accepts all files when accept is empty', () => {
    const spy = vi.fn();
    makeDropTarget(el, spy, { accept: [] });
    const files = [createFile('a.mp3', 'audio/mpeg'), createFile('b.jpg', 'image/jpeg')];
    fireDropEvent(el, files);
    expect(spy.mock.calls[0][0]).toHaveLength(2);
  });

  it('accepts multiple MIME prefixes', () => {
    const spy = vi.fn();
    makeDropTarget(el, spy, { accept: ['image/', 'audio/'] });
    const files = [
      createFile('photo.jpg', 'image/jpeg'),
      createFile('sound.mp3', 'audio/mpeg'),
      createFile('doc.pdf',   'application/pdf'),
    ];
    fireDropEvent(el, files);
    expect(spy.mock.calls[0][0]).toHaveLength(2);
  });
});

describe('makeDropTarget — activeClass', () => {
  let el: HTMLElement;

  beforeEach(() => {
    el = document.createElement('div');
    document.body.appendChild(el);
  });

  it('adds activeClass on dragenter', () => {
    makeDropTarget(el, vi.fn(), { activeClass: 'drag-active' });
    fireDragEnter(el);
    expect(el.classList.contains('drag-active')).toBe(true);
  });

  it('removes activeClass on drop', () => {
    makeDropTarget(el, vi.fn(), { activeClass: 'drag-active' });
    fireDragEnter(el);
    fireDropEvent(el, [createFile()]);
    expect(el.classList.contains('drag-active')).toBe(false);
  });

  it('uses default activeClass "drag-over" when not specified', () => {
    makeDropTarget(el, vi.fn());
    fireDragEnter(el);
    expect(el.classList.contains('drag-over')).toBe(true);
  });
});

describe('makeDropTarget — overlay element (overlayEl)', () => {
  let el: HTMLElement;
  let overlay: HTMLElement;

  beforeEach(() => {
    el = document.createElement('div');
    overlay = document.createElement('div');
    overlay.classList.add('hidden');
    el.appendChild(overlay);
    document.body.appendChild(el);
  });

  it('shows overlay on dragenter', () => {
    makeDropTarget(el, vi.fn(), { overlayEl: overlay });
    fireDragEnter(el);
    expect(overlay.classList.contains('hidden')).toBe(false);
  });

  it('hides overlay on drop', () => {
    makeDropTarget(el, vi.fn(), { overlayEl: overlay });
    fireDragEnter(el);
    fireDropEvent(el, [createFile()]);
    expect(overlay.classList.contains('hidden')).toBe(true);
  });
});

describe('makeDropTarget — overlay selector (overlaySelector)', () => {
  let el: HTMLElement;
  let overlay: HTMLElement;

  beforeEach(() => {
    el = document.createElement('div');
    overlay = document.createElement('div');
    overlay.id = 'test-overlay';
    overlay.classList.add('hidden');
    el.appendChild(overlay);
    document.body.appendChild(el);
  });

  it('shows overlay via selector on dragenter', () => {
    makeDropTarget(el, vi.fn(), { overlaySelector: '#test-overlay' });
    fireDragEnter(el);
    expect(overlay.classList.contains('hidden')).toBe(false);
  });
});

describe('makeDropTarget — cleanup', () => {
  it('cleanup removes all listeners so onFiles is no longer called', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const spy = vi.fn();
    const cleanup = makeDropTarget(el, spy);
    cleanup();
    fireDropEvent(el, [createFile()]);
    expect(spy).not.toHaveBeenCalled();
  });

  it('cleanup removes activeClass listener', () => {
    const el = document.createElement('div');
    document.body.appendChild(el);
    const cleanup = makeDropTarget(el, vi.fn(), { activeClass: 'drag-active' });
    cleanup();
    fireDragEnter(el);
    expect(el.classList.contains('drag-active')).toBe(false);
  });
});
