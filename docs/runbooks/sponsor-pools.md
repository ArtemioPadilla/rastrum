# Platform-wide AI sponsor pool (M32, #115) — runbook

> **Spec:** [`docs/specs/modules/32-multi-provider-vision.md`](../specs/modules/32-multi-provider-vision.md) (M32 includes both multi-provider + the pool).
> **Schema:** `sponsor_pools`, `pool_consumption`, `consume_pool_slot()` RPC.
> **Status:** backend complete; UI for sponsor controls is v1.1.

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

## Create a pool (no UI yet)

The "Donate to platform pool" tab in `SponsoringView` is v1.1.
Until then, create pools via SQL while signed in as the sponsor:

```sql
INSERT INTO public.sponsor_pools (
  sponsor_id, credential_id, total_cap, monthly_reset,
  preferred_model, daily_user_cap, status
)
SELECT auth.uid(),
       (SELECT id FROM public.sponsor_credentials WHERE label = 'My Anthropic key'),
       1000,                       -- total_cap: donate 1000 calls
       true,                       -- monthly_reset: HONORIFIC in v1; cron is v1.1
       'claude-haiku-4-5',         -- preferred_model
       10,                         -- daily_user_cap per beneficiary
       'active';
```

Note: `monthly_reset = true` does NOT auto-reset `used` to 0 in v1
(the cron is a v1.1 follow-up). Setting it now is forward-compat;
the field is honoured the day the cron lands.

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

## v1.1 follow-ups

- UI for "Donate to platform pool" + sponsor dashboard
- `monthly_reset` cron — first-of-month resets `used` to 0 where flag is true
- `pool_consumption` vacuum cron — drop rows > 90 days old
- Pool karma incentives (donate calls → earn karma)
- `ai_usage.pool_id` column so per-pool taxon stats can join cleanly
