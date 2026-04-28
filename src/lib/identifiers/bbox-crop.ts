/**
 * Bbox-aware media cropping utilities for the identifier cascade.
 *
 * When MegaDetector v5a finds an animal in a camera-trap frame it
 * attaches the bbox to its thrown error. The cascade engine forwards
 * that bbox to the next plugin via `IdentifyInput.mediaCrop`. Plugins
 * that consume the field (today: `phi-vision`) call `cropDataUrlToBbox`
 * here to pre-crop their input before running inference.
 *
 * Pure-canvas; no plugin dependencies. Server-side plugins (claude,
 * plantnet) ignore `mediaCrop` for now — when the `identify` Edge
 * Function gains a `crop_bbox` body field, this helper's clamp + pad
 * math is reused there too (see clampAndPad).
 */

export interface CropOpts {
  /** Source bbox: [x1, y1, x2, y2] in source-image pixel space. */
  bbox: [number, number, number, number];
  /** Pad each side by this fraction of bbox width/height. Default 0.1. */
  pad?: number;
  /** Output JPEG quality 0..1. Default 0.92. */
  quality?: number;
}

/**
 * Clamp the bbox to image bounds and pad each side by a fraction of
 * the bbox dimensions. Returns the final crop rectangle. Pure
 * arithmetic — testable without a DOM.
 */
export function clampAndPad(
  bbox: [number, number, number, number],
  imgWidth: number,
  imgHeight: number,
  pad: number = 0.1,
): { x: number; y: number; w: number; h: number } {
  const [rx1, ry1, rx2, ry2] = bbox;
  // Normalise (allow consumers that pass [x2 < x1] from a flipped tensor).
  const ax1 = Math.min(rx1, rx2);
  const ay1 = Math.min(ry1, ry2);
  const ax2 = Math.max(rx1, rx2);
  const ay2 = Math.max(ry1, ry2);

  const bw = Math.max(1, ax2 - ax1);
  const bh = Math.max(1, ay2 - ay1);
  const padX = bw * pad;
  const padY = bh * pad;

  const x1 = Math.max(0, Math.floor(ax1 - padX));
  const y1 = Math.max(0, Math.floor(ay1 - padY));
  const x2 = Math.min(imgWidth, Math.ceil(ax2 + padX));
  const y2 = Math.min(imgHeight, Math.ceil(ay2 + padY));

  return { x: x1, y: y1, w: Math.max(1, x2 - x1), h: Math.max(1, y2 - y1) };
}

/**
 * Crop a base64 dataUrl to the given bbox. Used by phi-vision; phi
 * resizes to 336×336 internally so we don't need to enforce a target
 * size here.
 *
 * Browser-only — uses `Image` + `OffscreenCanvas`/`HTMLCanvasElement`.
 * Throws when called in an env without a canvas (e.g. vitest's
 * happy-dom on the server). Tests cover `clampAndPad` only; this
 * function is exercised by the e2e suite.
 */
export async function cropDataUrlToBbox(
  dataUrl: string,
  opts: CropOpts,
): Promise<string> {
  const img = await loadImage(dataUrl);
  const rect = clampAndPad(opts.bbox, img.naturalWidth, img.naturalHeight, opts.pad);
  const canvas: HTMLCanvasElement | OffscreenCanvas =
    typeof OffscreenCanvas !== 'undefined'
      ? new OffscreenCanvas(rect.w, rect.h)
      : (() => { const c = document.createElement('canvas'); c.width = rect.w; c.height = rect.h; return c; })();
  const ctx = canvas.getContext('2d') as
    | OffscreenCanvasRenderingContext2D
    | CanvasRenderingContext2D
    | null;
  if (!ctx) throw new Error('cropDataUrlToBbox: 2D canvas unavailable');
  ctx.drawImage(img as unknown as CanvasImageSource, rect.x, rect.y, rect.w, rect.h, 0, 0, rect.w, rect.h);

  const quality = opts.quality ?? 0.92;
  if ('convertToBlob' in canvas) {
    const blob = await canvas.convertToBlob({ type: 'image/jpeg', quality });
    return blobToDataUrl(blob);
  }
  return (canvas as HTMLCanvasElement).toDataURL('image/jpeg', quality);
}

function loadImage(src: string): Promise<HTMLImageElement> {
  return new Promise((resolve, reject) => {
    const img = new Image();
    img.onload = () => resolve(img);
    img.onerror = () => reject(new Error('Image load failed'));
    img.src = src;
  });
}

function blobToDataUrl(blob: Blob): Promise<string> {
  return new Promise((resolve, reject) => {
    const r = new FileReader();
    r.onloadend = () => resolve(r.result as string);
    r.onerror = () => reject(new Error('FileReader failed'));
    r.readAsDataURL(blob);
  });
}
