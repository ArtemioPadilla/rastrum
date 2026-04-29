import { roleGrantHandler } from './role-grant.ts';
import { roleRevokeHandler } from './role-revoke.ts';
import { sensitiveReadUserAuditHandler } from './sensitive-read-user-audit.ts';
import { observationHideHandler } from './observation-hide.ts';
import { observationUnhideHandler } from './observation-unhide.ts';
import { observationObscureHandler } from './observation-obscure.ts';
import { observationLicenseOverrideHandler } from './observation-license-override.ts';
import type { ActionHandler } from './role-grant.ts';

export const HANDLERS: Record<string, ActionHandler<unknown>> = {
  'role.grant': roleGrantHandler as unknown as ActionHandler<unknown>,
  'role.revoke': roleRevokeHandler as unknown as ActionHandler<unknown>,
  'sensitive_read.user_audit': sensitiveReadUserAuditHandler as unknown as ActionHandler<unknown>,
  'observation.hide': observationHideHandler as unknown as ActionHandler<unknown>,
  'observation.unhide': observationUnhideHandler as unknown as ActionHandler<unknown>,
  'observation.obscure': observationObscureHandler as unknown as ActionHandler<unknown>,
  'observation.license_override': observationLicenseOverrideHandler as unknown as ActionHandler<unknown>,
};
