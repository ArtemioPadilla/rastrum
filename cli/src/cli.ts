/**
 * CLI entry point — orchestrates walker → exif → upload → observe.
 *
 * Pure-ish module so the entry-point script (`bin/rastrum-import.js`)
 * is a one-liner and the work can be unit-tested with mocks.
 */
import { readFile, stat } from 'node:fs/promises';
import { resolve } from 'node:path';
import { walkMedia, classifyExt, type MediaEntry } from './walker.js';
import { readExif } from './exif.js';
import { ApiClient, putBytes, type ApiClientOpts } from './api-client.js';
import { isAlreadyUploaded, loadLog, recordEntry, saveLog, summary, type ImportLog } from './log.js';

export interface RunOpts {
  /** Source directory (memory-card mount point). */
  dir: string;
  /** Path to the resumable log JSON. */
  logPath: string;
  /** Supabase Edge Function base URL. */
  baseUrl: string;
  /** rst_ token. */
  token: string;
  dryRun: boolean;
  skipIdentify: boolean;
  /** Notes string applied to every observation (e.g. station code). */
  notes?: string;
  /** Camera station tagging (M31 / issue #156). The CLI passes
   *  `(project_slug, station_key)` to `/api/observe`; the EF
   *  resolves the station UUID server-side under RLS. */
  projectSlug?: string;
  stationKey?: string;
  /** Print 1-line per file instead of just summary every 10. */
  verbose: boolean;
}

export interface RunResult {
  ok: boolean;
  log: ImportLog;
}

function ext2contentType(ext: string): string {
  if (ext === '.jpg' || ext === '.jpeg') return 'image/jpeg';
  if (ext === '.png') return 'image/png';
  if (ext === '.heic') return 'image/heic';
  if (ext === '.webp') return 'image/webp';
  return 'application/octet-stream';
}

function logLine(msg: string): void {
  process.stderr.write(`${msg}\n`);
}

async function processOne(
  entry: MediaEntry,
  opts: RunOpts,
  client: ApiClient,
  log: ImportLog,
): Promise<void> {
  if (entry.kind === 'video') {
    // CLI v1 doesn't process video — keep them in the log so re-runs skip.
    recordEntry(log, entry.path, { status: 'skipped', error: 'video not supported in v1' });
    if (opts.verbose) logLine(`SKIP   ${entry.path}  (video)`);
    return;
  }
  if (isAlreadyUploaded(log, entry.path)) {
    if (opts.verbose) logLine(`SKIP   ${entry.path}  (already uploaded)`);
    return;
  }

  let exif;
  try {
    exif = await readExif(entry.path);
  } catch (err) {
    recordEntry(log, entry.path, { status: 'failed', error: `exif: ${(err as Error).message}` });
    logLine(`FAIL   ${entry.path}  (exif: ${(err as Error).message})`);
    return;
  }

  if (opts.dryRun) {
    if (opts.verbose) logLine(`DRY    ${entry.path}  lat=${exif.lat ?? 'n/a'} lng=${exif.lng ?? 'n/a'} at=${exif.capturedAtIso ?? 'n/a'}`);
    return;
  }

  const ext = entry.ext.replace(/^\./, '');
  const contentType = ext2contentType(entry.ext);

  // 1. Get presigned URL.
  let presigned;
  try {
    presigned = await client.uploadUrl(ext, contentType);
  } catch (err) {
    recordEntry(log, entry.path, { status: 'failed', error: `upload-url: ${(err as Error).message}` });
    logLine(`FAIL   ${entry.path}  (upload-url: ${(err as Error).message})`);
    return;
  }

  // 2. PUT bytes.
  try {
    const bytes = await readFile(entry.path);
    await putBytes(presigned.upload_url, new Uint8Array(bytes), contentType);
  } catch (err) {
    recordEntry(log, entry.path, { status: 'failed', error: `put: ${(err as Error).message}` });
    logLine(`FAIL   ${entry.path}  (put: ${(err as Error).message})`);
    return;
  }

  // 3. Create observation. The auto-tagging trigger from M29 will set
  //    project_id when the lat/lng falls inside a registered polygon.
  let obsId: string | undefined;
  try {
    const obs = await client.observe({
      lat: exif.lat,
      lng: exif.lng,
      observed_at: exif.capturedAtIso,
      photo_url: presigned.public_url,
      notes: opts.notes,
      project_slug: opts.projectSlug,
      station_key: opts.stationKey,
    });
    obsId = obs.id;
  } catch (err) {
    recordEntry(log, entry.path, { status: 'failed', error: `observe: ${(err as Error).message}`, photo_url: presigned.public_url });
    logLine(`FAIL   ${entry.path}  (observe: ${(err as Error).message})`);
    return;
  }

  // 4. Optional identify pass.
  if (!opts.skipIdentify) {
    try {
      await client.identify({
        image_url: presigned.public_url,
        lat: exif.lat,
        lng: exif.lng,
      });
    } catch (err) {
      // Non-fatal — the observation already exists; the user can re-ID later.
      logLine(`WARN   ${entry.path}  (identify failed, continuing: ${(err as Error).message})`);
    }
  }

  recordEntry(log, entry.path, { status: 'uploaded', observation_id: obsId, photo_url: presigned.public_url });
  if (opts.verbose) logLine(`OK     ${entry.path}  obs=${obsId}`);
}

export async function run(opts: RunOpts): Promise<RunResult> {
  const root = resolve(opts.dir);
  const dirStat = await stat(root).catch(() => null);
  if (!dirStat?.isDirectory()) {
    throw new Error(`Not a directory: ${root}`);
  }

  const log = await loadLog(opts.logPath);
  const client = new ApiClient({ baseUrl: opts.baseUrl, token: opts.token });

  let nProcessed = 0;
  for await (const entry of walkMedia(root)) {
    if (!classifyExt(entry.ext)) continue;
    await processOne(entry, opts, client, log);
    nProcessed++;
    if (nProcessed % 10 === 0) {
      const s = summary(log);
      logLine(`[${nProcessed}] uploaded=${s.uploaded} failed=${s.failed} skipped=${s.skipped}`);
      // Persist progress so a Ctrl-C doesn't lose the last few entries.
      await saveLog(opts.logPath, log);
    }
  }

  await saveLog(opts.logPath, log);
  const final = summary(log);
  logLine(`DONE  total=${final.total} uploaded=${final.uploaded} failed=${final.failed} skipped=${final.skipped}`);
  return { ok: final.failed === 0, log };
}

export interface ParsedArgs extends RunOpts {}

/**
 * Parse argv. Throws on missing required args; returns parsed RunOpts.
 * Pure helper — exported for tests.
 */
export function parseArgs(argv: string[]): ParsedArgs {
  const args: Record<string, string | boolean> = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const next = argv[i + 1];
    if (!next || next.startsWith('--')) {
      args[key] = true;
    } else {
      args[key] = next;
      i++;
    }
  }
  const dir = String(args.dir ?? '');
  if (!dir) throw new Error('Missing --dir <path>');
  const baseUrl = String(args.baseUrl ?? args['base-url'] ?? process.env.RASTRUM_BASE_URL ?? '');
  if (!baseUrl) throw new Error('Missing --baseUrl <url> or RASTRUM_BASE_URL env');
  const token = String(args.token ?? process.env.RASTRUM_TOKEN ?? '');
  if (!token.startsWith('rst_')) throw new Error('Missing --token rst_… or RASTRUM_TOKEN env (must start with rst_)');
  const logPath = String(args.log ?? `${dir.replace(/\/$/, '')}/import-log.json`);
  const projectSlug = pickString(args, 'project-slug', 'projectSlug');
  const stationKey  = pickString(args, 'station-key',  'stationKey');
  if (stationKey && !projectSlug) {
    throw new Error('--station-key requires --project-slug (the EF resolves stations by project + key pair)');
  }
  return {
    dir,
    logPath,
    baseUrl,
    token,
    dryRun: args['dry-run'] === true || args.dryRun === true,
    skipIdentify: args['skip-identify'] === true || args.skipIdentify === true,
    notes: typeof args.notes === 'string' ? args.notes : undefined,
    projectSlug,
    stationKey,
    verbose: args.verbose === true || args.v === true,
  };
}

function pickString(args: Record<string, string | boolean>, ...keys: string[]): string | undefined {
  for (const k of keys) {
    const v = args[k];
    if (typeof v === 'string' && v.length > 0) return v;
  }
  return undefined;
}
