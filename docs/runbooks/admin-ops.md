# Admin Ops Runbook (PR1)

PR1 ships three actions. Each is exposed via `src/lib/admin-client.ts`.

## role.grant

**Required role:** admin
**Audit op:** `role_grant`

```ts
import { adminClient } from '@/lib/admin-client';
const { data: { session } } = await supabase.auth.getSession();
await adminClient.role.grant(
  { target_user_id: 'uuid', role: 'expert' },
  '6 weeks active community participation',
  session!.access_token,
);
```

**Reversal:** `role.revoke` (preserves history).

## role.revoke

**Required role:** admin
**Audit op:** `role_revoke`
**Note:** sets `revoked_at = now()`. Re-granting later restores the role and clears `revoked_at`.

## sensitive_read.user_audit

**Required role:** admin
**Audit op:** `user_audit_read`
**Returns:** the last N audit rows where the named user is either actor or target.
**Note:** the read itself is logged.

## Future actions (PR2+)

User ban/unban, observation hide/license-override, comment hide/lock, badge award/revoke, token force-revoke, feature-flag toggle, cron force-run, sensitive_read.precise_coords, sensitive_read.user_pii, sensitive_read.token_list. Each lands with its own runbook section.
