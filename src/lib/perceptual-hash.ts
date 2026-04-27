/**
 * dHash perceptual hash for warning when the same photo is re-uploaded.
 *
 * Algorithm (classic dHash):
 *   1. Decode the image, downsample to 9 × 8 grayscale (72 pixels).
 *   2. For each row, compare each pair of adjacent pixels and emit a bit
 *      (left brighter than right → 1, else 0). 8 comparisons × 8 rows = 64
 *      bits. Encode as a 16-character hex string.
 *
 * The hex form is comparable via Hamming distance (count differing bits).
 * A distance of < 5 bits (out of 64) indicates the two photos are
 * near-identical — same scene, same crop, same rough lighting. A distance
 * of > 15 bits is "different photo entirely."
 *
 * Pure functions so tests can pass synthetic grayscale arrays without ever
 * touching a canvas. The DOM-side `hashFile()` wraps the pure path.
 */

const HASH_BITS = 64;
const W = 9;  // 9 columns so we get 8 horizontal differences per row
const H = 8;

/** Distance == bit count of XOR. Both inputs must be 16-char hex strings. */
export function hammingDistance(a: string, b: string): number {
  if (typeof a !== 'string' || typeof b !== 'string') return HASH_BITS;
  if (a.length !== b.length) return HASH_BITS;
  let bits = 0;
  for (let i = 0; i < a.length; i++) {
    const xa = parseInt(a[i], 16);
    const xb = parseInt(b[i], 16);
    if (Number.isNaN(xa) || Number.isNaN(xb)) return HASH_BITS;
    bits += popcount4(xa ^ xb);
  }
  return bits;
}

function popcount4(n: number): number {
  let c = 0;
  for (let i = 0; i < 4; i++) c += (n >> i) & 1;
  return c;
}

/**
 * Compute a dHash from a flat 9×8 grayscale buffer (length 72, values 0–255).
 * Pure — no DOM. Returns a 16-char hex string. Throws on malformed input so
 * callers can tell the difference between "blank photo" and "bad input".
 */
export function dHashFromGrayscale(gray: ArrayLike<number>): string {
  if (!gray || gray.length !== W * H) {
    throw new TypeError(`dHashFromGrayscale: expected length ${W * H}, got ${gray?.length ?? 0}`);
  }
  let bits = '';
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W - 1; x++) {
      const left  = gray[y * W + x];
      const right = gray[y * W + x + 1];
      bits += left > right ? '1' : '0';
    }
  }
  // Convert each 4-bit nibble to a hex digit.
  let hex = '';
  for (let i = 0; i < bits.length; i += 4) {
    hex += parseInt(bits.slice(i, i + 4), 2).toString(16);
  }
  return hex;
}

/**
 * Hash an image File. Returns a 16-char hex string. Throws if the input
 * isn't an image or createImageBitmap is unavailable in this environment.
 *
 * The function is forgiving with empty / unreadable inputs — those throw
 * a typed error so the caller can suppress the dedupe warning gracefully.
 */
export async function hashFile(file: File): Promise<string> {
  if (!(file instanceof File)) {
    throw new TypeError('hashFile: expected a File');
  }
  if (!file.type.startsWith('image/')) {
    throw new TypeError(`hashFile: expected image/*, got ${file.type || 'unknown'}`);
  }
  if (!file.size) {
    throw new TypeError('hashFile: empty file');
  }
  if (typeof createImageBitmap !== 'function') {
    throw new Error('hashFile: createImageBitmap unavailable');
  }
  const bitmap = await createImageBitmap(file);
  try {
    const gray = await rasterToGrayscale(bitmap, W, H);
    return dHashFromGrayscale(gray);
  } finally {
    bitmap.close?.();
  }
}

async function rasterToGrayscale(bitmap: ImageBitmap, w: number, h: number): Promise<Uint8ClampedArray> {
  let pixels: Uint8ClampedArray;
  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('hashFile: 2d context unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    pixels = ctx.getImageData(0, 0, w, h).data;
  } else if (typeof document !== 'undefined') {
    const c = document.createElement('canvas');
    c.width = w;
    c.height = h;
    const ctx = c.getContext('2d');
    if (!ctx) throw new Error('hashFile: 2d context unavailable');
    ctx.drawImage(bitmap, 0, 0, w, h);
    pixels = ctx.getImageData(0, 0, w, h).data;
  } else {
    throw new Error('hashFile: no canvas available');
  }
  // RGBA → 8-bit luminance using Rec. 601 coefficients.
  const out = new Uint8ClampedArray(w * h);
  for (let i = 0, j = 0; i < pixels.length; i += 4, j++) {
    out[j] = Math.round(0.299 * pixels[i] + 0.587 * pixels[i + 1] + 0.114 * pixels[i + 2]);
  }
  return out;
}
