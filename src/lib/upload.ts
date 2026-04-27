/**
 * Client-side media upload — see docs/specs/modules/10-media-storage.md.
 *
 * Flow:
 *   1. Resize the image client-side (saves storage + bandwidth)
 *   2. Ask the get-upload-url Edge Function for a 5-minute presigned PUT URL
 *   3. PUT directly to R2 (zero egress fees, served via Cloudflare CDN)
 *
 * Falls back to Supabase Storage when R2 isn't configured. The fallback path
 * is the same one the v0.1 sync engine has been using; the migration is
 * controlled by the presence of PUBLIC_R2_MEDIA_URL.
 */
import { getSupabase } from './supabase';

const R2_PUBLIC_URL = import.meta.env.PUBLIC_R2_MEDIA_URL;

/** Returns true when the build was made with R2 env vars set. */
export function r2Enabled(): boolean {
  return !!R2_PUBLIC_URL && R2_PUBLIC_URL.startsWith('http');
}

/**
 * Resize an image to the long-edge target. Uses OffscreenCanvas where
 * available (modern browsers + workers), falls back to a regular canvas.
 * Always re-encodes as JPEG q=0.85 — predictable size, broad CDN support.
 */
export async function resizeImage(
  file: File,
  opts: { maxLongEdge?: number; quality?: number } = {},
): Promise<Blob> {
  const maxLongEdge = opts.maxLongEdge ?? 1200;
  const quality = opts.quality ?? 0.85;

  const bitmap = await createImageBitmap(file);
  const long = Math.max(bitmap.width, bitmap.height);
  const scale = Math.min(1, maxLongEdge / long);
  const w = Math.round(bitmap.width * scale);
  const h = Math.round(bitmap.height * scale);

  if (typeof OffscreenCanvas !== 'undefined') {
    const c = new OffscreenCanvas(w, h);
    const ctx = c.getContext('2d')!;
    ctx.drawImage(bitmap, 0, 0, w, h);
    return c.convertToBlob({ type: 'image/jpeg', quality });
  }
  const c = document.createElement('canvas');
  c.width = w; c.height = h;
  c.getContext('2d')!.drawImage(bitmap, 0, 0, w, h);
  return new Promise<Blob>((resolve, reject) =>
    c.toBlob(b => b ? resolve(b) : reject(new Error('canvas blob failed')), 'image/jpeg', quality)
  );
}

interface PresignedResponse {
  uploadUrl: string;
  publicUrl: string;
  expiresIn: number;
}

export type UploadProgress = (loaded: number, total: number) => void;

export interface UploadOptions {
  /**
   * Fires repeatedly during the PUT — `loaded` and `total` are bytes.
   * Only the R2 path supports this today; the Supabase Storage SDK
   * doesn't expose a progress event, so it's a single 100% pulse on
   * completion.
   */
  onProgress?: UploadProgress;
}

/**
 * Upload a single media blob using the active backend (R2 if configured,
 * else Supabase Storage). Returns the resulting public URL.
 */
export async function uploadMedia(
  blob: Blob,
  key: string,
  contentType = 'image/jpeg',
  opts: UploadOptions = {},
): Promise<string> {
  if (r2Enabled()) {
    return uploadToR2(blob, key, contentType, opts);
  }
  return uploadToSupabaseStorage(blob, key, contentType, opts);
}

async function uploadToR2(
  blob: Blob,
  key: string,
  contentType: string,
  opts: UploadOptions,
): Promise<string> {
  const supabase = getSupabase();
  const { data: { session } } = await supabase.auth.getSession();
  if (!session) throw new Error('Not signed in — cannot upload to R2');

  const { data, error } = await supabase.functions.invoke<PresignedResponse>('get-upload-url', {
    body: { key, contentType },
  });
  if (error || !data) throw error ?? new Error('Failed to get presigned URL');

  // XHR over fetch so we can emit upload progress events. fetch() in browsers
  // gives no insight into PUT-body progress (the streams API workaround is
  // not yet broadly supported), and a frozen spinner on a 12 MP photo over
  // a slow Telcel connection looks identical to a hung app.
  await xhrPut(data.uploadUrl, blob, contentType, opts.onProgress);
  return data.publicUrl;
}

function xhrPut(
  url: string,
  blob: Blob,
  contentType: string,
  onProgress?: UploadProgress,
): Promise<void> {
  return new Promise((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open('PUT', url, true);
    xhr.setRequestHeader('Content-Type', contentType);
    if (onProgress) {
      xhr.upload.addEventListener('progress', (ev) => {
        if (ev.lengthComputable) onProgress(ev.loaded, ev.total);
      });
    }
    xhr.addEventListener('load', () => {
      if (xhr.status >= 200 && xhr.status < 300) {
        if (onProgress) onProgress(blob.size, blob.size);
        resolve();
      } else {
        reject(new Error(`R2 upload failed: ${xhr.status} ${xhr.statusText}`));
      }
    });
    xhr.addEventListener('error', () => reject(new Error('R2 upload network error')));
    xhr.addEventListener('abort', () => reject(new Error('R2 upload aborted')));
    xhr.send(blob);
  });
}

async function uploadToSupabaseStorage(
  blob: Blob,
  key: string,
  contentType: string,
  opts: UploadOptions,
): Promise<string> {
  const supabase = getSupabase();
  const { error } = await supabase.storage
    .from('media')
    .upload(key, blob, { contentType, upsert: true });
  if (error) throw error;
  if (opts.onProgress) opts.onProgress(blob.size, blob.size);
  const { data } = supabase.storage.from('media').getPublicUrl(key);
  return data.publicUrl;
}
