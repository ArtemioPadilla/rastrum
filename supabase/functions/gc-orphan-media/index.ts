/**
 * gc-orphan-media — Nightly cron that removes R2 blobs with no corresponding
 * DB reference. Closes the "R2 grows monotonically" gap documented in
 * delete-photo/index.ts:25.
 *
 * Invoked by Supabase cron (pg_cron) — no JWT required (--no-verify-jwt).
 * A CRON_SECRET env var is checked instead to prevent external invocation.
 *
 * Environment variables required:
 *   CRON_SECRET            Shared secret asserted in the cron job's HTTP request
 *   R2_ENDPOINT_URL        e.g. https://<account_id>.r2.cloudflarestorage.com
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME
 *   R2_PUBLIC_URL          e.g. https://media.rastrum.app  (used to strip prefix)
 *   SUPABASE_URL
 *   SUPABASE_SERVICE_ROLE_KEY  (service role to bypass RLS for DB reads)
 *
 * Kill switch: set env var GC_ORPHAN_MEDIA_DISABLED=true to skip all deletions
 * (scan still runs and logs, but no blobs are deleted).
 *
 * Safety window: only objects older than MIN_AGE_DAYS (default 30) are candidates.
 * In-flight uploads that haven't yet been committed to media_files are protected.
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.49.2';
import {
  S3Client,
  ListObjectsV2Command,
  DeleteObjectCommand,
  HeadObjectCommand,
} from 'https://esm.sh/@aws-sdk/client-s3@3.590.0';

const env = (k: string, required = true): string => {
  const v = Deno.env.get(k);
  if (!v && required) throw new Error(`Missing required env: ${k}`);
  return v ?? '';
};

const PREFIXES = ['observations/', 'avatars/'];
// OG cards are cheap to regenerate and constantly updated — skip them.
const SKIP_PREFIXES = ['og/'];

const MIN_AGE_DAYS = parseInt(Deno.env.get('GC_MIN_AGE_DAYS') ?? '30', 10);
const DRY_RUN = Deno.env.get('GC_DRY_RUN') === 'true';
const DISABLED = Deno.env.get('GC_ORPHAN_MEDIA_DISABLED') === 'true';

Deno.serve(async (req) => {
  // Auth check
  const secret = env('CRON_SECRET', false);
  if (secret && req.headers.get('x-cron-secret') !== secret) {
    return new Response('Unauthorized', { status: 401 });
  }

  const startMs = Date.now();
  const supabase = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'));

  const r2Endpoint = env('R2_ENDPOINT_URL', false)
    || `https://${env('CF_ACCOUNT_ID', false)}.r2.cloudflarestorage.com`;
  const s3 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
    credentials: {
      accessKeyId:     env('R2_ACCESS_KEY_ID'),
      secretAccessKey: env('R2_SECRET_ACCESS_KEY'),
    },
  });
  const bucket    = env('R2_BUCKET_NAME');
  const publicUrl = env('R2_PUBLIC_URL').replace(/\/$/, '');

  // Build set of referenced keys from DB
  const referencedKeys = new Set<string>();

  const toKey = (url: string | null | undefined): string | null => {
    if (!url) return null;
    try {
      const u = new URL(url);
      return u.pathname.replace(/^\//, '');
    } catch { return null; }
  };

  // media_files (non-deleted)
  const { data: mediaRows } = await supabase
    .from('media_files')
    .select('url, thumbnail_url')
    .is('deleted_at', null);

  for (const m of mediaRows ?? []) {
    const k = toKey(m.url); if (k) referencedKeys.add(k);
    const t = toKey(m.thumbnail_url); if (t) referencedKeys.add(t);
  }

  // user avatars
  const { data: avatarRows } = await supabase
    .from('users')
    .select('avatar_url')
    .not('avatar_url', 'is', null);

  for (const u of avatarRows ?? []) {
    const k = toKey(u.avatar_url); if (k) referencedKeys.add(k);
  }

  const cutoffMs = Date.now() - MIN_AGE_DAYS * 86_400_000;
  const summary: Array<{ prefix: string; scanned: number; deleted: number; bytes_freed: number; errors: number }> = [];

  for (const prefix of PREFIXES) {
    let scanned = 0, deleted = 0, bytes_freed = 0, errors = 0;
    let continuationToken: string | undefined;

    do {
      const list = await s3.send(new ListObjectsV2Command({
        Bucket: bucket,
        Prefix: prefix,
        ContinuationToken: continuationToken,
      }));

      for (const obj of list.Contents ?? []) {
        if (!obj.Key) continue;
        scanned++;

        // Skip if key is referenced in DB
        if (referencedKeys.has(obj.Key)) continue;

        // Skip if too recent (safety window)
        const lastModMs = obj.LastModified?.getTime() ?? Date.now();
        if (lastModMs > cutoffMs) continue;

        // Skip if in a whitelisted prefix
        if (SKIP_PREFIXES.some(sp => obj.Key!.startsWith(sp))) continue;

        const sizeBytes = obj.Size ?? 0;

        if (DISABLED || DRY_RUN) {
          console.log(`[gc-orphan-media] would delete: ${obj.Key} (${sizeBytes} bytes) dry=${DRY_RUN} disabled=${DISABLED}`);
          deleted++;
          bytes_freed += sizeBytes;
          continue;
        }

        try {
          await s3.send(new DeleteObjectCommand({ Bucket: bucket, Key: obj.Key }));
          deleted++;
          bytes_freed += sizeBytes;
          console.log(`[gc-orphan-media] deleted: ${obj.Key} (${sizeBytes} bytes)`);
        } catch (err) {
          errors++;
          console.error(`[gc-orphan-media] delete failed: ${obj.Key}`, err);
        }
      }

      continuationToken = list.IsTruncated ? list.NextContinuationToken : undefined;
    } while (continuationToken);

    summary.push({ prefix, scanned, deleted, bytes_freed, errors });
  }

  const durationMs = Date.now() - startMs;
  const totalScanned    = summary.reduce((s, r) => s + r.scanned, 0);
  const totalDeleted    = summary.reduce((s, r) => s + r.deleted, 0);
  const totalBytesFreed = summary.reduce((s, r) => s + r.bytes_freed, 0);
  const totalErrors     = summary.reduce((s, r) => s + r.errors, 0);

  // Log to gc_orphan_media_log for each prefix
  for (const row of summary) {
    await supabase.from('gc_orphan_media_log').insert({
      prefix:     row.prefix,
      scanned:    row.scanned,
      deleted:    row.deleted,
      bytes_freed: row.bytes_freed,
      errors:     row.errors,
      duration_ms: durationMs,
      notes:      DRY_RUN ? 'dry-run' : DISABLED ? 'disabled' : null,
    });
  }

  console.log(`[gc-orphan-media] done: scanned=${totalScanned} deleted=${totalDeleted} freed=${totalBytesFreed}B errors=${totalErrors} duration=${durationMs}ms`);

  return Response.json({
    ok: true,
    dry_run: DRY_RUN,
    disabled: DISABLED,
    scanned: totalScanned,
    deleted: totalDeleted,
    bytes_freed: totalBytesFreed,
    errors: totalErrors,
    duration_ms: durationMs,
    summary,
  });
});
