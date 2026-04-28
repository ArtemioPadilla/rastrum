# Role Model

Four roles live in `public.user_role`:

| Role | What it unlocks | Granted by | Revocable by |
|---|---|---|---|
| `admin` | Console: all admin tabs; user role grants; license overrides; feature flags | bootstrap or another admin | another admin |
| `moderator` | Console: flag queue, comment hide/lock, soft-ban, license disputes | admin | admin |
| `expert` | Consensus 3× weighting; validation queue scoped to `expert_taxa` | admin (via Experts tab) | admin |
| `researcher` | RLS gate to read precise GPS coords on obscured observations | admin (via Credentials tab — PR2) | admin |

## Multi-role

Roles are orthogonal. A single user may hold any subset (e.g., `admin` + `expert` + `researcher`). The console renders one pill per role held; sidebar contents swap based on the active pill.

## Time-bounded grants

A grant's `revoked_at` may be set to a future timestamp at creation time. The role expires automatically (handled in code via `has_role()` filtering on `revoked_at > now()`).

## Soft-revoke

Revoking a role does not delete the row — it sets `revoked_at = now()`. This preserves the historical fact "X held this role from A to B" for audit. Re-granting flips `revoked_at` back to NULL and refreshes `granted_at`.

## Bootstrap

The first admin row is inserted manually via `docs/runbooks/admin-bootstrap.md`. `granted_by IS NULL` is the unambiguous bootstrap signal.

## Denormalised flag sync

`users.is_expert` and `users.credentialed_researcher` are kept in sync with the active state of the corresponding role rows via the `user_roles_sync_flags` trigger. This is purely a hot-path optimization — the source of truth is `user_roles`.
