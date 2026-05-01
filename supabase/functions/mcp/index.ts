/**
 * /functions/v1/mcp — Model Context Protocol HTTP server.
 *
 * Lets AI agents (Claude Desktop, Cursor, Copilot Coding Agent, etc.)
 * call Rastrum tools via JSON-RPC 2.0 over HTTP. Auth is identical to
 * the REST API: a personal API token (rst_xxxx) in the Authorization
 * header, scope-checked per tool.
 *
 * Spec: https://modelcontextprotocol.io/specification/basic/transports
 *
 * Tools (capabilities determined by the token's scopes):
 *   identify_species      (scope: identify) — run the photo ID cascade
 *   submit_observation    (scope: observe)  — create an observation row
 *   list_observations     (scope: observe)  — paginated own-observations
 *   get_observation       (scope: observe)  — single observation by id
 *   export_darwin_core    (scope: export)   — return CSV string
 *   get_platform_status   (scope: status)   — aggregate public metrics
 *   get_admin_metrics     (scope: admin)    — full metrics (requires admin role)
 *
 * Configure in your agent's MCP settings:
 *
 * Claude Desktop / Cursor / Copilot (Streamable HTTP — MCP spec 2025-03-26):
 *   {
 *     "mcpServers": {
 *       "rastrum": {
 *         "type": "http",
 *         "url": "https://<project-ref>.supabase.co/functions/v1/mcp",
 *         "headers": { "Authorization": "Bearer rst_..." }
 *       }
 *     }
 *   }
 *
 * OpenClaw / clients that require SSE transport (GET-based keep-alive):
 *   {
 *     "url": "https://<project-ref>.supabase.co/functions/v1/mcp",
 *     "headers": { "Authorization": "Bearer rst_..." }
 *   }
 *   This endpoint also accepts GET requests and responds with an SSE stream
 *   (keep-alive ping every 25 s) so that SSE-only MCP clients can connect.
 *   All JSON-RPC calls are still sent as POST.
 *
 * Tokens are issued at https://rastrum.org/profile/tokens.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

const corsHeaders = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Headers': 'authorization, content-type, mcp-session-id',
  'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
};

const SERVER_INFO = {
  name: 'rastrum-mcp',
  version: '0.1.0',
};

const PROTOCOL_VERSION = '2024-11-05';

// ── Tool catalog ──────────────────────────────────────────────────────
// The required scope is encoded next to each tool so the auth path is
// identical to the REST API. List_tools filters by what the caller's
// token has access to.

interface Tool {
  name: string;
  description: string;
  scope: 'observe' | 'identify' | 'export' | 'status' | 'admin';
  inputSchema: Record<string, unknown>;
  handler: (args: Record<string, unknown>, ctx: ToolCtx) => Promise<unknown>;
}

interface ToolCtx {
  supabase: ReturnType<typeof createClient>;
  user_id: string;
}

const TOOLS: Tool[] = [
  {
    name: 'identify_species',
    description:
      'Run the Rastrum identification cascade (PlantNet → Claude Haiku 4.5 → on-device fallbacks) on a photo URL. Returns the top scientific-name match with a confidence score and source.',
    scope: 'identify',
    inputSchema: {
      type: 'object',
      required: ['image_url'],
      properties: {
        image_url: { type: 'string', format: 'uri', description: 'Public HTTPS URL of the photo' },
        lat:       { type: 'number', description: 'Optional latitude hint (improves regional priors)' },
        lng:       { type: 'number', description: 'Optional longitude hint' },
        user_hint: { type: 'string', description: "Optional natural-language hint like 'this is a moth'" },
      },
    },
    async handler(args, ctx) {
      const res = await fetch(
        `${Deno.env.get('SUPABASE_URL')}/functions/v1/identify`,
        {
          method: 'POST',
          headers: {
            Authorization: `Bearer ${Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')}`,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({
            image_url: args.image_url,
            location: args.lat != null ? { lat: args.lat, lng: args.lng } : undefined,
            user_hint: args.user_hint,
            actor_user_id: ctx.user_id,
          }),
        },
      );
      if (!res.ok) throw new Error(`identify upstream ${res.status}: ${await res.text()}`);
      return res.json();
    },
  },

  {
    name: 'submit_observation',
    description:
      'Create a new observation tied to the calling user. lat/lng are required (decimal degrees, WGS84). Optional photo_url is attached as the primary photo. If scientific_name is supplied, a human-source identification with confidence 1.0 is inserted alongside the row.',
    scope: 'observe',
    inputSchema: {
      type: 'object',
      required: ['lat', 'lng'],
      properties: {
        lat:             { type: 'number' },
        lng:             { type: 'number' },
        observed_at:     { type: 'string', format: 'date-time', description: 'Defaults to now' },
        notes:           { type: 'string' },
        photo_url:       { type: 'string', format: 'uri' },
        habitat:         { type: 'string' },
        evidence_type:   { type: 'string', default: 'direct_sighting' },
        scientific_name: { type: 'string' },
      },
    },
    async handler(args, ctx) {
      const { data: obs, error } = await ctx.supabase
        .from('observations')
        .insert({
          observer_id:   ctx.user_id,
          location:      `SRID=4326;POINT(${args.lng} ${args.lat})`,
          observed_at:   args.observed_at ?? new Date().toISOString(),
          notes:         args.notes ?? null,
          habitat:       args.habitat ?? null,
          evidence_type: args.evidence_type ?? 'direct_sighting',
          app_version:   'mcp/v1',
          sync_status:   'synced',
        })
        .select('id, observed_at, created_at')
        .single();

      if (error || !obs) throw new Error(error?.message ?? 'insert failed');

      if (args.scientific_name) {
        await ctx.supabase.from('identifications').insert({
          observation_id:   obs.id,
          identifier_id:    ctx.user_id,
          scientific_name:  args.scientific_name,
          id_source:        'human',
          confidence:       1.0,
        });
      }
      if (args.photo_url) {
        await ctx.supabase.from('media_files').insert({
          observation_id: obs.id,
          url:            args.photo_url,
          media_type:     'photo',
          is_primary:     true,
        });
      }
      return obs;
    },
  },

  {
    name: 'list_observations',
    description:
      'List the calling user\'s observations, newest first. Includes attached media URLs and identifications.',
    scope: 'observe',
    inputSchema: {
      type: 'object',
      properties: {
        limit:  { type: 'integer', minimum: 1, maximum: 100, default: 20 },
        offset: { type: 'integer', minimum: 0, default: 0 },
        from:   { type: 'string', format: 'date-time', description: 'ISO date — only observations on/after' },
      },
    },
    async handler(args, ctx) {
      const limit  = Math.min(Number(args.limit ?? 20), 100);
      const offset = Number(args.offset ?? 0);
      let q = ctx.supabase
        .from('observations')
        .select(`
          id, observed_at, notes, habitat, evidence_type, created_at,
          media_files(url, is_primary),
          identifications(scientific_name, confidence, id_source)
        `)
        .eq('observer_id', ctx.user_id)
        .order('observed_at', { ascending: false })
        .range(offset, offset + limit - 1);
      if (args.from) q = q.gte('observed_at', args.from as string);
      const { data, error } = await q;
      if (error) throw new Error(error.message);
      return data ?? [];
    },
  },

  {
    name: 'get_observation',
    description: 'Fetch a single observation by id. RLS guarantees the caller only sees their own.',
    scope: 'observe',
    inputSchema: {
      type: 'object',
      required: ['id'],
      properties: { id: { type: 'string', format: 'uuid' } },
    },
    async handler(args, ctx) {
      const { data, error } = await ctx.supabase
        .from('observations')
        .select(`
          id, observed_at, notes, habitat, evidence_type, location, created_at,
          media_files(url, is_primary, media_type),
          identifications(scientific_name, confidence, id_source, created_at)
        `)
        .eq('observer_id', ctx.user_id)
        .eq('id', args.id)
        .maybeSingle();
      if (error) throw new Error(error.message);
      if (!data) throw new Error('Observation not found or not visible to this token.');
      return data;
    },
  },

  {
    name: 'export_darwin_core',
    description:
      'Export the calling user\'s observations as a Darwin Core CSV string. Returns text content suitable for opening in any spreadsheet or for upload to a GBIF IPT instance.',
    scope: 'export',
    inputSchema: {
      type: 'object',
      properties: {
        from: { type: 'string', format: 'date-time' },
      },
    },
    async handler(args, ctx) {
      let q = ctx.supabase
        .from('observations')
        .select(`
          id, observed_at, notes, habitat, location,
          identifications(scientific_name, confidence, id_source)
        `)
        .eq('observer_id', ctx.user_id)
        .order('observed_at', { ascending: false });
      if (args.from) q = q.gte('observed_at', args.from as string);

      const { data, error } = await q;
      if (error) throw new Error(error.message);

      const header = [
        'occurrenceID', 'scientificName', 'eventDate',
        'decimalLatitude', 'decimalLongitude',
        'habitat', 'occurrenceRemarks', 'basisOfRecord', 'identificationSource',
      ].join(',');
      const rows = (data ?? []).map((row: Record<string, unknown>) => {
        const match = (row.location as string)?.match(/POINT\(([^ ]+)\s+([^)]+)\)/);
        const lng = match ? match[1] : '';
        const lat = match ? match[2] : '';
        const ids = Array.isArray(row.identifications) ? row.identifications : [];
        const primary = (ids as Array<{ scientific_name?: string; confidence?: number; id_source?: string }>)
          .sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
        return [
          row.id,
          `"${(primary?.scientific_name ?? '').replace(/"/g, '""')}"`,
          row.observed_at,
          lat,
          lng,
          row.habitat ?? '',
          `"${((row.notes as string) ?? '').replace(/"/g, '""')}"`,
          'HumanObservation',
          primary?.id_source ?? '',
        ].join(',');
      });
      return { csv: [header, ...rows].join('\n'), rows: rows.length };
    },
  },

  {
    name: 'get_platform_status',
    description:
      'Returns aggregate public metrics for the Rastrum platform: total observations, distinct species recorded, active observers in the last 30 days, public projects, and new observations in the last 7 days.',
    scope: 'status',
    inputSchema: { type: 'object', properties: {} },
    async handler(_args, ctx) {
      const { data, error } = await ctx.supabase.rpc('platform_status_metrics');
      if (error) throw new Error(error.message);
      return data;
    },
  },

  {
    name: 'get_admin_metrics',
    description:
      'Returns full platform metrics for operators: user registrations (total / 7d / 30d), observations (total / 7d / 30d), active users (7d), distinct species, and public projects. Requires both admin token scope AND the caller holding the admin role in the platform.',
    scope: 'admin',
    inputSchema: { type: 'object', properties: {} },
    async handler(_args, ctx) {
      const { data: roleRow, error: roleErr } = await ctx.supabase
        .from('user_roles')
        .select('user_id')
        .eq('user_id', ctx.user_id)
        .eq('role', 'admin')
        .is('revoked_at', null)
        .maybeSingle();
      if (roleErr) throw new Error(roleErr.message);
      if (!roleRow) throw new Error('Caller does not hold the admin role.');
      const { data, error } = await ctx.supabase.rpc('admin_platform_metrics');
      if (error) throw new Error(error.message);
      return data;
    },
  },
];

// ── Token verification (mirrors api/index.ts) ─────────────────────────

async function sha256(text: string): Promise<string> {
  const buf = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(text));
  return Array.from(new Uint8Array(buf)).map(b => b.toString(16).padStart(2, '0')).join('');
}

async function verifyToken(
  token: string,
  supabase: ReturnType<typeof createClient>,
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
  if (!Array.isArray(data.scopes) || data.scopes.length === 0) return null;

  // Fire-and-forget last_used_at update
  supabase.from('user_api_tokens')
    .update({ last_used_at: new Date().toISOString() })
    .eq('id', data.id);

  return { user_id: data.user_id, scopes: data.scopes };
}

// ── JSON-RPC 2.0 handler ──────────────────────────────────────────────

interface RpcRequest {
  jsonrpc: '2.0';
  id?: string | number | null;
  method: string;
  params?: Record<string, unknown>;
}

function rpcResult(id: string | number | null | undefined, result: unknown): Response {
  return json({ jsonrpc: '2.0', id: id ?? null, result });
}

function rpcError(id: string | number | null | undefined, code: number, message: string, status = 200): Response {
  return json({ jsonrpc: '2.0', id: id ?? null, error: { code, message } }, status);
}

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders, 'Content-Type': 'application/json' },
  });
}

Deno.serve(async (req: Request) => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: corsHeaders });

  // ── SSE keep-alive for clients that require GET-based SSE transport ──────
  // The legacy SSE MCP transport (used by OpenClaw ≤ v2026.4.26 and other
  // SSE-only clients) opens a long-lived GET connection and waits for an
  // `endpoint` event that tells it where to POST JSON-RPC messages.
  // We emit that event immediately (pointing back at this same URL), then
  // keep the connection alive with periodic ping comments.
  // Clients that support Streamable HTTP (Claude Desktop, Cursor, Copilot)
  // never issue a GET, so this branch is invisible to them.
  if (req.method === 'GET') {
    // Supabase Edge Runtime strips /functions/v1/ from req.url internally and
    // may also forward the request as http://. Build the canonical public URL
    // from the known project ref + function name instead of trusting req.url.
    const projectRef = Deno.env.get('SUPABASE_URL')?.match(/https:\/\/([^.]+)/)?.[1]
      ?? new URL(req.url).hostname.split('.')[0];
    const selfUrl = `https://${projectRef}.supabase.co/functions/v1/mcp`;
    const sseHeaders = {
      ...corsHeaders,
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache',
      'Connection': 'keep-alive',
    };
    const { readable, writable } = new TransformStream();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    // Required by the MCP SSE spec: the client waits for this before connecting.
    writer.write(enc.encode(`event: endpoint\ndata: ${selfUrl}\n\n`));
    // Keep the stream alive with periodic pings, then close cleanly.
    const interval = setInterval(() => writer.write(enc.encode(': ping\n\n')), 25_000);
    setTimeout(() => {
      clearInterval(interval);
      writer.close();
    }, 55_000);
    return new Response(readable, { headers: sseHeaders });
  }

  if (req.method !== 'POST') {
    return rpcError(null, -32600, 'Method not allowed. Use POST for JSON-RPC or GET for SSE.', 405);
  }

  const supabase = createClient(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!,
  );

  // Auth gate (initialize is allowed unauth so clients can probe; everything
  // else needs a valid rst_ token).
  const token = req.headers.get('Authorization')?.replace('Bearer ', '') ?? '';

  let body: RpcRequest;
  try {
    body = await req.json();
  } catch {
    return rpcError(null, -32700, 'Parse error');
  }

  if (body.jsonrpc !== '2.0' || typeof body.method !== 'string') {
    return rpcError(body.id, -32600, 'Invalid Request');
  }

  // ── initialize ────────────────────────────────────────────────────
  if (body.method === 'initialize') {
    return rpcResult(body.id, {
      protocolVersion: PROTOCOL_VERSION,
      serverInfo: SERVER_INFO,
      capabilities: { tools: { listChanged: false } },
      instructions:
        'Rastrum biodiversity platform MCP server. Set Authorization: Bearer rst_<token> '
        + '(create at https://rastrum.org/profile/tokens). Tools available depend on the '
        + 'token\'s scopes: observe (submit/list/get observations), identify (species ID cascade), '
        + 'export (Darwin Core CSV), status (aggregate platform metrics), '
        + 'admin (full metrics — token owner must also hold the admin role).',
    });
  }

  // ── ping ──────────────────────────────────────────────────────────
  if (body.method === 'ping') {
    return rpcResult(body.id, {});
  }

  // ── notifications/initialized ─────────────────────────────────────
  // Streamable HTTP (2025-03-26) expects 202 Accepted for notifications.
  // Legacy SSE transport also sends this; both are fine with 202.
  if (body.method === 'notifications/initialized') {
    return new Response(null, { status: 202, headers: corsHeaders });
  }

  // Everything below requires auth.
  if (!token.startsWith('rst_')) {
    return rpcError(body.id, -32001, 'Missing API token. Set Authorization: Bearer rst_...');
  }
  const auth = await verifyToken(token, supabase);
  if (!auth) {
    return rpcError(body.id, -32001, 'Invalid or revoked API token.');
  }

  // ── tools/list ────────────────────────────────────────────────────
  if (body.method === 'tools/list') {
    const visible = TOOLS.filter(t => auth.scopes.includes(t.scope))
      .map(t => ({ name: t.name, description: t.description, inputSchema: t.inputSchema }));
    return rpcResult(body.id, { tools: visible });
  }

  // ── tools/call ────────────────────────────────────────────────────
  if (body.method === 'tools/call') {
    const params = body.params as { name?: string; arguments?: Record<string, unknown> } | undefined;
    const name = params?.name;
    const args = params?.arguments ?? {};
    const tool = TOOLS.find(t => t.name === name);

    if (!tool) {
      return rpcError(body.id, -32602, `Unknown tool: ${name}`);
    }
    if (!auth.scopes.includes(tool.scope)) {
      return rpcError(body.id, -32001,
        `Token lacks scope '${tool.scope}' required by tool '${tool.name}'`);
    }

    try {
      const result = await tool.handler(args, { supabase, user_id: auth.user_id });
      return rpcResult(body.id, {
        content: [
          { type: 'text', text: JSON.stringify(result, null, 2) },
        ],
        isError: false,
      });
    } catch (e) {
      return rpcResult(body.id, {
        content: [
          { type: 'text', text: e instanceof Error ? e.message : String(e) },
        ],
        isError: true,
      });
    }
  }

  return rpcError(body.id, -32601, `Method not found: ${body.method}`);
});
