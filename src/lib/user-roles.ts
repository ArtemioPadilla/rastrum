import { getSupabase } from './supabase';
import type { UserRole } from './types';

/**
 * Read the active roles for a given user from public.user_roles.
 * Filters out revoked rows. Returns an empty Set for unauthenticated callers.
 */
export async function getUserRoles(userId: string | null | undefined): Promise<Set<UserRole>> {
  if (!userId) return new Set();
  const supabase = getSupabase();
  const { data, error } = await supabase
    .from('user_roles')
    .select('role, revoked_at')
    .eq('user_id', userId);
  if (error || !data) return new Set();
  const now = Date.now();
  const active = data.filter(r => !r.revoked_at || new Date(r.revoked_at).getTime() > now);
  return new Set(active.map(r => r.role as UserRole));
}
