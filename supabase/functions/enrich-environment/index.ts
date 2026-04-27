/**
 * /functions/v1/enrich-environment — backfill weather + lunar context for an
 * observation. Pulls from OpenMeteo (free, CC BY 4.0) and computes lunar
 * illumination locally.
 *
 * Invoked by the sync engine after an observation upserts; idempotent (UPSERTs
 * the same observation row).
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

type Req = { observation_id: string };

function lunarIllumination(d: Date): { phase: string; illumination: number } {
  // Conway's lunar phase algorithm. Accurate to ~1 day, plenty for ecology.
  const Y = d.getUTCFullYear();
  const M = d.getUTCMonth() + 1;
  const D = d.getUTCDate();
  let r = Y % 100;
  r %= 19;
  if (r > 9) r -= 19;
  r = (r * 11) % 30 + Math.floor(M >= 3 ? M + 1 : M + 13) + D;
  if (M < 3) r += 2;
  r -= (Y < 2000) ? 4 : 8.3;
  r = ((r % 30) + 30) % 30;
  // r ∈ [0, 30); 0=new, ~15=full
  const illum = Math.abs(Math.cos((r / 29.53) * 2 * Math.PI - Math.PI)) ;
  const phase = r < 1.84 ? 'new' :
                r < 5.53 ? 'waxing_crescent' :
                r < 9.22 ? 'first_quarter' :
                r < 12.91 ? 'waxing_gibbous' :
                r < 16.61 ? 'full' :
                r < 20.30 ? 'waning_gibbous' :
                r < 23.99 ? 'last_quarter' :
                r < 27.68 ? 'waning_crescent' : 'new';
  return { phase, illumination: Math.round(illum * 100) / 100 };
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-rastrum-build',
  'Access-Control-Max-Age': '86400',
};

function corsResponse(body: BodyInit | null, init: ResponseInit = {}): Response {
  const headers = new Headers(init.headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) headers.set(k, v);
  return new Response(body, { ...init, headers });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  if (req.method !== 'POST') return corsResponse('Method not allowed', { status: 405 });
  const body = await req.json() as Req;
  if (!body?.observation_id) return corsResponse('Missing observation_id', { status: 400 });

  const url = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!url || !role) return corsResponse('Function not configured', { status: 500 });

  const db = createClient(url, role);

  const { data: obs } = await db
    .from('observations')
    .select('id, observed_at, location')
    .eq('id', body.observation_id)
    .maybeSingle();
  if (!obs) return corsResponse('Observation not found', { status: 404 });

  const geom = obs.location as { coordinates?: [number, number] } | null;
  const coords = geom?.coordinates;
  if (!coords) return corsResponse('No location', { status: 422 });

  const [lng, lat] = coords;
  const observedAt = new Date(obs.observed_at);
  const date = observedAt.toISOString().slice(0, 10);

  // OpenMeteo historical weather — free, CC BY 4.0 attribution required in DwC export.
  const weatherUrl = new URL('https://archive-api.open-meteo.com/v1/archive');
  weatherUrl.searchParams.set('latitude', String(lat));
  weatherUrl.searchParams.set('longitude', String(lng));
  weatherUrl.searchParams.set('start_date', date);
  weatherUrl.searchParams.set('end_date', date);
  weatherUrl.searchParams.set('daily', 'precipitation_sum,temperature_2m_mean');
  weatherUrl.searchParams.set('timezone', 'auto');

  let precip24 = null, tempMean = null;
  try {
    const r = await fetch(weatherUrl);
    if (r.ok) {
      const j = await r.json() as { daily?: { precipitation_sum?: number[]; temperature_2m_mean?: number[] } };
      precip24 = j.daily?.precipitation_sum?.[0] ?? null;
      tempMean = j.daily?.temperature_2m_mean?.[0] ?? null;
    }
  } catch { /* skip on failure — partial enrichment is fine */ }

  const lunar = lunarIllumination(observedAt);

  const { error } = await db.from('observations').update({
    moon_phase: lunar.phase,
    moon_illumination: lunar.illumination,
    precipitation_24h_mm: precip24,
    temp_celsius: tempMean,
    post_rain_flag: precip24 != null && precip24 > 5,
    updated_at: new Date().toISOString(),
  }).eq('id', body.observation_id);

  if (error) return corsResponse(error.message, { status: 500 });
  return corsResponse(JSON.stringify({ ok: true, lunar, precip24, tempMean }), {
    headers: { 'content-type': 'application/json' },
  });
});
