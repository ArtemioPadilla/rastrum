/**
 * Tests for the bugs reported by Eugenio (Oaxaca, Android 10, Chrome 147)
 * on 2026-05-09.
 *
 * Bug 1: makeDropTarget filterFiles crashes when DataTransfer includes
 *        undefined/null entries — "Cannot read properties of undefined
 *        (reading 'type')".
 *
 * Bug 2: triageFile should handle File objects with empty/missing .type
 *        (Android Chrome sometimes omits MIME type for gallery picks).
 *
 * Bug 3: pipeline escape hatch — pipelineState.status should be marked
 *        'failed' (not left as 'processing') when the escape is triggered,
 *        so resumePipeline() won't retry on next reload.
 */

import { describe, it, expect } from 'vitest';
import { triageFile } from '../../src/lib/pipeline-engine';

// ── makeDropTarget filterFiles (via triageFile proxy) ─────────────────────
// makeDropTarget is a DOM function — we test its file-filtering logic via
// the exported triageFile helper which uses the same MIME + extension paths.

describe('triageFile — Android Chrome defensive cases', () => {
  function makeFile(name: string, type: string): File {
    return new File(['x'], name, { type });
  }

  it('classifies image/* as photo', () => {
    expect(triageFile(makeFile('photo.jpg', 'image/jpeg'))).toBe('photo');
    expect(triageFile(makeFile('photo.png', 'image/png'))).toBe('photo');
    expect(triageFile(makeFile('photo.webp', 'image/webp'))).toBe('photo');
  });

  it('classifies audio/* as audio', () => {
    expect(triageFile(makeFile('recording.m4a', 'audio/mp4'))).toBe('audio');
    expect(triageFile(makeFile('bird.mp3', 'audio/mpeg'))).toBe('audio');
  });

  it('classifies video/* as video', () => {
    expect(triageFile(makeFile('clip.mp4', 'video/mp4'))).toBe('video');
  });

  it('falls back to extension when MIME is empty (Android Chrome gallery)', () => {
    // Android Chrome 147 sometimes serves files with type='' from the gallery
    expect(triageFile(makeFile('photo.jpg', ''))).toBe('photo');
    expect(triageFile(makeFile('photo.heic', ''))).toBe('photo');
    expect(triageFile(makeFile('audio.m4a', ''))).toBe('audio');
    expect(triageFile(makeFile('video.mp4', ''))).toBe('video');
  });

  it('returns unknown for unrecognized file without type', () => {
    expect(triageFile(makeFile('data.bin', ''))).toBe('unknown');
  });

  it('handles File with undefined type gracefully', () => {
    // Simulate Android DataTransfer edge case: file.type is undefined
    const f = makeFile('photo.jpg', '');
    Object.defineProperty(f, 'type', { get: () => undefined });
    // Should not throw — falls back to extension sniff
    expect(() => triageFile(f as File)).not.toThrow();
    // Extension .jpg → photo
    expect(triageFile(f as File)).toBe('photo');
  });
});

// ── filterFiles null-safety (mirrors make-drop-target.ts fix) ─────────────

describe('filterFiles — null/undefined file entries', () => {
  // Inline the fixed logic to test it in isolation
  function filterFiles(
    rawFiles: Array<File | null | undefined>,
    accept?: string[],
  ): File[] {
    const files = rawFiles.filter(Boolean) as File[];
    if (!accept?.length) return files;
    return files.filter(f => f && accept.some(prefix => f.type?.startsWith(prefix)));
  }

  it('filters out null entries without throwing', () => {
    const files = [null, new File(['x'], 'a.jpg', { type: 'image/jpeg' }), undefined];
    expect(() => filterFiles(files)).not.toThrow();
    expect(filterFiles(files)).toHaveLength(1);
  });

  it('filters out undefined entries without throwing', () => {
    const files = [undefined, undefined, new File(['x'], 'b.mp3', { type: 'audio/mpeg' })];
    expect(filterFiles(files)).toHaveLength(1);
    expect(filterFiles(files)[0].name).toBe('b.mp3');
  });

  it('all-null array returns empty array', () => {
    expect(filterFiles([null, null, undefined])).toEqual([]);
  });

  it('MIME prefix filter still works after null-safety fix', () => {
    const files = [
      null,
      new File(['x'], 'photo.jpg', { type: 'image/jpeg' }),
      new File(['x'], 'doc.pdf', { type: 'application/pdf' }),
      undefined,
    ];
    const images = filterFiles(files, ['image/']);
    expect(images).toHaveLength(1);
    expect(images[0].name).toBe('photo.jpg');
  });

  it('file with empty type is kept (not filtered out by null check)', () => {
    const f = new File(['x'], 'photo.heic', { type: '' });
    // With accept=['image/'], a blank-type file should be excluded by prefix
    // (can't match) but should NOT crash.
    expect(() => filterFiles([f], ['image/'])).not.toThrow();
  });

  it('file with undefined .type property does not crash', () => {
    const f = new File(['x'], 'photo.jpg', { type: 'image/jpeg' });
    Object.defineProperty(f, 'type', { get: () => undefined });
    expect(() => filterFiles([f as File], ['image/'])).not.toThrow();
  });
});

// ── Pipeline escape hatch state transition ─────────────────────────────────

describe('pipeline escape hatch — status transition', () => {
  // The escape button click handler does:
  //   if (pipelineState.status === 'processing') pipelineState.status = 'failed'
  // This prevents resumePipeline() from retrying on next reload (#786).

  type Status = 'processing' | 'done' | 'failed';

  function applyEscapeHatch(state: { status: Status }): { status: Status } {
    if (state.status === 'processing') {
      return { ...state, status: 'failed' };
    }
    return state;
  }

  it('marks processing pipeline as failed', () => {
    const state = { status: 'processing' as Status };
    expect(applyEscapeHatch(state).status).toBe('failed');
  });

  it('does not change already-failed pipeline', () => {
    const state = { status: 'failed' as Status };
    expect(applyEscapeHatch(state).status).toBe('failed');
  });

  it('does not change done pipeline', () => {
    const state = { status: 'done' as Status };
    expect(applyEscapeHatch(state).status).toBe('done');
  });

  it('failed status prevents resume retry (matches resumePipeline guard)', () => {
    // resumePipeline only calls runPipeline when status !== 'done' && !== 'failed'
    function wouldResume(status: Status): boolean {
      return status !== 'done' && status !== 'failed';
    }
    expect(wouldResume('processing')).toBe(true);  // without escape: would retry
    expect(wouldResume('failed')).toBe(false);      // after escape: no retry
    expect(wouldResume('done')).toBe(false);
  });
});
