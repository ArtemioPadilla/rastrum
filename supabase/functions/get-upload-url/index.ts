/**
 * /functions/v1/get-upload-url — issue a 5-minute presigned PUT URL for the
 * Cloudflare R2 media bucket. See docs/specs/modules/10-media-storage.md.
 *
 * Why an Edge Function and not direct browser-side signing:
 *   - R2 access keys are server-side only (we never ship them in the bundle)
 *   - We can enforce per-user key scoping (a user can only upload to
 *     avatars/<their-uuid>/* and observation prefixes they own)
 *   - Future: virus / NSFW scan hook before issuing the URL
 *
 * Auth: requires a Supabase JWT (Authorization: Bearer ...). The function
 * validates the JWT and refuses to sign a path the caller doesn't own.
 *
 * Key shapes under observations/ (the segment after observations/ is NOT
 * always the user id — don't "simplify" this back to a userId prefix):
 *   - observations/<observation-id>/<blob-id>.<ext>  — PWA sync.ts +
 *     manage-panel.ts. Ownership is verified against observations.observer_id
 *     with the service role (RLS would hide other users' private rows and
 *     turn "not visible" into "allowed"). The PWA uploads media BEFORE
 *     upserting the observation row (sync.ts step 1 vs step 2), so an id
 *     with no row yet is allowed — client-generated v4 UUIDs are
 *     unguessable — unless it collides with another user's id (the
 *     /api/upload-url prefix shape below).
 *   - observations/<user-id>/<blob-id>.<ext>         — the api EF's
 *     /api/upload-url twin generates this shape server-side; here it is
 *     allowed only when the segment equals the caller's own id.
 *
 * Env (set via `supabase secrets set`):
 *   CF_ACCOUNT_ID         Cloudflare account id (32-char hex)
 *   R2_ACCESS_KEY_ID
 *   R2_SECRET_ACCESS_KEY
 *   R2_BUCKET_NAME        e.g. 'rastrum-media'
 *   R2_PUBLIC_URL         e.g. 'https://media.rastrum.app'
 *   SUPABASE_URL / SUPABASE_ANON_KEY for JWT validation
 *   SUPABASE_SERVICE_ROLE_KEY for the observation-ownership lookup
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { S3Client, PutObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3.658.1';
import { getSignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3.658.1';

type Body = {
  key: string;          // e.g. 'observations/<obs-id>/<blob-id>.jpg'
  contentType: string;  // e.g. 'image/jpeg'
};

const STATIC_PREFIXES = (userId: string) => [
  `avatars/${userId}/`,
  `og/`,                                     // pre-rendered OG cards (1200×630 PNG)
                                             //   og/<obs-id>.png (observation cards)
                                             //   og/u/<username>.png (profile cards)
];

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

function keyShapeOk(key: string): boolean {
  // Block traversal
  return !key.includes('..') && !key.startsWith('/') && !key.includes('//');
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

export async function handler(req: Request): Promise<Response> {
  // Preflight — must return CORS headers and a 2xx status BEFORE the
  // browser will dispatch the actual POST.
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return textResponse('Method not allowed', 405);

  const env = (k: string) => Deno.env.get(k);
  // Endpoint can be supplied directly via R2_ENDPOINT_URL or derived
  // from CF_ACCOUNT_ID. Accept either — the deploy workflow now syncs
  // both from GitHub Actions secrets.
  const r2Endpoint = env('R2_ENDPOINT_URL')
    ?? (env('CF_ACCOUNT_ID') ? `https://${env('CF_ACCOUNT_ID')}.r2.cloudflarestorage.com` : null);
  if (!r2Endpoint) return textResponse('Function not configured: R2_ENDPOINT_URL or CF_ACCOUNT_ID', 500);
  const required = ['R2_ACCESS_KEY_ID', 'R2_SECRET_ACCESS_KEY', 'R2_BUCKET_NAME', 'R2_PUBLIC_URL', 'SUPABASE_URL', 'SUPABASE_ANON_KEY', 'SUPABASE_SERVICE_ROLE_KEY'];
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

  if (!keyShapeOk(body.key)) return textResponse('Forbidden key prefix', 403);

  if (body.key.startsWith('observations/')) {
    const [, segment, ...rest] = body.key.split('/');
    if (!segment || !UUID_RE.test(segment) || rest.length === 0 || rest[rest.length - 1] === '') {
      return textResponse('Forbidden key prefix', 403);
    }
    if (segment !== user.id) {
      const svc = createClient(env('SUPABASE_URL')!, env('SUPABASE_SERVICE_ROLE_KEY')!);
      const { data: obsRow, error: obsErr } = await svc
        .from('observations')
        .select('observer_id')
        .eq('id', segment)
        .maybeSingle();
      if (obsErr) return textResponse('Ownership check failed', 500);
      if (obsRow) {
        if (obsRow.observer_id !== user.id) return textResponse('Forbidden key prefix', 403);
      } else {
        // Not-yet-synced observation id (see header comment) — allowed,
        // unless it is actually another user's id-prefix.
        const { data: userRow, error: userRowErr } = await svc
          .from('users')
          .select('id')
          .eq('id', segment)
          .maybeSingle();
        if (userRowErr) return textResponse('Ownership check failed', 500);
        if (userRow) return textResponse('Forbidden key prefix', 403);
      }
    }
  } else if (!STATIC_PREFIXES(user.id).some(p => body.key.startsWith(p))) {
    return textResponse('Forbidden key prefix', 403);
  }

  const safe = body.key;

  // Construct the R2 client. R2 emulates S3; region is always 'auto'.
  const r2 = new S3Client({
    region: 'auto',
    endpoint: r2Endpoint,
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
}

serve(handler);

// rastrum incident 2026-05-16: forced re-upload to recover from a
// Supabase Edge serving-layer drop (function ACTIVE in the control plane
// but 404 at the runtime; `supabase functions deploy` skipped unchanged
// bundles as a silent no-op). Behavior-neutral bundle-hash buster; safe to
// remove once Supabase confirms the platform root cause (support ticket).
;(globalThis as Record<string, unknown>).__rastrumRedeploy = "2026-05-16-serving-layer-recovery";
