# Platform-wide AI sponsor pool (M32, #115) — runbook

> **Spec:** [`docs/specs/modules/32-multi-provider-vision.md`](../specs/modules/32-multi-provider-vision.md) (M32 includes both multi-provider + the pool).
> **Schema:** `sponsor_pools`, `pool_consumption`, `consume_pool_slot()` RPC.
> **Status:** backend + UI shipped 2026-04-30 (PRs #143 + #215). Crons for monthly reset + ledger vacuum shipped (PR #207).

A sponsor donates N calls to a shared pool that any user of the
platform can draw from — without a 1-to-1 sponsorship. Pool
beneficiaries are anonymous to the sponsor (only aggregate stats
visible).

## Resolution order in `identify`

```
1. BYO key (client_keys.anthropic) — always wins
2. User's personal M27 sponsorship → uses preferred_model + endpoint
3. Platform pool — consume_pool_slot() round-robin
4. Skip Claude (PlantNet only)
```

`consume_pool_slot()` is `SECURITY DEFINER` + `FOR UPDATE SKIP
LOCKED`, atomically picks an active pool with capacity AND the
caller is under their `daily_user_cap`. Returns NULL if either
check fails — no error thrown, the cascade falls through.

## Create a pool from the UI (PR #215)

Navigate to `/{en,es}/profile/sponsoring/`, scroll to the
**Platform pool** section, click **Donate to pool**. Pick a
credential, set total cap + preferred model + per-user daily cap,
optionally tick **Reset `used` on the 1st of every month**.

The pool appears in the inline list with a progress bar. Use the
inline **Pause** / **Resume** buttons to toggle its status without
revoking the credential.

## Create a pool via SQL (alternative)

For batch operations or scripted setup:

```sql
INSERT INTO public.sponsor_pools (
  sponsor_id, credential_id, total_cap, monthly_reset,
  preferred_model, daily_user_cap, status
)
SELECT auth.uid(),
       (SELECT id FROM public.sponsor_credentials WHERE label = 'My Anthropic key'),
       1000,                       -- total_cap: donate 1000 calls
       true,                       -- monthly_reset: cron auto-resets `used` on the 1st (PR #207)
       'claude-haiku-4-5',         -- preferred_model
       10,                         -- daily_user_cap per beneficiary
       'active';
```

`monthly_reset = true` is now honoured by the
`sponsor_pools_monthly_reset` cron (00:05 UTC on the 1st of each
month). The cron resets `used = 0` and flips `exhausted` →
`active` for any pool with the flag.

## Read aggregate stats (sponsor view)

```sql
SELECT id, total_cap, used, daily_user_cap, status, created_at
  FROM public.sponsor_pools
 WHERE sponsor_id = auth.uid();
```

Top-detected taxa via this pool (privacy-safe — no beneficiary IDs):

```sql
SELECT t.scientific_name, COUNT(*) AS detections
  FROM public.observations o
  JOIN public.taxa t ON t.id = o.primary_taxon_id
  -- Pool consumption isn't joined to ai_usage in v1 — this query
  -- assumes the operator filters by date/sponsor manually. v1.1
  -- adds a join column on ai_usage.pool_id.
 WHERE o.created_at >= now() - interval '30 days'
 GROUP BY t.scientific_name
 ORDER BY detections DESC
 LIMIT 20;
```

## Pause / resume a pool

```sql
-- Pause (calls fall through to "skip Claude" until resumed)
UPDATE public.sponsor_pools SET status = 'paused' WHERE id = '<uuid>' AND sponsor_id = auth.uid();

-- Resume
UPDATE public.sponsor_pools SET status = 'active' WHERE id = '<uuid>' AND sponsor_id = auth.uid();

-- Mark exhausted manually (when the underlying credential is being revoked)
UPDATE public.sponsor_pools SET status = 'exhausted' WHERE id = '<uuid>' AND sponsor_id = auth.uid();
```

## Per-user daily cap

Default: 10 calls/day per beneficiary. Anti-Sybil floor — heavy
users hit the cap and fall through to "skip Claude".

To raise the cap for a specific pool (e.g. researcher pool with
trusted users):

```sql
UPDATE public.sponsor_pools
   SET daily_user_cap = 50
 WHERE id = '<uuid>' AND sponsor_id = auth.uid();
```

The cap is enforced atomically by `consume_pool_slot()` — no
client-side check is honoured. A user can read their own
`pool_consumption` rows but cannot write to them (RLS
default-deny on INSERT for `authenticated`; only `service_role`
writes via the RPC).

## Vacuum the consumption ledger

`pool_consumption` accumulates one row per (user, day) pair. Old
rows past the rolling reset window are dead weight. Until the v1.1
cron lands, run periodically:

```sql
DELETE FROM public.pool_consumption
 WHERE day < current_date - 90;
```

90 days is generous; a 30-day window is also reasonable since the
daily cap only consults `day = current_date`.

## Privacy invariant

Sponsors **never** see which user_ids consumed their pool. The
`pool_consumption` table is queryable by service_role only (writes)
and self-only (reads). No RPC joins `pool_consumption` to
`auth.users`. Aggregate-only sponsor dashboards must use
`observations` joined to `taxa`.

If a sponsor demands beneficiary-level visibility for compliance
reasons (e.g. NPO grant reporting), open a separate spec — v1
deliberately doesn't support this.

## Common failures

| Symptom | Cause | Fix |
|---|---|---|
| `consume_pool_slot()` always returns empty | No pool with `status='active'` AND `used < total_cap`, OR caller hit their daily cap | Verify a pool exists; check `pool_consumption` for the caller's day |
| Sponsor-side dashboard shows `used` not incrementing | `consume_pool_slot()` raised an exception inside the EF — check `[identify] consume_pool_slot failed` warnings in EF logs | Ensure `service_role` has EXECUTE on the RPC; check Vault decryption isn't failing |
| Pool exhausted but `status` still `active` | The "mark exhausted" UPDATE inside the RPC is best-effort and races with the `used + 1` UPDATE in pathological concurrency | Run the manual exhaust UPDATE above |

## Shipped 2026-04-30 (v1.1 follow-ups)

- UI for "Donate to platform pool" + inline progress bar + Pause/Resume (PR #215 / issue #152)
- `sponsor_pools_monthly_reset` cron — 1st of month at 00:05 UTC, resets `used` to 0 + flips `exhausted` → `active` (PR #207 / issue #153)
- `pool_consumption_vacuum` cron — daily at 03:30 UTC, drops rows > 90 days (PR #207 / issue #154)

## v1.1 follow-ups (still open)

- Sponsor dashboard with top-detected-taxa breakdown — needs `ai_usage.pool_id` column
- Pool karma incentives (donate calls → earn karma)
- `ai_usage.pool_id` column so per-pool taxon stats can join cleanly
