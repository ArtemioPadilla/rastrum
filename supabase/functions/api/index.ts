/**
 * /functions/v1/api/* — REST API authenticated via personal API tokens (rst_xxxx).
 *
 * POST /api/observe       → submit observation (scope: observe)
 * POST /api/identify      → photo ID cascade (scope: identify)
 * POST /api/upload-url    → presigned R2 PUT URL for batch CLI (scope: observe)
 * GET  /api/observations  → list own observations (scope: observe)
 * GET  /api/export        → export Darwin Core CSV (scope: export)
 *
 * See docs/specs/modules/14-user-api-tokens.md
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { S3Client, PutObjectCommand } from 'https://esm.sh/@aws-sdk/client-s3@3.658.1';
import { getSignedUrl } from 'https://esm.sh/@aws-sdk/s3-request-presigner@3.658.1';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyToken(
  token: string,
  requiredScope: string,
  supabase: ReturnType<typeof createClient>
): Promise<{ user_id: string; scopes: string[] } | null> {
  const hash = await sha256(token);

  const { data, error } = await supabase
    .from('user_api_tokens')
    .select('id, user_id, scopes, expires_at')
    .eq('token_hash', hash)
    .is('revoked_at', null)
    .maybeSingle();

  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  if (!Array.isArray(data.scopes) || !data.scopes.includes(requiredScope)) return null;

  // Update last_used_at — fire and forget
  supabase.from('user_api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return { user_id: data.user_id, scopes: data.scopes };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token?.startsWith('rst_')) {
    return json({ error: 'Missing or invalid API token. Use: Authorization: Bearer rst_...' }, 401);
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/api/')[1] ?? '';

  // ── POST /api/observe ────────────────────────────────────────────────────
  if (req.method === 'POST' && path === 'observe') {
    const auth = await verifyToken(token, 'observe', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);

    const { lat, lng, observed_at, notes, photo_url, habitat, evidence_type = 'direct_sighting',
            camera_station_id, project_slug } = body;
    if (lat == null || lng == null) return json({ error: 'lat and lng are required' }, 400);

    // M31 v1.1 (#156): resolve a camera station explicitly by UUID,
    // or by (project_slug, station_key) — the second form is what the
    // CLI uses so the importer doesn't need to know the UUIDs ahead
    // of time. RLS gates the lookup; if the caller can't see the
    // station, we silently drop the assignment instead of leaking the
    // existence of a private station.
    let resolvedStationId: string | null = null;
    if (typeof camera_station_id === 'string' && camera_station_id.length > 0) {
      const { data: stationRow } = await supabase
        .from('camera_stations')
        .select('id')
        .eq('id', camera_station_id)
        .maybeSingle();
      resolvedStationId = (stationRow as { id?: string } | null)?.id ?? null;
    } else if (typeof project_slug === 'string' && typeof body.station_key === 'string') {
      const { data: stationRow } = await supabase
        .from('camera_stations')
        .select('id, project_id, projects!inner(slug)')
        .eq('station_key', body.station_key)
        .eq('projects.slug', project_slug)
        .maybeSingle();
      resolvedStationId = (stationRow as { id?: string } | null)?.id ?? null;
    }

    // observations table has no scientific_name — insert bare observation,
    // then create an identification row if a name was supplied.
    const { data: obs, error: obsErr } = await supabase
      .from('observations')
      .insert({
        observer_id: auth.user_id,
        // PostGIS geography: SRID=4326;POINT(lng lat)
        location: `SRID=4326;POINT(${lng} ${lat})`,
        observed_at: observed_at ?? new Date().toISOString(),
        notes,
        habitat,
        evidence_type,
        camera_station_id: resolvedStationId,
        app_version: 'api/v1',
        sync_status: 'synced',
      })
      .select('id, observed_at, created_at, camera_station_id')
      .single();

    if (obsErr) return json({ error: obsErr.message }, 500);

    // Attach identification if scientific_name provided
    if (body.scientific_name && obs?.id) {
      await supabase.from('identifications').insert({
        observation_id: obs.id,
        identifier_id: auth.user_id,
        scientific_name: body.scientific_name,
        id_source: 'human',
        confidence: 1.0,
      });
    }

    // Attach photo if provided
    if (photo_url && obs?.id) {
      await supabase.from('media_files').insert({
        observation_id: obs.id,
        url: photo_url,
        media_type: 'photo',
        is_primary: true,
      });
    }

    return json(obs, 201);
  }

  // ── POST /api/identify ───────────────────────────────────────────────────
  if (req.method === 'POST' && path === 'identify') {
    const auth = await verifyToken(token, 'identify', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const body = await req.json().catch(() => null);
    if (!body?.image_url) return json({ error: 'image_url is required' }, 400);

    const identifyRes = await fetch(
      `${Deno.env.get('SUPABASE_URL')}/functions/v1/identify`,
      {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify({
          image_url: body.image_url,
          observation_id: body.observation_id ?? 'cascade-only',
          location: body.lat != null ? { lat: body.lat, lng: body.lng } : undefined,
          user_hint: body.user_hint,
        }),
      }
    );

    const result = await identifyRes.json();
    // #591: opt-in cascade_attempts. Default response stays small (winner
    // only); pass ?include_trace=true for the full per-provider trace.
    const includeTrace = url.searchParams.get('include_trace') === 'true';
    if (!includeTrace && result && typeof result === 'object') {
      delete (result as Record<string, unknown>).cascade_attempts;
    }
    return json(result, identifyRes.status);
  }

  // ── POST /api/upload-url ──────────────────────────────────────────────────
  // Issues a 5-minute presigned R2 PUT URL for the batch CLI (issue #110).
  // The mobile UI uses /functions/v1/get-upload-url with a Supabase JWT;
  // the CLI uses an `rst_` token, which that endpoint doesn't accept,
  // so this is the token-friendly twin.
  if (req.method === 'POST' && path === 'upload-url') {
    const auth = await verifyToken(token, 'observe', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);
    const ext = String(body.ext ?? 'jpg').toLowerCase().replace(/[^a-z0-9]/g, '');
    if (!['jpg','jpeg','png','heic','webp'].includes(ext)) {
      return json({ error: 'ext must be jpg|jpeg|png|heic|webp' }, 400);
    }
    const contentType = String(body.content_type ?? `image/${ext === 'jpg' ? 'jpeg' : ext}`);
    const accountId = Deno.env.get('CF_ACCOUNT_ID');
    const bucket    = Deno.env.get('R2_BUCKET_NAME');
    const accessKey = Deno.env.get('R2_ACCESS_KEY_ID');
    const secretKey = Deno.env.get('R2_SECRET_ACCESS_KEY');
    const publicUrl = Deno.env.get('R2_PUBLIC_URL');
    if (!accountId || !bucket || !accessKey || !secretKey || !publicUrl) {
      return json({ error: 'R2 not configured' }, 500);
    }
    // observations/<observer-uuid>/<random>.<ext> — the same prefix
    // get-upload-url uses, so RLS / cleanup tooling sees one shape.
    const blobId = crypto.randomUUID();
    const key = `observations/${auth.user_id}/${blobId}.${ext}`;
    const s3 = new S3Client({
      region: 'auto',
      endpoint: `https://${accountId}.r2.cloudflarestorage.com`,
      credentials: { accessKeyId: accessKey, secretAccessKey: secretKey },
    });
    const command = new PutObjectCommand({ Bucket: bucket, Key: key, ContentType: contentType });
    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: 300 });
    const publicHref = `${publicUrl.replace(/\/$/, '')}/${key}`;
    return json({ key, upload_url: uploadUrl, public_url: publicHref, content_type: contentType }, 201);
  }

  // ── GET /api/observations ────────────────────────────────────────────────
  if (req.method === 'GET' && path === 'observations') {
    const auth = await verifyToken(token, 'observe', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') ?? '0');
    const from = url.searchParams.get('from');

    let q = supabase
      .from('observations')
      .select(`
        id, observed_at, notes, habitat, evidence_type, created_at,
        media_files(url, is_primary),
        identifications(scientific_name, confidence, id_source)
      `)
      .eq('observer_id', auth.user_id)
      .order('observed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) q = q.gte('observed_at', from);

    const { data, error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json(data ?? []);
  }

  // ── GET /api/export ──────────────────────────────────────────────────────
  if (req.method === 'GET' && path === 'export') {
    const auth = await verifyToken(token, 'export', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const format = url.searchParams.get('format') ?? 'darwin_core';

    const { data, error } = await supabase
      .from('observations')
      .select(`
        id, observed_at, notes, habitat, location,
        identifications(scientific_name, confidence, id_source)
      `)
      .eq('observer_id', auth.user_id)
      .order('observed_at', { ascending: false });

    if (error) return json({ error: error.message }, 500);

    if (format === 'darwin_core') {
      const header = [
        'occurrenceID', 'scientificName', 'eventDate',
        'decimalLatitude', 'decimalLongitude',
        'habitat', 'occurrenceRemarks', 'basisOfRecord', 'identificationSource',
      ].join(',');

      const rows = (data ?? []).map(row => {
        // PostGIS geography → lat/lng
        const match = (row.location as string)
          ?.match(/POINT\(([^ ]+)\s+([^)]+)\)/);
        const lng = match ? match[1] : '';
        const lat = match ? match[2] : '';
        // Primary identification (highest confidence)
        const ids = Array.isArray(row.identifications) ? row.identifications : [];
        const primary = ids.sort((a: {confidence: number}, b: {confidence: number}) =>
          (b.confidence ?? 0) - (a.confidence ?? 0))[0];
        return [
          row.id,
          `"${(primary?.scientific_name ?? '').replace(/"/g, '""')}"`,
          row.observed_at,
          lat,
          lng,
          row.habitat ?? '',
          `"${(row.notes ?? '').replace(/"/g, '""')}"`,
          'HumanObservation',
          primary?.id_source ?? '',
        ].join(',');
      });

      const csv = [header, ...rows].join('\n');
      return new Response(csv, {
        headers: {
          ...corsHeaders,
          'Content-Type': 'text/csv; charset=utf-8',
          'Content-Disposition': 'attachment; filename="rastrum-observations-dwc.csv"',
        },
      });
    }

    return json({ error: `Unsupported format: ${format}` }, 400);
  }

  return json({ error: 'Not found' }, 404);
});

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}
