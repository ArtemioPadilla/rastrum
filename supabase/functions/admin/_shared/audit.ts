/**
 * insertAuditRow — single-purpose helper that writes to public.admin_audit
 * using the service-role client passed in by the caller.
 */
import type { SupabaseClient } from 'https://esm.sh/@supabase/supabase-js@2.39.7';

export type AuditOp =
  | 'role_grant' | 'role_revoke'
  | 'user_ban' | 'user_unban' | 'user_delete'
  | 'observation_hide' | 'observation_unhide'
  | 'observation_obscure' | 'observation_force_unobscure'
  | 'observation_license_override' | 'observation_hard_delete'
  | 'comment_hide' | 'comment_unhide' | 'comment_lock' | 'comment_unlock'
  | 'report_triaged' | 'report_resolved' | 'report_dismissed'
  | 'badge_award_manual' | 'badge_revoke'
  | 'token_force_revoke'
  | 'feature_flag_toggle'
  | 'cron_force_run'
  | 'precise_coords_read'
  | 'user_pii_read'
  | 'token_list_read'
  | 'user_audit_read'
  | 'appeal_accepted'
  | 'appeal_rejected'
  | 'anomaly_acknowledge'
  | 'audit_export'
  | 'proposal_create'
  | 'proposal_approve'
  | 'proposal_reject'
  | 'webhook_create'
  | 'webhook_update'
  | 'webhook_delete'
  | 'webhook_test';

export interface AuditRow {
  actor_id: string;
  op: AuditOp;
  target_type?: string;
  target_id?: string;
  before?: unknown;
  after?: unknown;
  reason: string;
  ip?: string | null;
  user_agent?: string | null;
}

export async function insertAuditRow(
  admin: SupabaseClient,
  row: AuditRow,
): Promise<number> {
  const { data, error } = await admin
    .from('admin_audit')
    .insert(row)
    .select('id')
    .single();
  if (error) throw new Error(`audit insert failed: ${error.message}`);
  return (data as { id: number }).id;
}
