/**
 * Verifies the caller's Supabase JWT and loads their active roles in one
 * round trip. Returns a typed actor or throws an HTTP-shaped error.
 */
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export type UserRole = 'admin' | 'moderator' | 'expert' | 'researcher';

export interface Actor {
  id: string;
  roles: Set<UserRole>;
}

const SUPABASE_URL = Deno.env.get('SUPABASE_URL')!;
const SERVICE_KEY = Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!;
const ANON_KEY = Deno.env.get('SUPABASE_ANON_KEY')!;

export class HttpError extends Error {
  constructor(public status: number, message: string) {
    super(message);
  }
}

export async function verifyJwtAndLoadRoles(req: Request): Promise<Actor> {
  const auth = req.headers.get('authorization');
  if (!auth?.startsWith('Bearer ')) throw new HttpError(401, 'missing bearer token');
  const jwt = auth.slice(7);

  const userClient = createClient(SUPABASE_URL, ANON_KEY, {
    global: { headers: { Authorization: `Bearer ${jwt}` } },
  });
  const { data: userRes, error: userErr } = await userClient.auth.getUser(jwt);
  if (userErr || !userRes.user) throw new HttpError(401, 'invalid token');

  const adminClient = createClient(SUPABASE_URL, SERVICE_KEY);
  const { data: rows, error: rolesErr } = await adminClient
    .from('user_roles')
    .select('role, revoked_at')
    .eq('user_id', userRes.user.id);
  if (rolesErr) throw new HttpError(500, rolesErr.message);

  const now = Date.now();
  const roles = new Set<UserRole>(
    (rows ?? [])
      .filter(r => !r.revoked_at || new Date(r.revoked_at).getTime() > now)
      .map(r => r.role as UserRole),
  );

  return { id: userRes.user.id, roles };
}

export function requireRole(actor: Actor, required: UserRole): void {
  if (!actor.roles.has(required)) {
    throw new HttpError(403, `requires ${required}`);
  }
}
