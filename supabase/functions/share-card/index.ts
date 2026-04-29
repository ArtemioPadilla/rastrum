/**
 * /functions/v1/share-card?obs_id={uuid} — server-rendered SVG share card
 * for an observation. Browsers, link previews, and OG scrapers fetch this.
 *
 * Returns an SVG (text-rendered, no native font deps) — fast, light, and
 * cacheable on the Cloudflare CDN once we migrate media to R2 (see
 * docs/specs/modules/10-media-storage.md). Until then it's served via the
 * Edge Function directly, which Supabase fronts behind its own CDN.
 *
 * Respects the observation's obscure_level — 'full' returns 404 to prevent
 * sharing of fully-withheld species' precise data.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

function escapeXml(s: string): string {
  return s.replace(/[<>&'"]/g, c =>
    ({ '<':'&lt;','>':'&gt;','&':'&amp;',"'":'&apos;','"':'&quot;' }[c]!));
}

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'GET, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info, x-rastrum-build',
  'Access-Control-Max-Age': '86400',
};

function withCors(headers: HeadersInit = {}): HeadersInit {
  const out = new Headers(headers);
  for (const [k, v] of Object.entries(CORS_HEADERS)) out.set(k, v);
  return out;
}

serve(async (req) => {
  if (req.method === 'OPTIONS') {
    return new Response(null, { status: 204, headers: CORS_HEADERS });
  }
  const url = new URL(req.url);
  const obsId = url.searchParams.get('obs_id') ?? url.searchParams.get('id');
  const format = url.searchParams.get('format') ?? 'html';   // html | svg
  if (!obsId) return new Response('Missing obs_id', { status: 400, headers: CORS_HEADERS });

  const sUrl = Deno.env.get('SUPABASE_URL');
  const role = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY');
  if (!sUrl || !role) return new Response('Function not configured', { status: 500, headers: CORS_HEADERS });
  const db = createClient(sUrl, role);

  const { data: obs } = await db
    .from('observations')
    .select(`
      id, observed_at, obscure_level, state_province, habitat,
      identifications!inner(scientific_name, is_primary),
      users!observer_id(display_name, username, profile_public)
    `)
    .eq('id', obsId)
    .eq('identifications.is_primary', true)
    .maybeSingle();

  if (!obs) return new Response('Not found', { status: 404, headers: CORS_HEADERS });
  if (obs.obscure_level === 'full') return new Response('Not found', { status: 404, headers: CORS_HEADERS });

  const ident = Array.isArray(obs.identifications) ? obs.identifications[0] : obs.identifications;
  const user  = Array.isArray(obs.users) ? obs.users[0] : obs.users;

  const speciesName = ident?.scientific_name ?? 'Unknown species';
  const date = new Date(obs.observed_at as string).toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
  const region = obs.state_province ?? '';
  const observer = (user?.profile_public ? (user?.display_name || user?.username) : 'Anonymous observer') ?? 'Observer';
  const habitat = (obs.habitat as string | null)?.replace(/_/g, ' ') ?? '';

  const W = 1200, H = 630;
  const svg = `<?xml version="1.0" encoding="UTF-8"?>
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${W} ${H}" width="${W}" height="${H}">
  <defs>
    <linearGradient id="bg" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%"  stop-color="#064e3b"/>
      <stop offset="100%" stop-color="#0f172a"/>
    </linearGradient>
  </defs>
  <rect width="${W}" height="${H}" fill="url(#bg)"/>

  <!-- Brand stripe -->
  <rect x="0" y="0" width="${W}" height="14" fill="#10b981"/>

  <!-- Logo + brand -->
  <g transform="translate(60, 70)">
    <text x="0" y="32" font-family="system-ui, sans-serif" font-size="32" font-weight="800" fill="#10b981">Rastrum</text>
    <text x="160" y="32" font-family="system-ui, sans-serif" font-size="20" fill="#a7f3d0">biodiversity observation</text>
  </g>

  <!-- Species name -->
  <g transform="translate(60, 220)">
    <text font-family="Georgia, serif" font-size="78" font-weight="700" font-style="italic" fill="#ffffff">
      ${escapeXml(speciesName)}
    </text>
  </g>

  <!-- Meta -->
  <g transform="translate(60, 320)">
    <text font-family="system-ui, sans-serif" font-size="28" fill="#a7f3d0">${escapeXml(date)}${region ? '  ·  ' + escapeXml(region) : ''}</text>
    ${habitat ? `<text y="44" font-family="system-ui, sans-serif" font-size="22" fill="#86efac">${escapeXml(habitat)}</text>` : ''}
  </g>

  <!-- Footer -->
  <g transform="translate(60, ${H - 80})">
    <text font-family="system-ui, sans-serif" font-size="22" fill="#d1fae5">Observed by ${escapeXml(observer)}</text>
    <text y="32" font-family="system-ui, sans-serif" font-size="16" fill="#6ee7b7">rastrum.org</text>
  </g>

  ${obs.obscure_level && obs.obscure_level !== 'none' ? `
  <g transform="translate(${W - 220}, ${H - 100})">
    <rect x="0" y="0" width="180" height="70" rx="8" fill="#fef3c7" fill-opacity="0.15" stroke="#fcd34d"/>
    <text x="14" y="28" font-family="system-ui, sans-serif" font-size="13" font-weight="600" fill="#fcd34d">Sensitive species</text>
    <text x="14" y="48" font-family="system-ui, sans-serif" font-size="12" fill="#fde68a">Location coarsened</text>
  </g>
  ` : ''}
</svg>`;

  if (format === 'svg') {
    return new Response(svg, {
      headers: withCors({
        'content-type': 'image/svg+xml; charset=utf-8',
        'cache-control': 'public, max-age=86400',
      }),
    });
  }

  // Default: HTML wrapper with OG/Twitter meta. The image src is the same
  // function with format=svg.
  const baseUrl = `${url.origin}${url.pathname}`;
  const imgUrl  = `${baseUrl}?obs_id=${encodeURIComponent(obsId)}&format=svg`;
  const pageUrl = `https://rastrum.org/share/obs/?id=${encodeURIComponent(obsId)}`;
  const title = `${speciesName} — Rastrum`;
  const desc  = `Observed ${date}${region ? ' in ' + region : ''}${habitat ? ' (' + habitat + ')' : ''} — Rastrum biodiversity observation.`;

  const html = `<!doctype html>
<html lang="en">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeXml(title)}</title>
  <meta name="description" content="${escapeXml(desc)}"/>
  <meta property="og:type"  content="article"/>
  <meta property="og:title" content="${escapeXml(title)}"/>
  <meta property="og:description" content="${escapeXml(desc)}"/>
  <meta property="og:image" content="${imgUrl}"/>
  <meta property="og:image:width"  content="1200"/>
  <meta property="og:image:height" content="630"/>
  <meta property="og:url"   content="${pageUrl}"/>
  <meta name="twitter:card"  content="summary_large_image"/>
  <meta name="twitter:title" content="${escapeXml(title)}"/>
  <meta name="twitter:description" content="${escapeXml(desc)}"/>
  <meta name="twitter:image" content="${imgUrl}"/>
  <meta http-equiv="refresh" content="2; url=${pageUrl}"/>
  <style>
    body { margin:0; background:#0f172a; color:#a7f3d0; font:16px/1.5 system-ui, sans-serif; min-height:100vh; display:flex; align-items:center; justify-content:center; }
    main { max-width:760px; padding:24px; text-align:center; }
    img { max-width:100%; height:auto; border-radius:12px; }
    a { color:#10b981; }
  </style>
</head>
<body>
  <main>
    <img src="${imgUrl}" alt="${escapeXml(title)}"/>
    <p><a href="${pageUrl}">Open in Rastrum →</a></p>
  </main>
</body>
</html>`;

  return new Response(html, {
    headers: withCors({
      'content-type': 'text/html; charset=utf-8',
      'cache-control': 'public, max-age=300',
    }),
  });
});
