import { describe, it, expect } from 'vitest';
import {
  letterboxRgba, postprocessYolo, unletterbox, pickDominant,
  MD_CLASS_LABELS, YOLO_INPUT_SIZE,
} from './megadetector-yolo';

function rgbaSolid(width: number, height: number, r: number, g: number, b: number): { data: Uint8ClampedArray; width: number; height: number } {
  const data = new Uint8ClampedArray(width * height * 4);
  for (let i = 0; i < width * height; i++) {
    data[i * 4]     = r;
    data[i * 4 + 1] = g;
    data[i * 4 + 2] = b;
    data[i * 4 + 3] = 255;
  }
  return { data, width, height };
}

describe('letterboxRgba', () => {
  it('produces NCHW output of the requested square size', () => {
    const src = rgbaSolid(320, 240, 255, 0, 0);
    const out = letterboxRgba(src, 64);
    expect(out.dims).toEqual([1, 3, 64, 64]);
    expect(out.data).toHaveLength(3 * 64 * 64);
  });

  it('preserves aspect ratio and fills border with grey 114/255', () => {
    const src = rgbaSolid(200, 100, 0, 255, 0); // wide image
    const out = letterboxRgba(src, 64);
    // padX should be 0 (full width fits), padY should be > 0
    expect(out.padX).toBe(0);
    expect(out.padY).toBeGreaterThan(0);
    // Top-left corner is in the grey-padded region — should be 114/255 in all channels
    expect(out.data[0]).toBeCloseTo(114 / 255, 2);
    expect(out.data[64 * 64]).toBeCloseTo(114 / 255, 2);
  });

  it('writes the source pixels into the centred crop region', () => {
    const src = rgbaSolid(64, 64, 0, 0, 255); // square, blue
    const out = letterboxRgba(src, 64);
    expect(out.scale).toBe(1);
    // Centre pixel: R=0, G=0, B=255 → R-plane = 0, G-plane = 0, B-plane = 1
    const centre = 32 * 64 + 32;
    expect(out.data[centre]).toBeCloseTo(0, 5);                // R
    expect(out.data[64 * 64 + centre]).toBeCloseTo(0, 5);      // G
    expect(out.data[2 * 64 * 64 + centre]).toBeCloseTo(1, 5);  // B
  });
});

describe('postprocessYolo', () => {
  it('returns empty array when no detections clear the threshold', () => {
    // 4 anchors, 9 attrs (xywh + obj + 4 classes). All obj_conf 0.
    const numAttrs = 9;
    const numAnchors = 4;
    const raw = new Float32Array(numAnchors * numAttrs);
    expect(postprocessYolo({ raw, numAnchors, numAttrs, minConfidence: 0.2 })).toEqual([]);
  });

  it('decodes a single high-confidence animal detection', () => {
    const numAttrs = 9; // xywh + obj + 4 classes
    const numAnchors = 1;
    const raw = new Float32Array(numAttrs);
    // Centre at (320, 320), 100×100 box, obj=0.9, animal class conf=0.9
    raw[0] = 320; raw[1] = 320; raw[2] = 100; raw[3] = 100;
    raw[4] = 0.9;                 // obj_conf
    raw[5] = 0.9;                 // animal
    raw[6] = 0.0;                 // human
    raw[7] = 0.0;                 // vehicle
    raw[8] = 0.0;                 // empty
    const out = postprocessYolo({ raw, numAnchors, numAttrs, minConfidence: 0.2 });
    expect(out).toHaveLength(1);
    expect(out[0].classLabel).toBe('animal');
    expect(out[0].confidence).toBeCloseTo(0.81, 2);
    expect(out[0].bbox).toEqual([270, 270, 370, 370]);
  });

  it('runs NMS — overlapping high-confidence boxes collapse to one', () => {
    const numAttrs = 9;
    const numAnchors = 2;
    const raw = new Float32Array(numAnchors * numAttrs);
    // Two near-identical boxes
    for (let i = 0; i < 2; i++) {
      const off = i * numAttrs;
      raw[off + 0] = 320 + i * 5;  // tiny shift
      raw[off + 1] = 320;
      raw[off + 2] = 100;
      raw[off + 3] = 100;
      raw[off + 4] = 0.9;
      raw[off + 5] = 0.9;
    }
    const out = postprocessYolo({ raw, numAnchors, numAttrs, minConfidence: 0.2, iouThreshold: 0.45 });
    expect(out).toHaveLength(1);
  });

  it('classifies a detection as human when class_human is the top class', () => {
    const numAttrs = 9;
    const raw = new Float32Array(numAttrs);
    raw[0] = 100; raw[1] = 100; raw[2] = 50; raw[3] = 50;
    raw[4] = 0.8;
    raw[5] = 0.1;  // animal
    raw[6] = 0.9;  // human
    raw[7] = 0.0;
    raw[8] = 0.0;
    const out = postprocessYolo({ raw, numAnchors: 1, numAttrs });
    expect(out[0].classLabel).toBe('human');
    expect(out[0].classIndex).toBe(MD_CLASS_LABELS.indexOf('human'));
  });
});

describe('unletterbox', () => {
  it('inverts the letterbox transform', () => {
    const ctx = { scale: 0.5, padX: 0, padY: 100 };
    const tensorBox: [number, number, number, number] = [10, 110, 110, 210];
    const sourceBox = unletterbox(tensorBox, ctx);
    expect(sourceBox).toEqual([20, 20, 220, 220]);
  });
});

describe('pickDominant', () => {
  it('returns empty when there are no detections', () => {
    expect(pickDominant([])).toEqual({ label: 'empty' });
  });

  it('returns empty when the top detection is below the threshold', () => {
    const out = pickDominant([
      { bbox: [0, 0, 1, 1], confidence: 0.05, classIndex: 0, classLabel: 'animal' },
    ], 0.2);
    expect(out.label).toBe('empty');
  });

  it('returns the top detection when above threshold', () => {
    const det = { bbox: [0, 0, 1, 1] as [number, number, number, number], confidence: 0.85, classIndex: 0, classLabel: 'animal' as const };
    const out = pickDominant([det]);
    expect(out.label).toBe('animal');
    expect(out.detection).toEqual(det);
  });
});

describe('YOLO_INPUT_SIZE constant', () => {
  it('matches MegaDetector v5a expected input', () => {
    expect(YOLO_INPUT_SIZE).toBe(640);
  });
});
