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

## observation.hide

**Required role:** admin
**Audit op:** `observation_hide`

```ts
import { adminClient } from '@/lib/admin-client';
const { data: { session } } = await supabase.auth.getSession();
await adminClient.observation.hide(
  { observation_id: '<uuid>' },
  'Spam — generic stock photo',
  session!.access_token,
);
```

**Reversal:** `observation.unhide`.
**Note:** Sets `observations.hidden = true`, `hidden_at = now()`, `hidden_by = actor.id`. The `obs_public_read` RLS policy excludes hidden rows from public feeds. Owner can still see their own hidden observation.

## observation.unhide

**Required role:** admin
**Audit op:** `observation_unhide`

```ts
await adminClient.observation.unhide(
  { observation_id: '<uuid>' },
  'False positive — reinstating',
  session!.access_token,
);
```

**Note:** Clears `hidden`, `hidden_at`, `hidden_by`. Observation re-enters public feeds.

## observation.obscure

**Required role:** admin
**Audit op:** `observation_obscure`

```ts
await adminClient.observation.obscure(
  { observation_id: '<uuid>', obscure_level: '5km' },
  'NOM-059 taxon — coarsening coordinates',
  session!.access_token,
);
```

**Note:** Sets `observations.obscure_level` to one of `none | 0.1deg | 0.2deg | 5km | full`. Coordinates in public reads are coarsened to the stated level. Precise coords remain readable to the observer and credentialed researchers.

## observation.license_override

**Required role:** admin
**Audit op:** `observation_license_override`

```ts
await adminClient.observation.license_override(
  { observation_id: '<uuid>', license: 'CC0' },
  'Operator grant — research dataset',
  session!.access_token,
);
```

**Note:** Overrides `observations.license` with a valid SPDX identifier. Original license is preserved in `admin_audit.details`.

## report.triage

**Required role:** moderator
**Audit op:** `report_triaged`

```ts
await adminClient.report.triage(
  { report_id: '<uuid>' },
  'Reviewing — potential copyright issue',
  session!.access_token,
);
```

**Note:** Moves report from `open` → `triaged`. Signals that a moderator is actively reviewing it.

## report.resolve

**Required role:** moderator
**Audit op:** `report_resolved`

```ts
await adminClient.report.resolve(
  { report_id: '<uuid>' },
  'Observation hidden — copyright violation confirmed',
  session!.access_token,
);
```

**Note:** Moves report to `resolved`. Reporter may receive a notification (future work).

## report.dismiss

**Required role:** moderator
**Audit op:** `report_dismissed`

```ts
await adminClient.report.dismiss(
  { report_id: '<uuid>' },
  'No violation found — field photo is original',
  session!.access_token,
);
```

**Note:** Moves report to `dismissed`. Use when the reported content is acceptable.

## comment.hide

**Required role:** moderator
**Audit op:** `comment_hide`

```ts
await adminClient.comment.hide(
  { comment_id: '<uuid>' },
  'Harassment — violates community guidelines',
  session!.access_token,
);
```

**Note:** Sets `comments.hidden = true`. The comment body is still stored but excluded from public reads. Owner sees a "hidden by moderator" placeholder.

## comment.unhide

**Required role:** moderator
**Audit op:** `comment_unhide`

```ts
await adminClient.comment.unhide(
  { comment_id: '<uuid>' },
  'Appeal granted — reinstating',
  session!.access_token,
);
```

**Reversal of:** `comment.hide`.

## comment.lock

**Required role:** moderator
**Audit op:** `comment_lock`

```ts
await adminClient.comment.lock(
  { comment_id: '<uuid>' },
  'Heated thread — locking to prevent escalation',
  session!.access_token,
);
```

**Note:** Sets `comments.locked = true`. No new replies can be posted to this comment's thread. Does not hide existing content.

## comment.unlock

**Required role:** moderator
**Audit op:** `comment_unlock`

```ts
await adminClient.comment.unlock(
  { comment_id: '<uuid>' },
  'Situation resolved — unlocking thread',
  session!.access_token,
);
```

**Reversal of:** `comment.lock`.

## user.ban

**Required role:** moderator
**Audit op:** `user_ban`

```ts
await adminClient.user.ban(
  { target_user_id: '<uuid>', duration_hours: 24 },
  'Repeated spam posts after warning',
  session!.access_token,
);
```

**Note:** Inserts a row in `user_bans`. Banned users cannot post observations, comments, or vote. Duration of `0` = indefinite. The `is_banned` check runs via `user_bans` at read time.

## user.unban

**Required role:** moderator
**Audit op:** `user_unban`

```ts
await adminClient.user.unban(
  { ban_id: '<uuid>' },
  'User acknowledged the guidelines',
  session!.access_token,
);
```

**Note:** Sets `user_bans.revoked_at = now()`. User is immediately unbanned. History is preserved.

## Future actions (PR7+)

Badge award/revoke, token force-revoke, feature-flag toggle, cron force-run, sensitive_read.precise_coords, sensitive_read.user_pii, sensitive_read.token_list. Each lands with its own runbook section.
