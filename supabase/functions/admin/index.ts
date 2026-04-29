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
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import { verifyJwtAndLoadRoles, requireRole, HttpError } from './_shared/auth.ts';
import { insertAuditRow } from './_shared/audit.ts';
import { HANDLERS } from './handlers/index.ts';

const CORS_HEADERS = {
  'Access-Control-Allow-Origin': '*',
  'Access-Control-Allow-Methods': 'POST, OPTIONS',
  'Access-Control-Allow-Headers': 'authorization, apikey, content-type, x-client-info',
};

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;

function json(body: unknown, status = 200): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...CORS_HEADERS, 'content-type': 'application/json' },
  });
}

serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: CORS_HEADERS });
  if (req.method !== 'POST') return json({ error: 'method not allowed' }, 405);

  let body: { action?: string; payload?: unknown; reason?: string };
  try {
    body = await req.json();
  } catch {
    return json({ error: 'invalid json' }, 400);
  }
  const { action, payload, reason } = body;
  if (!action || typeof action !== 'string') return json({ error: 'action required' }, 400);
  if (!reason || typeof reason !== 'string' || reason.length < 5) {
    return json({ error: 'reason required (min 5 chars)' }, 400);
  }

  const handler = HANDLERS[action];
  if (!handler) return json({ error: `unknown action: ${action}` }, 400);

  try {
    const actor = await verifyJwtAndLoadRoles(req);
    requireRole(actor, handler.requiredRole);

    const parsed = handler.payloadSchema.safeParse(payload);
    if (!parsed.success) return json({ error: 'invalid payload', issues: parsed.error.issues }, 400);

    const admin = createClient(SUPABASE_URL, SERVICE_KEY);
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

    return json({ ok: true, audit_id: auditId, result: result.result, after: result.after });
  } catch (err) {
    if (err instanceof HttpError) return json({ error: err.message }, err.status);
    return json({ error: (err as Error).message }, 500);
  }
});
