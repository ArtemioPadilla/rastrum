/**
 * /functions/v1/export-trail-pdf — Trail field guide HTML export (issue #195).
 *
 * Returns a print-ready HTML page styled as a field guide for a biodiversity trail.
 * The user opens the URL and prints to PDF from the browser (Ctrl/Cmd+P → Save as PDF).
 * No PDF library required — the HTML is styled with print-specific CSS.
 *
 * Route:  GET /functions/v1/export-trail-pdf?trail_id=<uuid>&lang=<en|es>
 *
 * Auth:
 *   - Public trails: no auth required
 *   - Private trails: Bearer JWT required (owner only)
 *
 * Response: text/html with print CSS
 *
 * The actual rendering is handled by the Astro page at
 * /[lang]/explore/trails/[slug]/field-guide.astro for in-app use.
 * This function provides a standalone URL for direct PDF generation
 * (e.g., sharable link, headless Chrome screenshot pipeline).
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type',
};

export async function handler(req: Request): Promise<Response> {
  if (req.method === 'OPTIONS') {
    return new Response(null, { headers: CORS_HEADERS });
  }

  const url = new URL(req.url);
  const trailId = url.searchParams.get('trail_id') ?? '';
  const lang = (url.searchParams.get('lang') ?? 'en') as 'en' | 'es';
  const isEs = lang === 'es';

  if (!trailId) {
    return new Response(
      JSON.stringify({ error: 'trail_id is required' }),
      { status: 400, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  const supabaseUrl = Deno.env.get('SUPABASE_URL') ?? '';
  const supabaseKey = Deno.env.get('SUPABASE_ANON_KEY') ?? '';

  // Honour Bearer token if provided
  const authHeader = req.headers.get('Authorization');
  const sb = createClient(supabaseUrl, supabaseKey, {
    global: authHeader ? { headers: { Authorization: authHeader } } : {},
  });

  // Fetch trail
  const { data: trail, error } = await sb
    .from('trails')
    .select('*')
    .eq('id', trailId)
    .single();

  if (error || !trail) {
    return new Response(
      JSON.stringify({ error: 'Trail not found or access denied' }),
      { status: 404, headers: { ...CORS_HEADERS, 'Content-Type': 'application/json' } },
    );
  }

  // Fetch waypoint observations (best-effort — no hard dependency)
  const waypoints: Array<{ lat: number; lng: number; name?: string; obs_count?: number }> =
    Array.isArray(trail.waypoints) ? trail.waypoints : [];

  const html = buildFieldGuideHtml(trail, waypoints, isEs);

  return new Response(html, {
    status: 200,
    headers: {
      ...CORS_HEADERS,
      'Content-Type': 'text/html; charset=utf-8',
      'Cache-Control': 'no-store',
    },
  });
}

serve(handler);

// ---------------------------------------------------------------------------
// HTML builder
// ---------------------------------------------------------------------------

interface Trail {
  id: string;
  name: string;
  name_es?: string;
  total_species: number;
  total_observations: number;
  distance_km?: number | null;
  created_at: string;
}

function escapeHtml(str: string): string {
  return String(str)
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

function buildFieldGuideHtml(
  trail: Trail,
  waypoints: Array<{ lat: number; lng: number; name?: string; obs_count?: number }>,
  isEs: boolean,
): string {
  const displayName = isEs && trail.name_es ? trail.name_es : trail.name;
  const date = new Date(trail.created_at).toLocaleDateString(isEs ? 'es-MX' : 'en-US', {
    year: 'numeric',
    month: 'long',
    day: 'numeric',
  });

  const waypointRows = waypoints.map((wp, i) => `
    <tr>
      <td>${i + 1}</td>
      <td>${escapeHtml(wp.name ?? `WP ${i + 1}`)}</td>
      <td class="mono">${Number(wp.lat).toFixed(5)}</td>
      <td class="mono">${Number(wp.lng).toFixed(5)}</td>
      <td>${wp.obs_count ?? 0}</td>
    </tr>
  `).join('');

  return `<!DOCTYPE html>
<html lang="${isEs ? 'es' : 'en'}">
<head>
  <meta charset="utf-8"/>
  <meta name="viewport" content="width=device-width, initial-scale=1"/>
  <title>${escapeHtml(displayName)} — ${isEs ? 'Guía de Campo' : 'Field Guide'} | Rastrum</title>
  <style>
    /* ── Base ── */
    * { box-sizing: border-box; margin: 0; padding: 0; }
    body {
      font-family: 'Georgia', 'Times New Roman', serif;
      font-size: 11pt;
      line-height: 1.55;
      color: #1a1a1a;
      background: #fff;
      padding: 2cm 2.5cm;
      max-width: 21cm;
      margin: 0 auto;
    }
    h1 { font-size: 22pt; margin-bottom: 4pt; }
    h2 { font-size: 13pt; border-bottom: 1px solid #ccc; padding-bottom: 4pt; margin: 20pt 0 8pt; color: #1a3a1a; }
    p  { margin-bottom: 6pt; }

    /* ── Header ── */
    .field-guide-header {
      border: 2px solid #1a3a1a;
      border-radius: 4px;
      padding: 16pt 20pt;
      margin-bottom: 20pt;
    }
    .field-guide-header .subtitle {
      font-size: 9pt;
      color: #555;
      text-transform: uppercase;
      letter-spacing: 0.05em;
      margin-bottom: 6pt;
    }
    .field-guide-header .meta {
      font-size: 9.5pt;
      color: #444;
      margin-top: 10pt;
    }

    /* ── Stats grid ── */
    .stats-grid {
      display: grid;
      grid-template-columns: repeat(auto-fit, minmax(100pt, 1fr));
      gap: 8pt;
      margin-bottom: 20pt;
    }
    .stat-box {
      border: 1px solid #ccc;
      border-radius: 4px;
      padding: 8pt;
      text-align: center;
    }
    .stat-box .value { font-size: 18pt; font-weight: bold; color: #1a5c1a; }
    .stat-box .label { font-size: 8.5pt; color: #666; text-transform: uppercase; letter-spacing: 0.04em; }

    /* ── Waypoints table ── */
    table {
      width: 100%;
      border-collapse: collapse;
      font-size: 9.5pt;
    }
    th {
      background: #1a3a1a;
      color: #fff;
      padding: 5pt 7pt;
      text-align: left;
      font-size: 8.5pt;
      text-transform: uppercase;
      letter-spacing: 0.04em;
    }
    td { padding: 5pt 7pt; border-bottom: 1px solid #e5e5e5; }
    tr:nth-child(even) td { background: #f8f8f4; }
    .mono { font-family: 'Courier New', monospace; font-size: 8.5pt; }

    /* ── Notes section ── */
    .notes-section {
      margin-top: 24pt;
    }
    .notes-lines .line {
      border-bottom: 1px dotted #bbb;
      height: 20pt;
      margin-bottom: 0;
    }

    /* ── Footer ── */
    .field-guide-footer {
      margin-top: 24pt;
      padding-top: 10pt;
      border-top: 1px solid #ccc;
      font-size: 8pt;
      color: #888;
      text-align: center;
    }

    /* ── Print overrides ── */
    @media print {
      body { padding: 1.5cm 2cm; }
      .no-print { display: none !important; }
      h2 { page-break-after: avoid; }
      table { page-break-inside: avoid; }
      .stat-box { break-inside: avoid; }
    }
  </style>
</head>
<body>

  <!-- Screen-only print button -->
  <div class="no-print" style="text-align:right; margin-bottom: 12pt;">
    <button
      onclick="window.print()"
      style="padding: 6pt 14pt; background: #1a5c1a; color: #fff; border: none; border-radius: 4px; font-size: 10pt; cursor: pointer;"
    >
      🖨️ ${isEs ? 'Imprimir / Guardar PDF' : 'Print / Save as PDF'}
    </button>
  </div>

  <!-- Header -->
  <div class="field-guide-header">
    <div class="subtitle">Rastrum · ${isEs ? 'Guía de Campo' : 'Field Guide'}</div>
    <h1>${escapeHtml(displayName)}</h1>
    <div class="meta">
      ${isEs ? 'Creado' : 'Created'}: ${date}
      ${trail.distance_km != null
        ? ` &nbsp;·&nbsp; ${Number(trail.distance_km).toFixed(1)} km`
        : ''}
    </div>
  </div>

  <!-- Stats -->
  <div class="stats-grid">
    <div class="stat-box">
      <div class="value">${trail.total_species}</div>
      <div class="label">${isEs ? 'Especies' : 'Species'}</div>
    </div>
    <div class="stat-box">
      <div class="value">${trail.total_observations}</div>
      <div class="label">${isEs ? 'Observaciones' : 'Observations'}</div>
    </div>
    <div class="stat-box">
      <div class="value">${waypoints.length}</div>
      <div class="label">${isEs ? 'Waypoints' : 'Waypoints'}</div>
    </div>
    ${trail.distance_km != null ? `
    <div class="stat-box">
      <div class="value">${Number(trail.distance_km).toFixed(1)}</div>
      <div class="label">km</div>
    </div>` : ''}
  </div>

  <!-- Waypoints -->
  ${waypoints.length > 0 ? `
  <h2>${isEs ? 'Waypoints del Sendero' : 'Trail Waypoints'}</h2>
  <table>
    <thead>
      <tr>
        <th>#</th>
        <th>${isEs ? 'Nombre' : 'Name'}</th>
        <th>Lat</th>
        <th>Lng</th>
        <th>${isEs ? 'Obs' : 'Obs'}</th>
      </tr>
    </thead>
    <tbody>
      ${waypointRows}
    </tbody>
  </table>` : `
  <h2>${isEs ? 'Waypoints' : 'Waypoints'}</h2>
  <p style="color:#888; font-style:italic;">${isEs ? 'No se han registrado waypoints.' : 'No waypoints recorded.'}</p>
  `}

  <!-- Field notes -->
  <div class="notes-section">
    <h2>${isEs ? 'Notas de campo' : 'Field Notes'}</h2>
    <div class="notes-lines">
      ${Array(10).fill('<div class="line"></div>').join('\n      ')}
    </div>
  </div>

  <!-- Footer -->
  <div class="field-guide-footer">
    Rastrum · ${isEs ? 'Guía de campo generada el' : 'Field guide generated'} ${new Date().toLocaleDateString(isEs ? 'es-MX' : 'en-US')}
    · rastrum.app
  </div>

</body>
</html>`;
}

// rastrum incident 2026-05-16: forced re-upload to recover from a
// Supabase Edge serving-layer drop (function ACTIVE in the control plane
// but 404 at the runtime; `supabase functions deploy` skipped unchanged
// bundles as a silent no-op). Behavior-neutral bundle-hash buster; safe to
// remove once Supabase confirms the platform root cause (support ticket).
;(globalThis as Record<string, unknown>).__rastrumRedeploy = "2026-05-16-serving-layer-recovery";
