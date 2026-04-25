/**
 * /functions/v1/api/observe — Submit observation via personal API token.
 * /functions/v1/api/identify — Identify species via personal API token.
 * /functions/v1/api/observations — List own observations.
 * /functions/v1/api/export — Export Darwin Core CSV.
 *
 * Auth: Authorization: Bearer rst_xxxx  (personal API token)
 *
 * See docs/specs/modules/14-user-api-tokens.md
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest(
    'SHA-256',
    new TextEncoder().encode(text)
  );
  return Array.from(new Uint8Array(buf))
    .map(b => b.toString(16).padStart(2, '0'))
    .join('');
}

/** Verify a personal API token. Returns { user_id, scopes } or null. */
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
    .single();

  if (error || !data) return null;
  if (data.expires_at && new Date(data.expires_at) < new Date()) return null;
  if (!data.scopes.includes(requiredScope)) return null;

  // Update last_used_at (fire and forget — don't await)
  supabase
    .from('user_api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return { user_id: data.user_id, scopes: data.scopes };
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') {
    return new Response('ok', { headers: corsHeaders });
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const token = req.headers.get('Authorization')?.replace('Bearer ', '');
  if (!token?.startsWith('rst_')) {
    return json({ error: 'Missing or invalid API token. Use Authorization: Bearer rst_...' }, 401);
  }

  const url = new URL(req.url);
  const path = url.pathname.split('/api/')[1] ?? ''; // 'observe' | 'identify' | 'observations' | 'export'

  // ── POST /api/observe ──────────────────────────────────────────────────────
  if (req.method === 'POST' && path === 'observe') {
    const auth = await verifyToken(token, 'observe', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const body = await req.json().catch(() => null);
    if (!body) return json({ error: 'Invalid JSON body' }, 400);

    const {
      scientific_name,
      lat,
      lng,
      observed_at,
      notes,
      photo_url,
      habitat,
      evidence_type = 'direct_sighting',
    } = body;

    if (!scientific_name || lat == null || lng == null) {
      return json({ error: 'scientific_name, lat, and lng are required' }, 400);
    }

    const { data, error } = await supabase
      .from('observations')
      .insert({
        observer_id: auth.user_id,
        scientific_name,
        location: `POINT(${lng} ${lat})`,
        observed_at: observed_at ?? new Date().toISOString(),
        notes,
        habitat,
        evidence_type,
        app_version: 'api/v1',
        sync_status: 'synced',
      })
      .select('id, scientific_name, observed_at, created_at')
      .single();

    if (error) return json({ error: error.message }, 500);

    // Attach photo if provided
    if (photo_url && data?.id) {
      await supabase.from('media_files').insert({
        observation_id: data.id,
        url: photo_url,
        media_type: 'photo',
        is_primary: true,
      });
    }

    return json(data, 201);
  }

  // ── POST /api/identify ─────────────────────────────────────────────────────
  if (req.method === 'POST' && path === 'identify') {
    const auth = await verifyToken(token, 'identify', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const body = await req.json().catch(() => null);
    if (!body?.image_url) return json({ error: 'image_url is required' }, 400);

    // Delegate to existing identify Edge Function
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
          location: body.lat != null
            ? { lat: body.lat, lng: body.lng }
            : undefined,
          user_hint: body.user_hint,
        }),
      }
    );

    const result = await identifyRes.json();
    return json(result, identifyRes.status);
  }

  // ── GET /api/observations ──────────────────────────────────────────────────
  if (req.method === 'GET' && path === 'observations') {
    const auth = await verifyToken(token, 'observe', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100);
    const offset = parseInt(url.searchParams.get('offset') ?? '0');
    const from = url.searchParams.get('from');

    let q = supabase
      .from('observations')
      .select(`
        id, scientific_name, observed_at, notes, habitat, evidence_type,
        location, created_at,
        media_files(url, is_primary)
      `)
      .eq('observer_id', auth.user_id)
      .order('observed_at', { ascending: false })
      .range(offset, offset + limit - 1);

    if (from) q = q.gte('observed_at', from);

    const { data, error } = await q;
    if (error) return json({ error: error.message }, 500);
    return json(data);
  }

  // ── GET /api/export ────────────────────────────────────────────────────────
  if (req.method === 'GET' && path === 'export') {
    const auth = await verifyToken(token, 'export', supabase);
    if (!auth) return json({ error: 'Unauthorized or insufficient scope' }, 401);

    const format = url.searchParams.get('format') ?? 'darwin_core';

    const { data, error } = await supabase
      .from('observations')
      .select(`
        id, scientific_name, observed_at, notes, habitat,
        location, created_at, app_version
      `)
      .eq('observer_id', auth.user_id)
      .order('observed_at', { ascending: false });

    if (error) return json({ error: error.message }, 500);

    if (format === 'darwin_core') {
      const header = [
        'occurrenceID', 'scientificName', 'eventDate',
        'decimalLatitude', 'decimalLongitude',
        'habitat', 'occurrenceRemarks', 'basisOfRecord',
      ].join(',');

      const rows = (data ?? []).map(row => {
        // PostGIS point → lat/lng
        const match = (row.location as string)?.match(/POINT\(([^ ]+) ([^)]+)\)/);
        const lng = match ? match[1] : '';
        const lat = match ? match[2] : '';
        return [
          row.id,
          `"${row.scientific_name}"`,
          row.observed_at,
          lat,
          lng,
          row.habitat ?? '',
          `"${(row.notes ?? '').replace(/"/g, '""')}"`,
          'HumanObservation',
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
