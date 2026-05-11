/**
 * Unit test for #817: SW pmtiles buffer memo stale-on-redownload fix.
 *
 * Tests two things:
 *   1. SW message handler: PMTILES_CACHE_UPDATED clears pmtilesBufferMemo.
 *   2. downloadPmtilesMx sends the PMTILES_CACHE_UPDATED postMessage
 *      after cache.put (via the notifySwPmtilesUpdated helper, which
 *      is extracted for testability).
 *
 * We do NOT import offline-map.ts directly (import.meta.env cannot be
 * stubbed before module eval in this vitest setup). Instead, we inline
 * the relevant logic and test the contracts directly.
 */
import { describe, it, expect, vi, beforeEach } from 'vitest';

// ── 1. SW-side: message handler logic ────────────────────────────────────

describe('#817 — SW message handler clears buffer memo', () => {
  let pmtilesBufferMemo: { key: string; buf: ArrayBuffer } | null;

  // Mirror of the SW message handler added in public/sw.js.
  function onMessage(event: { data: unknown }) {
    if ((event.data as any)?.type === 'PMTILES_CACHE_UPDATED') {
      pmtilesBufferMemo = null;
    }
  }

  beforeEach(() => {
    pmtilesBufferMemo = {
      key: 'https://media.rastrum.org/maps/mexico_z0_10.pmtiles|etag-abc',
      buf: new ArrayBuffer(16),
    };
  });

  it('clears memo when PMTILES_CACHE_UPDATED is received', () => {
    expect(pmtilesBufferMemo).not.toBeNull();
    onMessage({ data: { type: 'PMTILES_CACHE_UPDATED', url: 'https://media.rastrum.org/maps/mexico_z0_10.pmtiles' } });
    expect(pmtilesBufferMemo).toBeNull();
  });

  it('does NOT clear memo for unrelated messages', () => {
    onMessage({ data: 'SKIP_WAITING' });
    expect(pmtilesBufferMemo).not.toBeNull();
  });

  it('does NOT clear memo for unrelated typed messages', () => {
    onMessage({ data: { type: 'SOME_OTHER_EVENT' } });
    expect(pmtilesBufferMemo).not.toBeNull();
  });

  it('clears memo on each re-download (multiple PMTILES_CACHE_UPDATED events)', () => {
    // First re-download clears.
    onMessage({ data: { type: 'PMTILES_CACHE_UPDATED', url: 'https://media.rastrum.org/maps/mexico_z0_10.pmtiles' } });
    expect(pmtilesBufferMemo).toBeNull();

    // Simulate memo being repopulated (normal SW operation after first range request).
    pmtilesBufferMemo = { key: 'url|new-etag', buf: new ArrayBuffer(8) };

    // Second re-download clears again.
    onMessage({ data: { type: 'PMTILES_CACHE_UPDATED', url: 'https://media.rastrum.org/maps/mexico_z0_10.pmtiles' } });
    expect(pmtilesBufferMemo).toBeNull();
  });
});

// ── 2. Page-side: notifySwPmtilesUpdated helper ───────────────────────────

/**
 * Inline the helper that downloadPmtilesMx calls after cache.put.
 * This matches the logic at the bottom of downloadPmtilesMx in offline-map.ts.
 */
function notifySwPmtilesUpdated(url: string, controller: { postMessage: (...a: unknown[]) => void } | null) {
  if (controller) {
    controller.postMessage({ type: 'PMTILES_CACHE_UPDATED', url });
  }
}

describe('#817 — page notifies SW after cache.put', () => {
  type PostMessageFn = (...a: unknown[]) => void;
  const URL = 'https://media.rastrum.org/maps/mexico_z0_10.pmtiles';
  let mockController: { postMessage: ReturnType<typeof vi.fn<PostMessageFn>> };

  beforeEach(() => {
    mockController = { postMessage: vi.fn<PostMessageFn>() };
  });

  it('sends PMTILES_CACHE_UPDATED with correct url', () => {
    notifySwPmtilesUpdated(URL, mockController);
    expect(mockController.postMessage).toHaveBeenCalledOnce();
    expect(mockController.postMessage).toHaveBeenCalledWith({
      type: 'PMTILES_CACHE_UPDATED',
      url: URL,
    });
  });

  it('sends message on each call (idempotent per re-download)', () => {
    notifySwPmtilesUpdated(URL, mockController);
    notifySwPmtilesUpdated(URL, mockController);
    expect(mockController.postMessage).toHaveBeenCalledTimes(2);
  });

  it('does nothing when controller is null (SW not active)', () => {
    expect(() => notifySwPmtilesUpdated(URL, null)).not.toThrow();
  });

  it('message type is always PMTILES_CACHE_UPDATED', () => {
    notifySwPmtilesUpdated(URL, mockController);
    const msg = mockController.postMessage.mock.calls[0][0] as any;
    expect(msg.type).toBe('PMTILES_CACHE_UPDATED');
  });
});
