/**
 * Recursive directory walker that yields image and video files.
 * Async generator so callers can stream-process huge memory cards
 * without loading every path into memory at once.
 */
import { readdir } from 'node:fs/promises';
import { join, extname } from 'node:path';

export const IMAGE_EXTS = new Set(['.jpg', '.jpeg', '.png', '.heic', '.webp']);
export const VIDEO_EXTS = new Set(['.mp4', '.mov', '.m4v']);

export type MediaKind = 'image' | 'video';

export interface MediaEntry {
  /** Absolute path on disk. */
  path: string;
  /** Lowercased extension WITH leading dot, e.g. `.jpg`. */
  ext: string;
  kind: MediaKind;
}

export function classifyExt(ext: string): MediaKind | null {
  const e = ext.toLowerCase();
  if (IMAGE_EXTS.has(e)) return 'image';
  if (VIDEO_EXTS.has(e)) return 'video';
  return null;
}

/**
 * Yield every image / video file under `root`, depth-first. Hidden
 * dotfiles and macOS `__MACOSX` / `.DS_Store` companions are skipped.
 */
export async function* walkMedia(root: string): AsyncGenerator<MediaEntry> {
  const entries = await readdir(root, { withFileTypes: true });
  for (const e of entries) {
    if (e.name.startsWith('.')) continue;
    if (e.name === '__MACOSX') continue;
    const full = join(root, e.name);
    if (e.isDirectory()) {
      yield* walkMedia(full);
      continue;
    }
    if (!e.isFile()) continue;
    const ext = extname(e.name).toLowerCase();
    const kind = classifyExt(ext);
    if (!kind) continue;
    yield { path: full, ext, kind };
  }
}
