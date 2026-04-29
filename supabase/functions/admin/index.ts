/**
 * /functions/v1/admin — privileged-actions dispatcher.
 *
 * Auth: Supabase user JWT (Authorization: Bearer …). The function
 * re-verifies the JWT, loads the caller's active roles from user_roles,
 * checks the action's required role, executes the handler, and writes
 * an admin_audit row. PR1 ships three handlers (role.grant, role.revoke,
 * sensitive_read.user_audit). Adding a new action = one handler file +
 * one entry in handlers/index.ts.
 *
 * Reason field is mandatory; minimum 5 chars enforced here.
 */
import { serve } from 'https://deno.land/std@0.224.0/http/server.ts';
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';
import { verifyJwtAndLoadRoles, requireRole, HttpError } from './_shared/auth.ts';
import { insertAuditRow } from './_shared/audit.ts';
import { checkRateLimit } from './_shared/rate-limit.ts';
import { HANDLERS } from './handlers/index.ts';

const ALLOWED_ORIGINS = [
  'https://rastrum.org',
  'http://localhost:4321',  // astro dev
  'http://localhost:4329',  // astro preview (e2e)
];

function corsHeaders(req: Request): Record<string, string> {
  const origin = req.headers.get('origin') ?? '';
  const allowed = ALLOWED_ORIGINS.includes(origin);
  return {
    'Access-Control-Allow-Origin': allowed ? origin : ALLOWED_ORIGINS[0],
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
    'Vary': 'Origin',
  };
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

// Write actions cost 3 tokens; reads cost 1. Handlers declare their cost.
const WRITE_ACTIONS = new Set([
  'role.grant', 'role.revoke',
  'user.ban', 'user.unban',
  'observation.hide', 'observation.unhide', 'observation.obscure', 'observation.license_override',
  'report.triage', 'report.resolve', 'report.dismiss',
  'comment.hide', 'comment.unhide', 'comment.lock', 'comment.unlock',
  'badge.award_manual', 'badge.revoke',
  'taxon.recompute_rarity', 'taxon.toggle_conservation',
  'feature_flag.toggle',
]);

function json(body: unknown, status = 200, req: Request): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...corsHeaders(req), 'content-type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders(req) });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405, req);

  let body: { action?: string; payload?: unknown; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400, req);
  }
  const { action, payload, reason } = body;
  if (!action || typeof action !== 'string') return json({ error: 'action required' }, 400, req);
  if (!reason || typeof reason !== 'string' || reason.length < 5) {
    return json({ error: 'reason required (min 5 chars)' }, 400, req);
  }

  const handler = HANDLERS[action];
  if (!handler) return json({ error: `unknown action: ${action}` }, 400, req);

  try {
    const actor = await verifyJwtAndLoadRoles(req);
    requireRole(actor, handler.requiredRole);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
    const rateCost = WRITE_ACTIONS.has(action) ? 3 : 1;
    const rateResult = await checkRateLimit(admin, actor.id, rateCost);
    if (!rateResult.allowed) {
      return new Response(
        JSON.stringify({ error: 'rate limit exceeded', retry_after: rateResult.retryAfterSeconds }),
        {
          status: 429,
          headers: {
            ...corsHeaders(req),
            'content-type': 'application/json',
            'Retry-After': String(rateResult.retryAfterSeconds),
          },
        },
      );
    }

    const parsed = handler.payloadSchema.safeParse(payload);
    if (!parsed.success) return json({ error: 'invalid payload', issues: parsed.error.issues }, 400);

    const result = await handler.execute(admin, parsed.data, actor, reason);

    // x-forwarded-for can be comma-separated ("client, proxy1, proxy2")
    // when behind multiple proxies; the inet column only accepts a single
    // address. Take the first (the originating client).
    const xff = req.headers.get('x-forwarded-for');
    const ip = xff ? xff.split(',')[0].trim() || null : null;

    const auditId = await insertAuditRow(admin, {
      actor_id: actor.id,
      op: handler.op,
      target_type: result.target.type,
      target_id: result.target.id,
      before: result.before ?? null,
      after: result.after ?? null,
      reason,
      ip,
      user_agent: req.headers.get('user-agent'),
    });

    return json({ ok: true, audit_id: auditId, result: result.result, after: result.after }, 200, req);
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status, req);
    return json({ error: (err as Error).message }, 500, req);
  }
});
