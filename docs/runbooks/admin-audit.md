# Admin Audit Log

Every privileged write and every sensitive read produces an `admin_audit` row.

## Schema (cheat sheet)

```sql
SELECT id, actor_id, op, target_type, target_id, reason, created_at
FROM   public.admin_audit
ORDER BY created_at DESC LIMIT 50;
```

## Common queries

**"What did artemio do today?"**
```sql
SELECT created_at, op, target_type, target_id, reason
FROM   public.admin_audit
WHERE  actor_id = (SELECT id FROM public.users WHERE username = 'artemio')
  AND  created_at > now() - interval '1 day'
ORDER BY created_at DESC;
```

**"Did anyone read user X's audit log?"**
```sql
SELECT created_at, actor_id, reason
FROM   public.admin_audit
WHERE  op = 'user_audit_read' AND target_id = '<user-uuid>';
```

**"All role grants this month"**
```sql
SELECT *
FROM   public.admin_audit
WHERE  op IN ('role_grant', 'role_revoke')
  AND  created_at > date_trunc('month', now());
```

## What each `op` means

See the `audit_op` enum in `docs/specs/infra/supabase-schema.sql`. The mapping from action verb (e.g., `role.grant`) to op (e.g., `role_grant`) lives in the corresponding `supabase/functions/admin/handlers/*.ts` file.

## Retention

Indefinite for v1. If volume grows, partition monthly per `docs/specs/infra/future-migrations.md`.

## RLS

Only `has_role(auth.uid(), 'admin')` may SELECT. Inserts are service-role only (the dispatcher Edge Function). An explicit `admin_audit_no_client_write` policy makes the write block intent durable.
