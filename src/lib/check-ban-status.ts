import { getSupabase } from './supabase';

export interface UserBan {
  id: string;
  reason: string | null;
  expires_at: string | null;
  created_at: string;
}

export async function getActiveBanForUser(userId: string): Promise<UserBan | null> {
  const supabase = getSupabase();
  const { data } = await supabase
    .from('user_bans')
    .select('id, reason, expires_at, created_at')
    .eq('user_id', userId)
    .is('revoked_at', null)
    .or('expires_at.is.null,expires_at.gt.' + new Date().toISOString())
    .order('created_at', { ascending: false })
    .limit(1)
    .maybeSingle();
  return (data as UserBan | null);
}
