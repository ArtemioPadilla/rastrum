import { describe, it, expect } from 'vitest';
import {
  VIDEO_MIME_PREFERENCE,
  VIDEO_THUMB_PARAMS,
  VIDEO_MAX_SECS,
  MEXICO_DEFAULT_CENTER,
  pickVideoMime,
  computeThumbDims,
  isValidLatLng,
} from './media-helpers';

describe('media-helpers · pickVideoMime', () => {
  it('returns the first candidate the support fn accepts', () => {
    const supported = new Set([VIDEO_MIME_PREFERENCE[2], VIDEO_MIME_PREFERENCE[5]]);
    const got = pickVideoMime((m) => supported.has(m));
    expect(got).toBe(VIDEO_MIME_PREFERENCE[2]);
  });

  it('prefers H.265 (hvc1) when offered alongside VP9', () => {
    const supported = new Set([
      'video/mp4;codecs=hvc1',
      'video/webm;codecs=vp9,opus',
    ]);
    const got = pickVideoMime((m) => supported.has(m));
    expect(got).toBe('video/mp4;codecs=hvc1');
  });

  it('prefers AV1 over VP9 when H.265 is unsupported', () => {
    const supported = new Set([
      'video/webm;codecs=av01',
      'video/webm;codecs=vp9,opus',
    ]);
    const got = pickVideoMime((m) => supported.has(m));
    expect(got).toBe('video/webm;codecs=av01');
  });

  it('falls back to video/webm when nothing in the list is supported', () => {
    const got = pickVideoMime(() => false);
    expect(got).toBe('video/webm');
  });

  it('preference list starts with H.265 and ends with generic mp4', () => {
    expect(VIDEO_MIME_PREFERENCE[0]).toBe('video/mp4;codecs=hvc1');
    expect(VIDEO_MIME_PREFERENCE.includes('video/webm;codecs=av01')).toBe(true);
    expect(VIDEO_MIME_PREFERENCE.includes('video/webm;codecs=vp9')).toBe(true);
    expect(VIDEO_MIME_PREFERENCE[VIDEO_MIME_PREFERENCE.length - 1]).toBe('video/mp4');
  });
});

describe('media-helpers · computeThumbDims', () => {
  it('keeps a 16:9 source landscape and clamps the long side', () => {
    const { w, h } = computeThumbDims(1920, 1080, 320);
    expect(w).toBe(320);
    expect(h).toBe(180);
  });

  it('flips the clamp when the source is portrait', () => {
    const { w, h } = computeThumbDims(720, 1280, 320);
    expect(h).toBe(320);
    expect(w).toBe(180);
  });

  it('handles a square source', () => {
    const { w, h } = computeThumbDims(500, 500, 320);
    expect(w).toBe(320);
    expect(h).toBe(320);
  });

  it('falls back to a square thumb on non-finite dims', () => {
    expect(computeThumbDims(NaN, 1080)).toEqual({ w: 320, h: 320 });
    expect(computeThumbDims(1920, Infinity)).toEqual({ w: 320, h: 320 });
    expect(computeThumbDims(0, 1080)).toEqual({ w: 320, h: 320 });
    expect(computeThumbDims(-1, -1)).toEqual({ w: 320, h: 320 });
  });

  it('respects a custom maxSide', () => {
    const { w, h } = computeThumbDims(1920, 1080, 160);
    expect(w).toBe(160);
    expect(h).toBe(90);
  });
});

describe('media-helpers · constants', () => {
  it('VIDEO_MAX_SECS is 30 to mirror the audio cap', () => {
    expect(VIDEO_MAX_SECS).toBe(30);
  });

  it('VIDEO_THUMB_PARAMS uses image/jpeg with a small seek offset', () => {
    expect(VIDEO_THUMB_PARAMS.mime).toBe('image/jpeg');
    expect(VIDEO_THUMB_PARAMS.seekToSec).toBeGreaterThan(0);
    expect(VIDEO_THUMB_PARAMS.seekToSec).toBeLessThan(1);
    expect(VIDEO_THUMB_PARAMS.quality).toBeGreaterThan(0);
    expect(VIDEO_THUMB_PARAMS.quality).toBeLessThanOrEqual(1);
  });

  it('MEXICO_DEFAULT_CENTER points roughly at central Mexico', () => {
    expect(MEXICO_DEFAULT_CENTER.lat).toBeCloseTo(19.4, 1);
    expect(MEXICO_DEFAULT_CENTER.lng).toBeCloseTo(-99.1, 1);
  });
});

describe('media-helpers · isValidLatLng', () => {
  it('accepts ordinary coords', () => {
    expect(isValidLatLng(19.4, -99.1)).toBe(true);
    expect(isValidLatLng(0, 0)).toBe(true);
    expect(isValidLatLng(-90, 180)).toBe(true);
  });

  it('rejects non-finite values', () => {
    expect(isValidLatLng(NaN, 0)).toBe(false);
    expect(isValidLatLng(0, NaN)).toBe(false);
    expect(isValidLatLng(Infinity, 0)).toBe(false);
  });

  it('rejects out-of-range coords', () => {
    expect(isValidLatLng(91, 0)).toBe(false);
    expect(isValidLatLng(-91, 0)).toBe(false);
    expect(isValidLatLng(0, 181)).toBe(false);
    expect(isValidLatLng(0, -181)).toBe(false);
  });
});
