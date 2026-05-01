/**
 * gc-orphan-media — nightly cron Edge Function
 *
 * Two-phase GC:
 *   Phase 1 — Soft-deleted media: queries media_files rows where
 *     deleted_at IS NOT NULL, deletes the corresponding R2 objects,
 *     then hard-deletes the DB rows (only when R2 delete succeeds).
 *   Phase 2 — Orphan blobs: lists R2 objects under known prefixes,
 *     cross-checks against DB references, and deletes orphan blobs
 *     older than MIN_AGE_DAYS (default 30).
 *
 * Deployed --no-verify-jwt (cron-only, no user-facing route).
 *
 * Env vars required:
 *   R2_ACCOUNT_ID        — Cloudflare account ID
 *   R2_ACCESS_KEY_ID     — R2 S3-compatible access key
 *   R2_SECRET_ACCESS_KEY — R2 S3-compatible secret key
 *   R2_BUCKET_NAME       — R2 bucket name
 *   SUPABASE_URL         — injected by Supabase
 *   SUPABASE_SERVICE_ROLE_KEY — injected by Supabase
 *
 * Optional kill-switch:
 *   GC_ORPHAN_MEDIA_DISABLED=true — skip all deletes (set in EF secrets)
 *   GC_DRY_RUN=true               — log but don't delete
 *   GC_MIN_AGE_DAYS               — override default 30-day safety window
 */

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

// ── Constants ─────────────────────────────────────────────────────────────────

const BATCH_SIZE = 50;
const MAX_RETRIES = 2;
const RETRY_DELAY_MS = 500;

// ── R2 S3-compatible helpers ──────────────────────────────────────────────────

async function hmacSha256(key: ArrayBuffer, data: string): Promise<ArrayBuffer> {
  const cryptoKey = await crypto.subtle.importKey('raw', key, { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  return crypto.subtle.sign('HMAC', cryptoKey, new TextEncoder().encode(data));
}
async function sha256Hex(data: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(data));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}
function toHex(buf: ArrayBuffer): string {
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

interface R2Config {
  accountId: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucketName: string;
}

async function r2SignedHeaders(
  cfg: R2Config,
  method: string,
  path: string,
  query: string,
  body = '',
): Promise<{ url: string; headers: Record<string, string> }> {
  const host = `${cfg.bucketName}.${cfg.accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}`;

  const now = new Date();
  const amzDate = now.toISOString().replace(/[-:]/g, '').replace(/\.\d+/, '');
  const dateStamp = amzDate.slice(0, 8);
  const region = 'auto';
  const service = 's3';

  const payloadHash = await sha256Hex(body);
  const canonicalHeaders = `host:${host}\nx-amz-content-sha256:${payloadHash}\nx-amz-date:${amzDate}\n`;
  const signedHeaders = 'host;x-amz-content-sha256;x-amz-date';

  const canonicalRequest = [method, path, query, canonicalHeaders, signedHeaders, payloadHash].join('\n');
  const credentialScope = `${dateStamp}/${region}/${service}/aws4_request`;
  const stringToSign = `AWS4-HMAC-SHA256\n${amzDate}\n${credentialScope}\n${await sha256Hex(canonicalRequest)}`;

  const enc = new TextEncoder();
  let key: ArrayBuffer = enc.encode(`AWS4${cfg.secretAccessKey}`).buffer as ArrayBuffer;
  for (const msg of [dateStamp, region, service, 'aws4_request']) {
    key = await hmacSha256(key, msg);
  }
  const sig = toHex(await hmacSha256(key, stringToSign));
  const auth = `AWS4-HMAC-SHA256 Credential=${cfg.accessKeyId}/${credentialScope}, SignedHeaders=${signedHeaders}, Signature=${sig}`;

  const url = `${endpoint}${path}${query ? '?' + query : ''}`;
  return {
    url,
    headers: {
      'Authorization': auth,
      'x-amz-date': amzDate,
      'x-amz-content-sha256': payloadHash,
      'Host': host,
    },
  };
}

interface R2Object {
  key: string;
  lastModified: Date;
  size: number;
}

async function listR2Objects(cfg: R2Config, prefix: string): Promise<R2Object[]> {
  const objects: R2Object[] = [];
  let continuationToken: string | null = null;

  do {
    const queryParams: Record<string, string> = {
      'list-type': '2',
      prefix,
      'max-keys': '1000',
    };
    if (continuationToken) queryParams['continuation-token'] = continuationToken;
    const query = Object.entries(queryParams).map(([k, v]) => `${encodeURIComponent(k)}=${encodeURIComponent(v)}`).join('&');

    const { url, headers } = await r2SignedHeaders(cfg, 'GET', '/', query);
    const res = await fetch(url, { headers });
    if (!res.ok) {
      const body = await res.text();
      throw new Error(`R2 list failed (${res.status}): ${body}`);
    }
    const xml = await res.text();

    const keys = [...xml.matchAll(/<Key>([^<]+)<\/Key>/g)].map(m => m[1]);
    const sizes = [...xml.matchAll(/<Size>([^<]+)<\/Size>/g)].map(m => parseInt(m[1]));
    const dates = [...xml.matchAll(/<LastModified>([^<]+)<\/LastModified>/g)].map(m => m[1]);

    for (let i = 0; i < keys.length; i++) {
      objects.push({
        key: keys[i],
        lastModified: new Date(dates[i] ?? 0),
        size: sizes[i] ?? 0,
      });
    }

    const nextToken = xml.match(/<NextContinuationToken>([^<]+)<\/NextContinuationToken>/)?.[1];
    continuationToken = nextToken ?? null;
  } while (continuationToken);

  return objects;
}

async function deleteR2Object(cfg: R2Config, key: string): Promise<void> {
  const encodedKey = '/' + key.split('/').map(encodeURIComponent).join('/');
  const { url, headers } = await r2SignedHeaders(cfg, 'DELETE', encodedKey, '');
  const res = await fetch(url, { method: 'DELETE', headers });
  if (!res.ok && res.status !== 204) {
    const body = await res.text();
    throw new Error(`R2 delete failed for ${key} (${res.status}): ${body}`);
  }
}

/** Retry an R2 delete up to MAX_RETRIES times with a short delay. */
async function deleteR2ObjectWithRetry(cfg: R2Config, key: string): Promise<void> {
  let lastErr: Error | undefined;
  for (let attempt = 0; attempt <= MAX_RETRIES; attempt++) {
    try {
      await deleteR2Object(cfg, key);
      return;
    } catch (err) {
      lastErr = err as Error;
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS * (attempt + 1)));
      }
    }
  }
  throw lastErr;
}

// ── Helpers ───────────────────────────────────────────────────────────────────

/**
 * Extract the R2 object key from a media_files.url value.
 * URLs look like: https://media.rastrum.org/observations/<obs-id>/<blob-id>.jpg
 * The key is the path after the host: observations/<obs-id>/<blob-id>.jpg
 */
function r2KeyFromUrl(url: string): string | null {
  try {
    const parsed = new URL(url);
    // Strip leading slash from pathname
    const key = parsed.pathname.replace(/^\//, '');
    return key || null;
  } catch {
    // Bare key (no protocol) — return as-is if it looks like a path
    if (url.includes('/') && !url.startsWith('http')) return url;
    return null;
  }
}

/** Process an array in chunks of `size`. */
function chunk<T>(arr: T[], size: number): T[][] {
  const chunks: T[][] = [];
  for (let i = 0; i < arr.length; i += size) {
    chunks.push(arr.slice(i, i + size));
  }
  return chunks;
}

// ── Edge Function handler ─────────────────────────────────────────────────────

Deno.serve(async (_req) => {
  const startTime = Date.now();

  // Kill-switch
  if (Deno.env.get('GC_ORPHAN_MEDIA_DISABLED') === 'true') {
    console.log('gc-orphan-media: kill switch active, skipping');
    return new Response(JSON.stringify({ skipped: true, reason: 'kill_switch' }), {
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const dryRun = Deno.env.get('GC_DRY_RUN') === 'true';
  const minAgeDays = parseInt(Deno.env.get('GC_MIN_AGE_DAYS') ?? '30', 10);
  const minAgeMs = minAgeDays * 24 * 60 * 60 * 1000;
  const cutoff = new Date(Date.now() - minAgeMs);

  const cfg: R2Config = {
    accountId:       Deno.env.get('R2_ACCOUNT_ID') ?? '',
    accessKeyId:     Deno.env.get('R2_ACCESS_KEY_ID') ?? '',
    secretAccessKey: Deno.env.get('R2_SECRET_ACCESS_KEY') ?? '',
    bucketName:      Deno.env.get('R2_BUCKET_NAME') ?? '',
  };

  if (!cfg.accountId || !cfg.accessKeyId || !cfg.secretAccessKey || !cfg.bucketName) {
    return new Response(JSON.stringify({ error: 'Missing R2 env vars' }), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  const admin = createClient(
    Deno.env.get('SUPABASE_URL') ?? '',
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? '',
  );

  // ── Phase 1: Soft-deleted media_files ─────────────────────────────────────
  // Query rows where deleted_at IS NOT NULL, delete R2 objects, then
  // hard-delete the DB rows. Only hard-delete when R2 succeeds — if R2
  // fails, the row stays so the next run retries.

  const softDeleteResult = {
    found: 0,
    r2Deleted: 0,
    rowsHardDeleted: 0,
    bytesFreed: 0,
    errors: [] as string[],
    durationMs: 0,
  };

  const phase1Start = Date.now();
  try {
    const { data: softDeleted, error: queryErr } = await admin
      .from('media_files')
      .select('id, url, file_size_bytes, deleted_at')
      .not('deleted_at', 'is', null)
      .order('deleted_at', { ascending: true })
      .limit(500);

    if (queryErr) throw new Error(`soft-delete query failed: ${queryErr.message}`);

    const rows = softDeleted ?? [];
    softDeleteResult.found = rows.length;
    console.log(`gc-orphan-media: [phase1] found ${rows.length} soft-deleted media_files`);

    const batches = chunk(rows, BATCH_SIZE);
    for (const batch of batches) {
      const hardDeleteIds: string[] = [];

      for (const row of batch) {
        const key = r2KeyFromUrl(row.url);
        if (!key) {
          console.warn(`gc-orphan-media: [phase1] cannot extract R2 key from url: ${row.url}`);
          softDeleteResult.errors.push(`bad_url:${row.id}`);
          continue;
        }

        if (dryRun) {
          console.log(`gc-orphan-media: [phase1][DRY RUN] would delete R2 key=${key} media_id=${row.id}`);
          softDeleteResult.r2Deleted++;
          softDeleteResult.bytesFreed += row.file_size_bytes ?? 0;
          hardDeleteIds.push(row.id);
          continue;
        }

        try {
          await deleteR2ObjectWithRetry(cfg, key);
          console.log(`gc-orphan-media: [phase1] deleted R2 key=${key} media_id=${row.id} (${row.file_size_bytes ?? 0} bytes)`);
          softDeleteResult.r2Deleted++;
          softDeleteResult.bytesFreed += row.file_size_bytes ?? 0;
          hardDeleteIds.push(row.id);
        } catch (err) {
          const msg = (err as Error).message;
          console.error(`gc-orphan-media: [phase1] R2 delete failed for ${key} (media_id=${row.id}), skipping hard-delete: ${msg}`);
          softDeleteResult.errors.push(`${row.id}:${msg}`);
          // Do NOT hard-delete — next run will retry
        }
      }

      // Hard-delete only the rows whose R2 objects were successfully removed
      if (hardDeleteIds.length > 0 && !dryRun) {
        const { error: delErr, count } = await admin
          .from('media_files')
          .delete({ count: 'exact' })
          .in('id', hardDeleteIds);
        if (delErr) {
          console.error(`gc-orphan-media: [phase1] hard-delete failed: ${delErr.message}`);
          softDeleteResult.errors.push(`hard_delete:${delErr.message}`);
        } else {
          softDeleteResult.rowsHardDeleted += count ?? hardDeleteIds.length;
        }
      } else if (dryRun && hardDeleteIds.length > 0) {
        console.log(`gc-orphan-media: [phase1][DRY RUN] would hard-delete ${hardDeleteIds.length} media_files rows`);
        softDeleteResult.rowsHardDeleted += hardDeleteIds.length;
      }
    }
  } catch (err) {
    const msg = (err as Error).message;
    console.error(`gc-orphan-media: [phase1] failed: ${msg}`);
    softDeleteResult.errors.push(msg);
  }
  softDeleteResult.durationMs = Date.now() - phase1Start;

  // Write phase 1 audit log
  await admin.from('gc_orphan_media_log').insert({
    prefix: 'soft-deleted',
    scanned: softDeleteResult.found,
    deleted: softDeleteResult.rowsHardDeleted,
    bytes_freed: softDeleteResult.bytesFreed,
    errors: softDeleteResult.errors.length,
    duration_ms: softDeleteResult.durationMs,
    notes: dryRun ? 'dry_run=true' : null,
  }).then(({ error }) => {
    if (error) console.warn(`gc-orphan-media: audit log insert failed: ${error.message}`);
  });

  // ── Phase 2: Orphan R2 blobs ──────────────────────────────────────────────
  // Prefixes to scan (og/ is whitelisted — cheap to regen, skip GC)
  const PREFIXES = ['observations/', 'avatars/'];

  const orphanResults: Array<{
    prefix: string;
    scanned: number;
    deleted: number;
    skipped: number;
    bytesFreed: number;
    errors: string[];
    durationMs: number;
  }> = [];

  for (const prefix of PREFIXES) {
    const prefixStart = Date.now();
    let deleted = 0;
    let skipped = 0;
    let bytesFreed = 0;
    const errors: string[] = [];

    try {
      const objects = await listR2Objects(cfg, prefix);
      console.log(`gc-orphan-media: [phase2][${prefix}] found ${objects.length} objects`);

      // Build referenced keys set from DB — only include non-deleted rows
      const referencedKeys = new Set<string>();

      if (prefix === 'observations/') {
        const { data: mediaRows } = await admin
          .from('media_files')
          .select('url')
          .is('deleted_at', null)
          .not('url', 'is', null);
        for (const row of mediaRows ?? []) {
          if (row.url) {
            const key = r2KeyFromUrl(row.url);
            if (key) referencedKeys.add(key);
          }
        }
      } else if (prefix === 'avatars/') {
        const { data: userRows } = await admin
          .from('users')
          .select('avatar_url')
          .not('avatar_url', 'is', null);
        for (const row of userRows ?? []) {
          if (row.avatar_url) {
            const match = row.avatar_url.match(/avatars\/[^?#]+/);
            if (match) referencedKeys.add(match[0]);
          }
        }
      }

      // Process in batches
      const objectBatches = chunk(objects, BATCH_SIZE);
      for (const batch of objectBatches) {
        for (const obj of batch) {
          const isReferenced = referencedKeys.has(obj.key);
          const isTooNew = obj.lastModified > cutoff;

          if (isReferenced || isTooNew) {
            skipped++;
            continue;
          }

          if (dryRun) {
            console.log(`gc-orphan-media: [phase2][DRY RUN] would delete ${obj.key} (${obj.size} bytes, modified ${obj.lastModified.toISOString()})`);
            deleted++;
            bytesFreed += obj.size;
          } else {
            try {
              await deleteR2ObjectWithRetry(cfg, obj.key);
              console.log(`gc-orphan-media: [phase2] deleted ${obj.key} (${obj.size} bytes)`);
              deleted++;
              bytesFreed += obj.size;
            } catch (err) {
              const msg = (err as Error).message;
              console.error(`gc-orphan-media: [phase2] failed to delete ${obj.key}: ${msg}`);
              errors.push(`${obj.key}: ${msg}`);
            }
          }
        }
      }

      const prefixResult = {
        prefix,
        scanned: objects.length,
        deleted,
        skipped,
        bytesFreed,
        errors,
        durationMs: Date.now() - prefixStart,
      };
      orphanResults.push(prefixResult);

      await admin.from('gc_orphan_media_log').insert({
        prefix,
        scanned: objects.length,
        deleted,
        bytes_freed: bytesFreed,
        errors: errors.length,
        duration_ms: prefixResult.durationMs,
        notes: dryRun ? 'dry_run=true' : null,
      });

    } catch (err) {
      const msg = (err as Error).message;
      console.error(`gc-orphan-media: [phase2] prefix ${prefix} failed: ${msg}`);
      orphanResults.push({
        prefix,
        scanned: 0,
        deleted: 0,
        skipped: 0,
        bytesFreed: 0,
        errors: [msg],
        durationMs: Date.now() - prefixStart,
      });
    }
  }

  // ── Summary ───────────────────────────────────────────────────────────────

  const totalDeleted = softDeleteResult.rowsHardDeleted + orphanResults.reduce((s, r) => s + r.deleted, 0);
  const totalBytesFreed = softDeleteResult.bytesFreed + orphanResults.reduce((s, r) => s + r.bytesFreed, 0);
  const totalErrors = softDeleteResult.errors.length + orphanResults.reduce((s, r) => s + r.errors.length, 0);

  console.log(
    `gc-orphan-media: done — phase1_deleted=${softDeleteResult.rowsHardDeleted} phase2_deleted=${orphanResults.reduce((s, r) => s + r.deleted, 0)} bytes_freed=${totalBytesFreed} errors=${totalErrors} duration=${Date.now() - startTime}ms`,
  );

  return new Response(
    JSON.stringify({
      deleted: totalDeleted,
      bytesFreed: totalBytesFreed,
      errors: [
        ...softDeleteResult.errors,
        ...orphanResults.flatMap(r => r.errors),
      ],
      dryRun,
      softDeleted: {
        found: softDeleteResult.found,
        r2Deleted: softDeleteResult.r2Deleted,
        rowsHardDeleted: softDeleteResult.rowsHardDeleted,
        bytesFreed: softDeleteResult.bytesFreed,
        errors: softDeleteResult.errors,
        durationMs: softDeleteResult.durationMs,
      },
      orphans: orphanResults,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
