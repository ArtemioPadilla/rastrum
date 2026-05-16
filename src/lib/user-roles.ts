import { getSupabase, onAuthChange } from './supabase';
import type { UserRole } from './types';

const ROLES_CACHE_TTL_MS = 30_000;
let _rolesCache: { userId: string; roles: Set<UserRole>; resolvedAt: number } | null = null;
let _rolesFlight: { userId: string; p: Promise<Set<UserRole>> } | null = null;

let _rolesListenerAttached = false;
function ensureRolesAuthListener() {
  if (_rolesListenerAttached) return;
  _rolesListenerAttached = true;
  try {
    onAuthChange((event) => {
      if (event === 'SIGNED_OUT') {
        _rolesCache = null;
        _rolesFlight = null;
      }
    });
  } catch { /* env not set */ }
}

async function fetchRoles(userId: string): Promise<Set<UserRole>> {
  try {
    const supabase = getSupabase();
    const { data, error } = await supabase
      .from('user_roles')
      .select('role, revoked_at')
      .eq('user_id', userId);
    if (error || !data) return new Set();
    const now = Date.now();
    const active = data.filter(r => !r.revoked_at || new Date(r.revoked_at).getTime() > now);
    return new Set(active.map(r => r.role as UserRole));
  } catch {
    return new Set();
  }
}

/**
 * Read the active roles for a given user from public.user_roles.
 * Short-lived in-memory cache + in-flight dedupe (mirrors #1064's
 * getCachedUser/getCachedSession): the chrome renders Header AND
 * MobileDrawer islands, each calling this on cold-start and again from
 * onAuthStateChange's INITIAL_SESSION replay -> 3-5 identical
 * /rest/v1/user_roles requests per load (#1076). Collapsed to one.
 */
export async function getUserRoles(userId: string | null | undefined): Promise<Set<UserRole>> {
  if (!userId) return new Set();
  ensureRolesAuthListener();
  const now = Date.now();
  if (_rolesCache && _rolesCache.userId === userId && (now - _rolesCache.resolvedAt) < ROLES_CACHE_TTL_MS) {
    return _rolesCache.roles;
  }
  if (_rolesFlight && _rolesFlight.userId === userId) {
    return _rolesFlight.p;
  }
  const p = fetchRoles(userId).then((roles) => {
    _rolesCache = { userId, roles, resolvedAt: Date.now() };
    return roles;
  }).finally(() => {
    if (_rolesFlight && _rolesFlight.userId === userId) _rolesFlight = null;
  });
  _rolesFlight = { userId, p };
  return p;
}
