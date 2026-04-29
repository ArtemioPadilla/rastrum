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

## badge.award_manual

**Required role:** admin
**Audit op:** `badge_award_manual`

```ts
await adminClient.badge.awardManual(
  { target_user_id: '<uuid>', badge_key: 'first_obs' },
  'User reached milestone manually outside the normal cron window',
  session!.access_token,
);
```

**Note:** Upserts a row in `user_badges` (ON CONFLICT DO NOTHING). If the badge is already present the call is a no-op and the audit row still records the attempt. The `badge_key` must match an existing row in `badges`.

## badge.revoke

**Required role:** admin
**Audit op:** `badge_revoke`

```ts
await adminClient.badge.revoke(
  { target_user_id: '<uuid>', badge_key: 'first_obs' },
  'Badge awarded in error — obs was a test entry',
  session!.access_token,
);
```

**Note:** Hard-deletes the `user_badges` row. If the row does not exist the delete is a no-op; the audit row is still inserted. To temporarily suppress a badge without permanent removal, use `badge_award_manual` to overwrite `revoked_at` instead.

## taxon.recompute_rarity

**Required role:** admin
**Audit op:** `cron_force_run`

```ts
await adminClient.taxon.recomputeRarity(
  'Bulk observation import complete — refreshing rarity scores',
  session!.access_token,
);
```

**Note:** Calls `public.refresh_taxon_rarity()` synchronously inside the Edge Function. On large platforms this may take several seconds; the Edge Function has a 120 s timeout. The nightly pg_cron job runs the same function; this handler is for out-of-band refreshes after bulk imports or manual data corrections.

## taxon.toggle_conservation

**Required role:** admin
**Audit op:** `taxon_conservation_set`

```ts
await adminClient.taxon.toggleConservation(
  {
    taxon_id: '<uuid>',
    flag: 'nom059_status',   // 'nom059_status' | 'cites_appendix' | 'iucn_category'
    value: 'P',              // null clears the flag
  },
  'Updated from 2024 NOM-059 revision — taxon reclassified from A to P',
  session!.access_token,
);
```

**Note:** Updates the specified column on `public.taxa`. Passing `value: null` clears the flag (sets the column to NULL). The `obscure_level` column is NOT automatically updated by this handler — run `taxon.recompute_rarity` or update `obscure_level` separately if the conservation change should affect coordinate obscuration.

## feature_flag.toggle

**Required role:** admin
**Audit op:** `feature_flag_toggle`

```ts
await adminClient.featureFlag.toggle(
  { key: 'parallelCascade', value: false },
  'Disabling parallel cascade — API cost spike detected in CloudWatch',
  session!.access_token,
);
```

**Note:** Updates `app_feature_flags.value` and sets `updated_at` + `updated_by`. The `key` must match an existing row seeded from `src/lib/feature-flags.ts`; if the key is not found the handler throws HTTP 400. Runtime behaviour change is immediate on the next Edge Function cold start; warm isolates keep the previous value until they recycle (typically within a few minutes on the free tier).

## anomaly.acknowledge

**Required role:** admin
**Audit op:** `anomaly_acknowledge`
**Payload:** `{ anomalyId: string (uuid), notes?: string }`

```ts
await adminClient.anomaly.acknowledge(
  { anomalyId: '<uuid>', notes: 'False positive — bulk import context' },
  'reviewed and dismissed — not a real anomaly',
  session!.access_token,
);
```

**Note:** Sets `admin_anomalies.acknowledged_at = now()`,
`acknowledged_by = actor.id`, `ack_notes = notes`. Throws HTTP 400 if the
anomaly is already acknowledged. Read-side the row stays in
`admin_anomalies`; the audit trail is preserved. See
`docs/runbooks/admin-anomalies.md` for tuning + manual SQL fallback.

## audit.export

**Required role:** admin
**Audit op:** `audit_export`
**Payload:** `{ from?: ISO timestamp, to?: ISO timestamp, actorId?: uuid, op?: text, limit?: int (default 1000, max 10000) }`

```ts
await adminClient.auditExport(
  {
    from: '2026-04-01T00:00:00Z',
    to: '2026-04-29T00:00:00Z',
    op: 'observation_hide',
    limit: 5000,
  },
  'monthly compliance review export',
  session!.access_token,
);
// → { result: { rows: AdminAuditRow[], csv: string } }
```

**Note:** The CSV is built **server-side** (header
`id,created_at,actor_id,op,target_type,target_id,details`) so the client
just needs to wrap it in a Blob + download. Each row's `details` cell is
a single-line JSON string of `{ before, after, reason }`. Quote escape
follows RFC 4180 — fields containing `,`, `"`, or `\n` are wrapped in
double quotes and inner quotes are doubled. The export call itself
inserts an `admin_audit` row with `op = 'audit_export'`,
`target_type = 'admin_audit'`, `target_id = 'export'`, and an
`after` jsonb of `{ from, to, actorId, op, limit, returned }` so the
filter context is recoverable from the audit log.
