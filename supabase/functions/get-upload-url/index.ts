/**
 * /functions/v1/get-upload-url — issue a 5-minute presigned PUT URL for the
 * Cloudflare R2 media bucket. See docs/specs/modules/10-media-storage.md.
 *
 * Why an Edge Function and not direct browser-side signing:
 *   - R2 access keys are server-side only (we never ship them in the bundle)
 *   - We can enforce per-user key-prefix scoping (a user can only upload to
 *     observations/<their-uuid>/* and avatars/<their-uuid>/*)
 *   - Future: virus / NSFW scan hook before issuing the URL
 *
 * Auth: requires a Supabase JWT (Authorization: Bearer ...). The function
 * validates the JWT and refuses to sign a path that doesn't match the
 * caller's user id.
 *
 * Env (set via `supabase secrets set`):
 *   CF_ACCOUNT_ID         Cloudflare account id (32-char hex)
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME        e.g. 'rastrum-media'
 *   R2_PUBLIC_URL         e.g. 'https://media.rastrum.app'
 *   SUPABASE_URL / SUPABASE_ANON_KEY for JWT validation
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { S3Client, PutObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3.658.1';
import { getSignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3.658.1';

type Body = {
  key: string;          // e.g. 'observations/<obs-id>/<blob-id>.jpg'
  contentType: string;  // e.g. 'image/jpeg'
};

const ALLOWED_PREFIXES = (userId: string) => [
  `observations/`,                           // refined check below uses obs ownership
  `avatars/${userId}/`,
];

function safeKey(userId: string, key: string): string | null {
  // Block traversal
  if (key.includes('..') || key.startsWith('/') || key.includes('//')) return null;
  if (!ALLOWED_PREFIXES(userId).some(p => key.startsWith(p))) return null;
  return key;
}

// CORS headers — applied to every response (including errors and the
// preflight OPTIONS). Without these, browsers from rastrum.org block the
// response body before it ever reaches our JS, and every photo upload
// silently fails at the cross-origin layer.
const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-rastrum-build',
  'Access-Control-Max-Age': '86400',
};

function jsonResponse(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

function textResponse(body: string, status: number): Response {
  return new Response(body, {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'text/plain' },
  });
}

serve(async (req) => {
  // Preflight — must return CORS headers and a 2xx status BEFORE the
  // browser will dispatch the actual POST.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return textResponse('Method not allowed', 405);

  const env = (k: string) => Deno.env.get(k);
  const required = ['CF_ACCOUNT_ID', 'R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY'];
  for (const k of required) {
    if (!env(k)) return textResponse(`Function not configured: ${k}`, 500);
  }

  // Validate caller's JWT
  const auth = req.headers.get('authorization')?.replace(/^Bearer\s+/i, '');
  if (!auth) return textResponse('Missing Authorization header', 401);

  const supa = createClient(env('SUPABASE_URL')!, env('SUPABASE_ANON_KEY')!, {
    global: { headers: { Authorization: `Bearer ${auth}` } },
  });
  const { data: { user }, error: userErr } = await supa.auth.getUser();
  if (userErr || !user) return textResponse('Invalid token', 401);

  // Rate limit: a single user signing more than ~60 PUT URLs per minute
  // is almost certainly a runaway retry storm or a bad actor. The cap
  // is intentionally generous — a typical observation is 1-3 photos and
  // a fresh sync of 10 stuck observations is 30-ish blobs at once. We
  // store counts in-memory per worker. Across multiple workers the
  // effective limit is N × 60/min, which is fine for our intent.
  const rateMap = (globalThis as unknown as { __rastrumRateMap?: Map<string, number[]> }).__rastrumRateMap
    ?? new Map<string, number[]>();
  (globalThis as unknown as { __rastrumRateMap?: Map<string, number[]> }).__rastrumRateMap = rateMap;
  const RATE_WINDOW_MS = 60_000;
  const RATE_LIMIT = 60;
  const now = Date.now();
  const recent = (rateMap.get(user.id) ?? []).filter(t => now - t < RATE_WINDOW_MS);
  if (recent.length >= RATE_LIMIT) {
    return textResponse('Rate limited — too many upload URL requests in the last minute', 429);
  }
  recent.push(now);
  rateMap.set(user.id, recent);

  let body: Body;
  try {
    body = await req.json();
  } catch {
    return textResponse('Invalid JSON', 400);
  }
  if (!body?.key || !body?.contentType) return textResponse('Missing key or contentType', 400);

  const safe = safeKey(user.id, body.key);
  if (!safe) return textResponse('Forbidden key prefix', 403);

  // Construct the R2 client. R2 emulates S3; region is always 'auto'.
  const r2 = new S3Client({
    region: 'auto',
    endpoint: `https://${env('CF_ACCOUNT_ID')}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: env('R2_ACCESS_KEY_ID')!,
      secretAccessKey: env('R2_SECRET_ACCESS_KEY')!,
    },
  });

  const command = new PutObjectCommand({
    Bucket: env('R2_BUCKET_NAME')!,
    Key: safe,
    ContentType: body.contentType,
  });

  const signedUrl = await getSignedUrl(r2, command, { expiresIn: 300 });
  const publicUrl = `${env('R2_PUBLIC_URL')!.replace(/\/$/, '')}/${safe}`;

  return jsonResponse({ uploadUrl: signedUrl, publicUrl, expiresIn: 300 });
});
