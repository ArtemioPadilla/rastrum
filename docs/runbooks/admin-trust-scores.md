# Moderator trust scores (v1 placeholder)

PR13 lays the SQL primitive for a per-moderator "trust score"
(0-100). v1 deliberately ships a placeholder formula — the goal is
to cement the API surface and the data flow before tuning the
heuristic.

## SQL surface

```
public.compute_moderator_trust_score(p_user_id uuid) RETURNS numeric
public.moderator_trust_scores      -- view, joins user_roles + the function
```

The function:

* Returns `NULL` when the user is neither moderator nor admin.
* Counts unacknowledged anomalies attributed to the user (PR12's
  `admin_anomalies.actor_id`).
* v1 formula: `greatest(0, 100 - (unack_anomalies * 8))`. New mods
  with no anomalies float at 100; one unack drags them to 92, ten
  drags to 20, twelve+ to 0.

## UI surface

The Users tab activity panel shows the score under
"Trust score" when it's non-NULL. No standalone leaderboard view
yet — v1.1 may add a `/console/credentials` column.

## Future formula iterations (v1.1+)

The placeholder is intentionally simplistic. Better signals to weave
in:

1. **Overturn rate** — a `report.dismiss` reversed by a different
   moderator within 7 days = bad outcome. Penalize.
2. **Recency weighting** — old anomalies decay in penalty over time.
3. **Action volume normalization** — five anomalies on a moderator
   who handled 500 reports is different from five on a moderator who
   handled 50.
4. **Disposition recall** — if the moderator dismisses reports that
   later get re-filed by different users + accepted by different
   moderators, that's a disposition-quality signal.

Any change to the formula must:

1. Bump the function definition with `CREATE OR REPLACE FUNCTION`.
2. Ship in the same PR as a runbook update + an admin-audit note
   describing the change.
3. Be reversible — keep the previous formula as a documented
   default in case the new one mis-fires under real usage.
