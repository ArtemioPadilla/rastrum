# Moderator trust scores (v1.1)

PR13 shipped the SQL primitive with a deliberately simple placeholder
formula (100 minus 8 per unacknowledged anomaly). PR14 promotes it to
v1.1 — a weighted formula with four signals. The API surface is
unchanged; consumers do not need to redeploy.

## SQL surface

```
public.compute_moderator_trust_score(p_user_id uuid) RETURNS numeric
public.moderator_trust_scores      -- view, joins user_roles + the function
```

The function returns `NULL` when the user is neither moderator nor
admin. Otherwise it returns a numeric in `[0, 100]`.

## v1.1 formula

```
base               = 70
anomaly_factor     = -8 × unack_anomalies_last_30d
overturn_penalty   = -25 × overturn_rate
action_volume      = +30 × min(1, sqrt(active_days_last_90d / 30))
recency_bonus      = +5 if any admin_audit row in the last 7 days

score = clamp(0, 100, base + anomaly_factor + overturn_penalty
                          + action_volume + recency_bonus)
```

Where:

* **`unack_anomalies_last_30d`** — count of `admin_anomalies` rows
  with `actor_id = user` AND `acknowledged_at IS NULL` AND
  `created_at >= now() - 30d`. Older anomalies decay to zero weight.
* **`overturn_rate`** — fraction of `report.dismiss` actions in the
  last 90 days where the same `target_id` later received a
  `report_resolve` from a *different* actor within 7 days.
  `0` when the moderator hasn't dismissed any reports.
* **`active_days_last_90d`** — count of distinct calendar days
  (UTC `date_trunc('day', …)`) the moderator wrote ≥ 1 audit row.
  The sqrt-then-cap shape gives a smooth ramp: 5 active days ≈ +12,
  10 ≈ +17, 30 → +30 (cap).
* **`recency_bonus`** — flat +5 if the moderator acted at all in the
  last 7 days.

### Worked examples

| Profile                                       | active_days | unack | overturn | recent | score |
|---|---|---|---|---|---|
| New mod, no actions yet                       | 0           | 0     | 0        | false  |  70   |
| Healthy mod (steady, clean)                   | 30          | 0     | 0        | true   | 105 → 100 |
| Healthy mod (light, clean)                    | 5           | 0     | 0        | true   |  ~87  |
| Active but with 2 unacknowledged anomalies    | 30          | 2     | 0        | true   |  ~89  |
| Mod whose 50% of dismissals get re-opened     | 30          | 0     | 0.5      | true   |  92.5 |
| Stale mod (last action > 7d ago, no anomalies)| 5           | 0     | 0        | false  |  ~82  |

The numbers are illustrative; the goal of the score is to give an
admin reviewing the moderator panel a single comparable summary, not
to pass a hard "below threshold = revoke" gate.

## UI surface

The Users tab activity panel shows the score under "Trust score" when
it's non-NULL. A standalone leaderboard view is on the v1.2 ideas list.

## Operator workflow

The score is read-only — there is no UI to override it. If a score
seems wrong:

1. Look up the moderator's recent `admin_audit` activity in the
   Forensics tab.
2. Look up their unacknowledged anomalies in the Anomalies tab and
   either acknowledge (with a note) or escalate.
3. The score will reflect the change on the next page load — the
   function is `STABLE` and computed live, no cache.

## Versioning rules

Any change to `compute_moderator_trust_score()` MUST:

1. Bump the version comment block at the top of the function
   definition AND the version line at the top of this file.
2. Ship in the same PR as a runbook entry explaining the rationale
   and including before/after worked examples for at least three
   archetype mods.
3. Be reversible — keep the previous formula as a documented
   reference in case the new one mis-fires under real usage.

## v1.2 ideas

Signals worth adding once we have enough usage data to calibrate
weights:

1. **Disposition recall** — if the moderator dismisses reports that
   later get re-filed by *different users* and accepted by *different
   moderators*, that's a stronger overturn signal than a single
   resolve. Could replace the current overturn approximation.
2. **Consensus alignment** — when a moderator approves an ID that
   later loses consensus or is overturned, that's a quality signal.
   Lives across `identifications` + `admin_audit` and would need a
   dedicated view.
3. **Standalone leaderboard** — a `/console/credentials` column or a
   dedicated `/console/trust` tab with a sortable list of mods +
   their current scores + a 30-day sparkline. Currently the Users
   tab is the only surface.
4. **Per-action calibration** — the current formula treats all
   `admin_audit` ops as equally weighted for `active_days`. A
   `comment.lock` and a `user.ban` are not the same action; weighing
   high-impact ops more would penalise mods who only ever lock
   comments.

When implementing any of these, follow the versioning rules above.
