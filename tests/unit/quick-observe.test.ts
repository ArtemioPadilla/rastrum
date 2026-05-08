import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  buildQuickObservationDraft,
  isNullIsland,
  mediaKindFromMime,
  getQuickGps,
  type QuickGpsInput,
} from '../../src/lib/quick-observe';

const userRef = { kind: 'user' as const, id: 'u-1' };
const fakeFile = (mime = 'image/jpeg') => ({
  blob: new Blob(['x'], { type: mime || 'application/octet-stream' }),
  mimeType: mime,
  sizeBytes: 1,
});

describe('quick-observe / mediaKindFromMime', () => {
  it.each([
    ['image/jpeg', 'photo'],
    ['image/heic', 'photo'],
    ['audio/mp4', 'audio'],
    ['audio/wav', 'audio'],
    ['video/mp4', 'video'],
    ['', 'photo'],
    ['application/octet-stream', 'photo'],
  ])('maps %s -> %s', (mime, kind) => {
    expect(mediaKindFromMime(mime)).toBe(kind);
  });
});

describe('quick-observe / isNullIsland', () => {
  it('rejects exact (0,0)', () => {
    expect(isNullIsland(0, 0)).toBe(true);
  });
  it('accepts equator readings (legitimate Quito / Nairobi observers)', () => {
    expect(isNullIsland(0, -78.45)).toBe(false);   // Quito
    expect(isNullIsland(36.82, 0.0)).toBe(false);  // off-coast Algeria
  });
  it('accepts negatives away from origin', () => {
    expect(isNullIsland(-15.7942, -47.8825)).toBe(false); // Brasília
  });
});

describe('quick-observe / buildQuickObservationDraft', () => {
  it('produces a non-draft row when EXIF GPS is given', () => {
    const loc: QuickGpsInput = { lat: 19.4326, lng: -99.1332, accuracyM: 15, altitudeM: 2240, source: 'exif' };
    const draft = buildQuickObservationDraft({ observerRef: userRef, file: fakeFile(), location: loc });
    expect(draft.asDraft).toBeFalsy();
    expect(draft.location).toEqual({
      lat: 19.4326, lng: -99.1332, accuracyM: 15, altitudeM: 2240, capturedFrom: 'exif',
    });
  });

  it('produces a non-draft row when live GPS is given', () => {
    const loc: QuickGpsInput = { lat: -15.7942, lng: -47.8825, accuracyM: 30, altitudeM: null, source: 'gps' };
    const draft = buildQuickObservationDraft({ observerRef: userRef, file: fakeFile(), location: loc });
    expect(draft.asDraft).toBeFalsy();
    expect(draft.location.capturedFrom).toBe('gps');
  });

  it('falls back to a draft (null-island sentinel) when no GPS available', () => {
    const draft = buildQuickObservationDraft({ observerRef: userRef, file: fakeFile(), location: null });
    expect(draft.asDraft).toBe(true);
    expect(draft.location).toEqual({ lat: 0, lng: 0, accuracyM: 0, altitudeM: null, capturedFrom: 'gps' });
  });

  it('treats (0,0) coordinates as null island and saves as draft', () => {
    const loc: QuickGpsInput = { lat: 0, lng: 0, accuracyM: 1, altitudeM: null, source: 'exif' };
    const draft = buildQuickObservationDraft({ observerRef: userRef, file: fakeFile(), location: loc });
    expect(draft.asDraft).toBe(true);
  });

  it('puts the file into media[] with derived mediaType and a fresh blobId', () => {
    const draft = buildQuickObservationDraft({ observerRef: userRef, file: fakeFile('audio/mp4'), location: null });
    expect(draft.media).toHaveLength(1);
    expect(draft.media[0].mediaType).toBe('audio');
    expect(draft.media[0].mimeType).toBe('audio/mp4');
    expect(typeof draft.media[0].blobId).toBe('string');
    expect(draft.media[0].blobId.length).toBeGreaterThan(0);
  });

  it('preserves a caller-supplied blobId when provided', () => {
    const draft = buildQuickObservationDraft({
      observerRef: userRef,
      file: fakeFile(),
      location: null,
      blobId: 'fixed-id',
    });
    expect(draft.media[0].blobId).toBe('fixed-id');
  });

  it('defaults audio captures to evidence "sound"', () => {
    const draft = buildQuickObservationDraft({ observerRef: userRef, file: fakeFile('audio/m4a'), location: null });
    expect(draft.evidenceType).toBe('sound');
  });

  it('defaults photos to evidence "direct_sighting"', () => {
    const draft = buildQuickObservationDraft({ observerRef: userRef, file: fakeFile('image/jpeg'), location: null });
    expect(draft.evidenceType).toBe('direct_sighting');
  });
});

describe('quick-observe / getQuickGps', () => {
  beforeEach(() => { vi.useFakeTimers(); });
  afterEach(() => { vi.useRealTimers(); });

  it('resolves to coords on success', async () => {
    const navStub = {
      geolocation: {
        getCurrentPosition: vi.fn((success: (p: { coords: { latitude: number; longitude: number; accuracy: number; altitude: number | null } }) => void) => {
          success({ coords: { latitude: 19.4, longitude: -99.1, accuracy: 12, altitude: 2200 } });
        }),
      },
    };
    const result = await getQuickGps(navStub);
    expect(result).toEqual({ lat: 19.4, lng: -99.1, accuracyM: 12, altitudeM: 2200, source: 'gps' });
  });

  it('returns null on geolocation error (denied / unavailable)', async () => {
    const navStub = {
      geolocation: {
        getCurrentPosition: vi.fn((_s: unknown, error: (e: { code: number }) => void) => {
          error({ code: 1 });
        }),
      },
    };
    const result = await getQuickGps(navStub);
    expect(result).toBeNull();
  });

  it('returns null after the timeout fires before any callback', async () => {
    const navStub = {
      geolocation: {
        getCurrentPosition: vi.fn(() => { /* never callback */ }),
      },
    };
    const p = getQuickGps(navStub, 5_000);
    vi.advanceTimersByTime(5_001);
    await expect(p).resolves.toBeNull();
  });

  it('returns null when geolocation is not available', async () => {
    const result = await getQuickGps({} as never);
    expect(result).toBeNull();
  });
});
