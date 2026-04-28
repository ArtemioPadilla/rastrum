import { roleGrantHandler } from './role-grant.ts';
import { roleRevokeHandler } from './role-revoke.ts';
import { sensitiveReadUserAuditHandler } from './sensitive-read-user-audit.ts';
import type { ActionHandler } from './role-grant.ts';

export const HANDLERS: Record<string, ActionHandler<unknown>> = {
  'role.grant': roleGrantHandler as unknown as ActionHandler<unknown>,
  'role.revoke': roleRevokeHandler as unknown as ActionHandler<unknown>,
  'sensitive_read.user_audit': sensitiveReadUserAuditHandler as unknown as ActionHandler<unknown>,
};
