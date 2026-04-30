/**
 * Resumable import log — a JSON file that records the result of each
 * file we attempted to upload. Re-running the import on the same
 * directory skips files already present here.
 *
 * Format: one object per file path. Match key is the absolute path so
 * re-running with a different `--dir` (e.g. moved SD card) creates a
 * fresh log without collision.
 */
import { readFile, writeFile } from 'node:fs/promises';
import { existsSync } from 'node:fs';

export type LogStatus = 'uploaded' | 'failed' | 'skipped';

export interface LogEntry {
  status: LogStatus;
  /** ISO timestamp of when this entry was written. */
  at: string;
  /** Server-issued observation id, when status === 'uploaded'. */
  observation_id?: string;
  /** Public URL of the uploaded photo, when status === 'uploaded'. */
  photo_url?: string;
  /** Error message, when status === 'failed'. */
  error?: string;
}

export interface ImportLog {
  /** Absolute paths → entries. */
  entries: Record<string, LogEntry>;
  /** ISO timestamp of last save (for diagnostics). */
  last_saved_at: string;
  /** Schema version for forward-compat. */
  version: 1;
}

export async function loadLog(path: string): Promise<ImportLog> {
  if (!existsSync(path)) {
    return { entries: {}, last_saved_at: new Date().toISOString(), version: 1 };
  }
  try {
    const raw = await readFile(path, 'utf8');
    const parsed = JSON.parse(raw);
    if (parsed?.version !== 1 || !parsed?.entries) {
      throw new Error('Unrecognised log format');
    }
    return parsed as ImportLog;
  } catch (err) {
    throw new Error(`Failed to read log at ${path}: ${(err as Error).message}`);
  }
}

export async function saveLog(path: string, log: ImportLog): Promise<void> {
  log.last_saved_at = new Date().toISOString();
  await writeFile(path, JSON.stringify(log, null, 2));
}

export function recordEntry(log: ImportLog, key: string, entry: Omit<LogEntry, 'at'>): void {
  log.entries[key] = { ...entry, at: new Date().toISOString() };
}

export function isAlreadyUploaded(log: ImportLog, key: string): boolean {
  return log.entries[key]?.status === 'uploaded';
}

export function summary(log: ImportLog): { uploaded: number; failed: number; skipped: number; total: number } {
  let uploaded = 0, failed = 0, skipped = 0;
  for (const e of Object.values(log.entries)) {
    if (e.status === 'uploaded') uploaded++;
    else if (e.status === 'failed') failed++;
    else if (e.status === 'skipped') skipped++;
  }
  return { uploaded, failed, skipped, total: uploaded + failed + skipped };
}
