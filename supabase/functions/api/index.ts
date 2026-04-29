/**
 * /functions/v1/api/* — REST API authenticated via personal API tokens (rst_xxxx).
 *
 * POST /api/observe       → submit observation (scope: observe)
 * POST /api/identify      → photo ID cascade (scope: identify)
 * GET  /api/observations  → list own observations (scope: observe)
 * GET  /api/export        → export Darwin Core CSV (scope: export)
 *
 * See docs/specs/modules/14-user-api-tokens.md
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

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

    const { lat, lng, observed_at, notes, photo_url, habitat, evidence_type = 'direct_sighting' } = body;
    if (lat == null || lng == null) return json({ error: 'lat and lng are required' }, 400);

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
        app_version: 'api/v1',
        sync_status: 'synced',
      })
      .select('id, observed_at, created_at')
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
          location: body.lat != null ? { lat: body.lat, lng: body.lng } : undefined,
          user_hint: body.user_hint,
        }),
      }
    );

    const result = await identifyRes.json();
    return json(result, identifyRes.status);
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
