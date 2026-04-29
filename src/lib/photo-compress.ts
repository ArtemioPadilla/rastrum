/**
 * Auto-compress photos > maxMP megapixels to maxMP via canvas before they
 * land in the Dexie outbox. Phone cameras routinely produce 12–48 MP files;
 * PlantNet and Claude both downscale anyway and PlantNet's docs say nothing
 * above 1024 px improves top-1.
 *
 * Strategy:
 *   - decodeBitmap → measure W × H
 *   - if (W × H) <= maxMP * 1e6, return original File untouched
 *   - else compute scale = sqrt(maxMP * 1e6 / (W × H)) and re-encode as JPEG q=0.9
 *
 * EXIF GPS is already extracted upstream of this helper (see fillFromExif),
 * so we don't try to preserve EXIF — re-encoding strips it as a privacy plus.
 *
 * Pure helper. The canvas/ImageBitmap branch is feature-detected so callers
 * can safely import this in non-DOM tests; the size-decision logic is split
 * out as `computeScale` for unit testing without browser APIs.
 */
export const DEFAULT_MAX_MP = 4;
export const DEFAULT_QUALITY = 0.9;
/** Hard byte cap after compression. R2 storage cost + mobile upload speed. */
export const DEFAULT_MAX_BYTES = 4 * 1024 * 1024;
/** Floor on JPEG quality when iteratively reducing to fit byte cap. */
export const MIN_QUALITY = 0.6;

export interface CompressResult {
  /** May be the same File reference if no resize was needed. */
  file: File;
  /** True iff the canvas re-encode actually ran. */
  resized: boolean;
  /** Original width/height in pixels (after decode). */
  originalDims: { w: number; h: number };
}

/**
 * Decide the linear scale factor to apply so that (W × H) × scale² ≤ maxMP.
 * Returns 1 when the image is already small enough.
 */
export function computeScale(w: number, h: number, maxMP: number = DEFAULT_MAX_MP): number {
  if (!Number.isFinite(w) || !Number.isFinite(h) || w <= 0 || h <= 0) return 1;
  if (!Number.isFinite(maxMP) || maxMP <= 0) return 1;
  const pixels = w * h;
  const limit = maxMP * 1_000_000;
  if (pixels <= limit) return 1;
  return Math.sqrt(limit / pixels);
}

/** True when the file's MIME type starts with `image/`. */
export function isImageFile(file: File): boolean {
  return typeof file?.type === 'string' && file.type.startsWith('image/');
}

/**
 * Compress a File if it exceeds maxMP megapixels. Returns the original File
 * unchanged when:
 *   - input is not an image (`image/*`)
 *   - input already fits in maxMP
 *   - the canvas/ImageBitmap APIs are unavailable (older browsers, SSR)
 *
 * Throws on a non-File input — callers should never feed this anything else.
 */
export async function compressIfLarge(
  file: File,
  maxMP: number = DEFAULT_MAX_MP,
  quality: number = DEFAULT_QUALITY,
  maxBytes: number = DEFAULT_MAX_BYTES,
): Promise<CompressResult> {
  if (!(file instanceof File)) {
    throw new TypeError('compressIfLarge: expected a File');
  }
  if (!isImageFile(file)) {
    throw new TypeError(`compressIfLarge: expected image/*, got ${file.type || 'unknown'}`);
  }
  if (typeof createImageBitmap !== 'function') {
    return { file, resized: false, originalDims: { w: 0, h: 0 } };
  }

  let bitmap: ImageBitmap;
  try {
    bitmap = await createImageBitmap(file);
  } catch {
    return { file, resized: false, originalDims: { w: 0, h: 0 } };
  }
  const w = bitmap.width;
  const h = bitmap.height;
  const scale = computeScale(w, h, maxMP);
  const needsResize = scale < 1;
  const overByteCap = file.size > maxBytes;

  if (!needsResize && !overByteCap) {
    bitmap.close?.();
    return { file, resized: false, originalDims: { w, h } };
  }

  const targetW = needsResize ? Math.max(1, Math.round(w * scale)) : w;
  const targetH = needsResize ? Math.max(1, Math.round(h * scale)) : h;

  // Iteratively drop quality until we're under the byte cap, but never
  // below MIN_QUALITY (preserves visible detail for AI identification).
  let q = quality;
  let blob: Blob | null = null;
  for (let i = 0; i < 5; i++) {
    blob = await drawAndEncode(bitmap, targetW, targetH, q);
    if (!blob) break;
    if (blob.size <= maxBytes) break;
    if (q <= MIN_QUALITY) break;
    q = Math.max(MIN_QUALITY, q - 0.1);
  }
  bitmap.close?.();
  if (!blob) return { file, resized: false, originalDims: { w, h } };

  const newName = renameToJpeg(file.name);
  const newFile = new File([blob], newName, { type: 'image/jpeg', lastModified: file.lastModified });
  return { file: newFile, resized: true, originalDims: { w, h } };
}

function renameToJpeg(name: string): string {
  if (!name) return 'photo.jpg';
  const dot = name.lastIndexOf('.');
  if (dot < 0) return name + '.jpg';
  return name.slice(0, dot) + '.jpg';
}

async function drawAndEncode(
  bitmap: ImageBitmap,
  w: number,
  h: number,
  quality: number,
): Promise<Blob | null> {
  if (typeof OffscreenCanvas !== 'undefined') {
    try {
      const c = new OffscreenCanvas(w, h);
      const ctx = c.getContext('2d');
      if (!ctx) return null;
      ctx.drawImage(bitmap, 0, 0, w, h);
      return await c.convertToBlob({ type: 'image/jpeg', quality });
    } catch {
      /* fall through to DOM canvas */
    }
  }
  if (typeof document === 'undefined') return null;
  const c = document.createElement('canvas');
  c.width = w;
  c.height = h;
  const ctx = c.getContext('2d');
  if (!ctx) return null;
  ctx.drawImage(bitmap, 0, 0, w, h);
  return new Promise<Blob | null>((resolve) =>
    c.toBlob((b) => resolve(b), 'image/jpeg', quality),
  );
}
