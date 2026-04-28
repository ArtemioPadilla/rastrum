# Admin Bootstrap

> One-shot procedure to grant the operator the first `admin` role, run
> manually after applying the PR1 schema migration. After this, all
> further role grants happen through the console UI.

## Pre-conditions

- Schema migration applied (`make db-apply` shows `user_roles` table exists).
- Operator already has a row in `public.users` (sign in once via the normal auth flow).

## Procedure

1. Find your `user_id`:

```bash
make db-psql -- -c "SELECT id, username FROM public.users WHERE username = 'artemio';"
```

2. Insert the bootstrap row (`granted_by IS NULL` is the unambiguous bootstrap signal):

```bash
make db-psql -- -c "INSERT INTO public.user_roles (user_id, role, granted_by, notes)
VALUES ('<your-user-id>', 'admin', NULL, 'bootstrap')
ON CONFLICT (user_id, role) DO NOTHING;"
```

3. Verify:

```bash
make db-psql -- -c "SELECT public.has_role('<your-user-id>', 'admin');"
```

Expected: `t` (true).

4. Reload `https://rastrum.org` — the **Console** pill should now appear in
   the header. Click it; you should land on `/en/console/` (or `/es/consola/`).

## Rollback

```bash
make db-psql -- -c "DELETE FROM public.user_roles
WHERE user_id = '<your-user-id>' AND role = 'admin' AND granted_by IS NULL;"
```
