/**
 * Pure helpers for photo cropping + rotation. The DOM/canvas branches
 * are feature-detected so callers can import this in non-DOM tests.
 *
 * The math (`normalizeCropRect`, `rotateRect`) is split out for unit
 * tests without browser APIs.
 */

export interface CropRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

export type Rotation = 0 | 90 | 180 | 270;

/**
 * Clamp a crop rectangle to the bounds of an image and ensure it has
 * non-zero area. Returns the original rect when valid, or a sane
 * full-image rect when the input is malformed.
 */
export function normalizeCropRect(rect: CropRect, imgW: number, imgH: number): CropRect {
  if (!Number.isFinite(imgW) || !Number.isFinite(imgH) || imgW <= 0 || imgH <= 0) {
    return { x: 0, y: 0, width: 0, height: 0 };
  }
  const x = Math.max(0, Math.min(imgW - 1, Math.round(rect.x)));
  const y = Math.max(0, Math.min(imgH - 1, Math.round(rect.y)));
  const maxW = imgW - x;
  const maxH = imgH - y;
  const width = Math.max(1, Math.min(maxW, Math.round(rect.width)));
  const height = Math.max(1, Math.min(maxH, Math.round(rect.height)));
  return { x, y, width, height };
}

/**
 * Bounding box of a rotated image — used to size the destination
 * canvas so the rotated content fits without clipping.
 */
export function rotatedDims(w: number, h: number, rotation: Rotation): { w: number; h: number } {
  if (rotation === 90 || rotation === 270) return { w: h, h: w };
  return { w, h };
}

/**
 * Rename `foo.heic` → `foo.jpg` for canvas-encoded outputs (we always
 * write JPEG). Keeps the basename intact for user-recognition.
 */
export function renameToJpeg(name: string): string {
  if (!name) return 'photo.jpg';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return name + '.jpg';
  return name.slice(0, dot) + '.jpg';
}

export interface CropAndRotateOptions {
  rect: CropRect;
  rotation: Rotation;
  /** JPEG quality, 0–1. Default 0.92 (slightly higher than compress's 0.9 since this runs before compression). */
  quality?: number;
}

/**
 * Crop + rotate a File using canvas. Returns the result as a new
 * File, or the original File if browser canvas APIs are unavailable
 * (older browsers / SSR). Never mutates the input.
 *
 * The rotation is applied first, then the crop is taken from the
 * rotated image — so callers should compute crop coordinates against
 * the rotated bitmap.
 */
export async function cropAndRotate(file: File, options: CropAndRotateOptions): Promise<File> {
  if (!(file instanceof File)) {
    throw new TypeError('cropAndRotate: expected a File');
  }
  if (typeof createImageBitmap !== 'function') return file;

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return file;
  }

  const rotation = options.rotation;
  const quality = options.quality ?? 0.92;
  const rotated = rotatedDims(bitmap.width, bitmap.height, rotation);
  const rect = normalizeCropRect(options.rect, rotated.w, rotated.h);
  if (rect.width === 0 || rect.height === 0) {
    bitmap.close?.();
    return file;
  }

  const blob = await drawAndEncode(bitmap, rect, rotation, quality);
  bitmap.close?.();
  if (!blob) return file;

  return new File([blob], renameToJpeg(file.name), {
    type: 'image/jpeg',
    lastModified: file.lastModified,
  });
}

async function drawAndEncode(
  bitmap: ImageBitmap,
  rect: CropRect,
  rotation: Rotation,
  quality: number,
): Promise<Blob | null> {
  const w = rect.width;
  const h = rect.height;

  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      drawRotatedCrop(ctx, bitmap, rect, rotation);
      return await c.convertToBlob({ type: 'image/jpeg', quality });
    } catch {
      /* fall through */
    }
  }
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  drawRotatedCrop(ctx, bitmap, rect, rotation);
  return new Promise<Blob | null>((resolve) =>
    c.toBlob((b) => resolve(b), 'image/jpeg', quality),
  );
}

function drawRotatedCrop(
  ctx: CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D,
  bitmap: ImageBitmap,
  rect: CropRect,
  rotation: Rotation,
): void {
  const sw = bitmap.width;
  const sh = bitmap.height;
  ctx.save();
  ctx.translate(-rect.x, -rect.y);
  switch (rotation) {
    case 90:
      ctx.translate(sh, 0);
      ctx.rotate(Math.PI / 2);
      break;
    case 180:
      ctx.translate(sw, sh);
      ctx.rotate(Math.PI);
      break;
    case 270:
      ctx.translate(0, sw);
      ctx.rotate(-Math.PI / 2);
      break;
  }
  ctx.drawImage(bitmap, 0, 0);
  ctx.restore();
}
