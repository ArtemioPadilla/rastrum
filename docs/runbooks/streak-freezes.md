# Streak Freeze Runbook (#866)

## Overview

Streak freezes are auto-consumed credits that preserve a user's streak when they miss a day. Introduced in v1.5 to reduce rage-quit churn (Duolingo-style; ~13% lift in 7-day retention on streak cohort).

## How It Works

1. **Earning:** +1 freeze is granted every 7-day streak milestone (cur_streak % 7 == 0). Hard cap: **2**.
2. **Consuming:** When `recompute_streak` detects a missed day (`CURRENT_DATE - last_qualifying_day > 1`), it checks `streak_freezes_available`. If > 0: streak is preserved, freeze decremented, `streak_freeze_used` incremented, and a `karma_events` row is inserted with `reason='streak_freeze_consumed'` and `delta=0`.
3. **Reset:** If `streak_freezes_available == 0` at miss time, streak resets to 0 as before.

## Schema Columns (user_streaks)

| Column | Type | Default | Notes |
|--------|------|---------|-------|
| `streak_freezes_available` | `smallint` | 0 | Hard cap 2; decremented on use |
| `streak_freezes_used` | `integer` | 0 | Lifetime count (transparency) |
| `streak_freeze_last_used_at` | `timestamptz` | null | Shown in freeze ledger |

## Database Function

`public.recompute_streak(p_user_id uuid)` — SECURITY DEFINER, REVOKED FROM PUBLIC, GRANTED TO service_role.

Called nightly by the `recompute-streaks` Edge Function.

## UI

- **Home streak pill** (`HomeWidgets.astro`): shows ❄️ + count badge when `streak_freezes_available > 0`. Hidden at 0 (no shaming).
- **Profile freeze ledger** (`ProfileView.astro`): `<details>` disclosure showing available count, last used date, and lifetime count. Tooltip explains mechanic *before* it's needed (Fogg honesty principle).

## Operator Notes

### Granting freezes manually

```sql
UPDATE public.user_streaks
SET streak_freezes_available = LEAST(streak_freezes_available + 1, 2)
WHERE user_id = '<uuid>';
```

### Checking freeze audit trail

```sql
SELECT created_at, delta, reason
FROM public.karma_events
WHERE user_id = '<uuid>' AND reason = 'streak_freeze_consumed'
ORDER BY created_at DESC;
```

### Resetting a user's freeze state

```sql
UPDATE public.user_streaks
SET streak_freezes_available = 0
WHERE user_id = '<uuid>';
```

## Out of Scope (v1.5)

- Streak repair (retroactive) — v2.0
- Vacation mode (multi-day pause) — v2.0
- Push notification on freeze consumption — v1.6 (after #800 ships)
