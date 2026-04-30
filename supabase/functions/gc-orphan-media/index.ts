/**
 * gc-orphan-media — nightly cron Edge Function
 *
 * Lists R2 objects under known prefixes, cross-checks against DB references,
 * and deletes orphan blobs older than MIN_AGE_DAYS (default 30).
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

// ── R2 S3-compatible helpers ──────────────────────────────────────────────────

/** Minimal AWS Sig-v4 for Cloudflare R2 (S3-compatible). */
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

    // Parse XML — minimal hand-rolled parser to avoid Deno XML deps
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

  // Prefixes to scan (og/ is whitelisted — cheap to regen, skip GC)
  const PREFIXES = ['observations/', 'avatars/'];

  const results: Array<{
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
      // 1. List all R2 objects under this prefix
      const objects = await listR2Objects(cfg, prefix);
      console.log(`gc-orphan-media: [${prefix}] found ${objects.length} objects`);

      // 2. Build referenced keys set from DB
      const referencedKeys = new Set<string>();

      if (prefix === 'observations/') {
        const { data: mediaRows } = await admin
          .from('media_files')
          .select('storage_key')
          .not('storage_key', 'is', null);
        for (const row of mediaRows ?? []) {
          if (row.storage_key) referencedKeys.add(row.storage_key);
        }
      } else if (prefix === 'avatars/') {
        const { data: userRows } = await admin
          .from('users')
          .select('avatar_url')
          .not('avatar_url', 'is', null);
        for (const row of userRows ?? []) {
          if (row.avatar_url) {
            // Extract the key from a full URL or bare key
            const match = row.avatar_url.match(/avatars\/[^?#]+/);
            if (match) referencedKeys.add(match[0]);
          }
        }
      }

      // 3. Process each object
      for (const obj of objects) {
        const isReferenced = referencedKeys.has(obj.key);
        const isTooNew = obj.lastModified > cutoff;

        if (isReferenced || isTooNew) {
          skipped++;
          continue;
        }

        // Orphan + old enough → delete
        if (dryRun) {
          console.log(`gc-orphan-media: [DRY RUN] would delete ${obj.key} (${obj.size} bytes, modified ${obj.lastModified.toISOString()})`);
          deleted++;
          bytesFreed += obj.size;
        } else {
          try {
            await deleteR2Object(cfg, obj.key);
            console.log(`gc-orphan-media: deleted ${obj.key} (${obj.size} bytes)`);
            deleted++;
            bytesFreed += obj.size;
          } catch (err) {
            const msg = (err as Error).message;
            console.error(`gc-orphan-media: failed to delete ${obj.key}: ${msg}`);
            errors.push(`${obj.key}: ${msg}`);
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
      results.push(prefixResult);

      // 4. Write log row to DB
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
      console.error(`gc-orphan-media: prefix ${prefix} failed: ${msg}`);
      results.push({
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

  const totalDeleted = results.reduce((s, r) => s + r.deleted, 0);
  const totalBytesFreed = results.reduce((s, r) => s + r.bytesFreed, 0);
  const totalErrors = results.reduce((s, r) => s + r.errors.length, 0);

  console.log(`gc-orphan-media: done — deleted=${totalDeleted} bytes_freed=${totalBytesFreed} errors=${totalErrors} duration=${Date.now() - startTime}ms`);

  return new Response(
    JSON.stringify({
      deleted: totalDeleted,
      skipped: results.reduce((s, r) => s + r.skipped, 0),
      bytesFreed: totalBytesFreed,
      errors: results.flatMap(r => r.errors),
      dryRun,
      results,
    }),
    { headers: { 'Content-Type': 'application/json' } },
  );
});
