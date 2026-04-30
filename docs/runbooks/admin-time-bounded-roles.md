# Time-bounded role grants

PR13 (Section D) introduces optional expiration timestamps on every
`user_roles` row. The motivation is straightforward: an admin who
needs to delegate temporary access (a conservation NGO partner who's
auditing an exemption window, an outside reviewer covering for a
moderator on holiday) can now grant a role with a built-in sunset.

## Schema additions

`public.user_roles` gains two nullable columns:

| Column | Meaning |
|---|---|
| `expires_at timestamptz` | NULL = permanent grant. Future timestamp = sunset; `has_role()` returns false once `now() > expires_at`. |
| `auto_revoke_reason text` | Populated by the daily cron when it soft-revokes an expired row. v1 only ever sets the literal `'expired'`. |

`has_role(uid, role)` was rewritten to ignore expired rows the same way
it ignores `revoked_at` rows. Both checks live in the same `EXISTS`
predicate.

## Operator workflow

1. Open `/console/users`, search for the recipient.
2. Click the dashed `+ <role>` button next to their roles.
3. Set the **Expires** picker. "Never" (empty) = permanent.
4. Type a reason, submit. The audit row's `details` carries
   `expires_at` so the trail is intact.

## Cron

A `auto-revoke-expired-roles-daily` job runs at **08:15 UTC**, after
the 07:30 badges and 08:00 user-stats jobs have settled. The
SECURITY DEFINER function `auto_revoke_expired_roles()`:

1. Selects every row where `revoked_at IS NULL AND expires_at <= now()`.
2. Sets `revoked_at = now()` and `auto_revoke_reason = 'expired'`.
3. Inserts an `admin_audit` row with `op='role_revoke'`, the original
   `granted_by` admin as the `actor_id` (or the user themselves as a
   fallback for legacy rows missing `granted_by`), and a `details`
   JSON capturing the expiry timestamp.

Manual fire (when you've extended an expiring grant and want the sweep
to happen now rather than at 08:15 UTC):

```sql
SELECT public.auto_revoke_expired_roles();
```

The function returns the number of rows revoked.

## Audit trail

There is no new `audit_op` enum value — the cron writes `role_revoke`
rows. To query auto-revocations specifically:

```sql
SELECT id, created_at, target_id, actor_id, before, after
  FROM public.admin_audit
 WHERE op = 'role_revoke'
   AND after->>'auto_revoke_reason' = 'expired';
```

## Rollback

To remove the expiration on a still-active grant (i.e., make it
permanent again), re-run `role.grant` for the same `(user_id, role)`
pair without an `expires_at`. The handler's "extend" branch clears
both `expires_at` and `revoked_at`.
