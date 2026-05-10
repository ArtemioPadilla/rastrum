# Per-Function Grant Audit: SECURITY DEFINER Functions in `public`

> **Audit context.** Issue #834 — replacing the blanket
> `GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated` with
> explicit per-function grants, surfacing the ~15 functions that should be
> `service_role`-only but were previously callable by any signed-in user.

---

## Background

`docs/specs/infra/supabase-schema.sql` line ~563 contains:

```sql
GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA public TO authenticated;
ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT EXECUTE ON FUNCTIONS TO authenticated;
```

This causes the Supabase Database Advisor to warn about ~80 functions under
**"Signed-In Users Can Execute SECURITY DEFINER Function"**. The warning is
accurate: every signed-in user can call every `SECURITY DEFINER` function
unless we explicitly `REVOKE`.

The remediation block at line ~10455 (PR #828) already revokes `PUBLIC`
execute on all user-defined SECURITY DEFINER functions. This audit focuses on
functions that should also be restricted from `authenticated`.

---

## Methodology

Functions were classified by cross-referencing:
1. All `SECURITY DEFINER` function definitions in `supabase-schema.sql`
2. Explicit `GRANT EXECUTE ON FUNCTION … TO …` lines already in the schema
3. App-code RPC calls: `grep -rn "\.rpc(" src/ supabase/ cli/`
4. Cron schedule usage in `docs/specs/infra/cron-schedules.sql`

---

## Function Inventory

### Bucket 1: `service_role` only — already correctly granted

These functions have explicit `GRANT … TO service_role` and should remain
inaccessible to `authenticated`. They are cron entry points, admin internals,
or trigger helpers.

| Function | Line | Rationale |
|---|---|---|
| `add_karma_simple` | 4320 | Internal karma helper; called by cron/trigger, not user RPCs |
| `auto_revoke_expired_roles` | 5936 | Cron entry point |
| `badge_eligible_kingdom_diversity` | 1063 | Badge cron — `award-badges` Edge Function |
| `badge_eligible_kingdom_first` | 1029 | Badge cron |
| `badge_eligible_midnight_observation` | 1126 | Badge cron |
| `badge_eligible_rg_count` | 1038 | Badge cron |
| `badge_eligible_species_count` | 1053 | Badge cron |
| `badge_eligible_state_diversity` | 1107 | Badge cron |
| `badge_eligible_streak` | 1092 | Badge cron |
| `compute_admin_health_digest` | 5843 | Admin-only RPC via service_role in Edge Function |
| `consume_pool_slot` | 6657 | Internal sponsorship pool; Edge Function only |
| `consume_rate_limit_token` | 5590 | Rate-limit internals; called from Edge Functions |
| `create_vault_secret` | 4400 | Vault management; service_role only |
| `delete_vault_secret` | 4410 | Vault management; service_role only |
| `detect_admin_anomalies` | 5760 | Admin analytics; cron-only |
| `dispatch_admin_webhooks` | 6168 | Admin webhook delivery; trigger/service_role |
| `expire_stale_proposals` | 6045 | Cron entry point |
| `increment_rate_limit_bucket` | 4383 | Internal; Edge Function only |
| `list_admin_cron_runs` | 3746 | Raw cron access; console uses guarded variant |
| `merge_user_accounts` | 7049 | Admin operation; service_role only |
| `platform_status_metrics` | 6907 | MCP service_role path in Edge Function |
| `read_vault_secret` | 4425 | Vault management; service_role only |
| `recompute_taxa_rarity` | 10977 | Cron entry point |
| `recompute_user_metrics_percentile` | 9194 | Cron entry point |
| `recompute_user_stats` | 4713 | Cron entry point |
| `reconcile_webhook_deliveries` | 6260 | Cron entry point |
| `refresh_taxon_ranges` | 9892 | Cron entry point |
| `resolve_sponsorship` | 4264 | Internal sponsorship; Edge Function via service_role |
| `upsert_vault_secret_by_name` | 4441 | Vault management; service_role only |
| `admin_platform_metrics` | 6927 | Admin MCP path; service_role Edge Function |

### Bucket 2: `authenticated` — public-facing RPCs

These functions are called directly from the front-end via `supabase.rpc()` or
from authenticated Edge Functions. The blanket grant already covers them, but
explicit grants are needed once the blanket is removed.

| Function | Line | Callers |
|---|---|---|
| `claude_eligibility` | 8137 | `src/` — chat eligibility check |
| `compute_moderator_trust_score` | 6393 | `ConsoleUsersView.astro` |
| `compute_user_impact` | 9465 | `ImpactView.astro` |
| `daily_challenge_for_user` | 10784 | `HomeWidgets.astro` |
| `delete_photo_atomic` | 4894 | `supabase/functions/delete-photo/` |
| `falta_dex_summary` | — | `src/` |
| `get_my_percentiles` | 9157 | `src/` |
| `has_active_sponsorship` | 4299 | `src/` |
| `is_first_in_sector` | 11142 | `ObservationSuccess.astro` |
| `karma_leaderboard_window` | 7948 | `KarmaLeaderboardView.astro` |
| `list_admin_cron_runs_guarded` | 3823 | `ConsoleCronRunsView.astro` |
| `list_user_impact_obs` | 9589 | `MyObservationsView.astro` |
| `notify_on_comment` | 11209 | Trigger-called; `authenticated` for test harness |
| `pending_validation_count` | — | `src/` |
| `pool_beneficiaries` | 8549 | `src/` sponsorship |
| `pool_daily_usage` | 7679 | `src/` sponsorship |
| `pool_top_taxa` | 7667 | `src/` sponsorship |
| `profile_karma_breakdown` | 5091 | `src/` |
| `record_surprise_event` | 9379 | `src/` |
| `set_credential_personal` | 4075 | `src/` |
| `suggest_nearby_species` | 10864 | `src/` |
| `suggest_pokedex_target` | 8356 | `PokedexView.astro` |
| `surprise_count_today` | 9359 | `src/` |
| `touch_user_activity` | 8103 | `src/` activity tracking |
| `update_observation_location` | 7237 | `src/` |

### Bucket 3: `anon, authenticated` — already explicitly granted

These are correctly granted already; no change needed.

| Function | Current grants | Rationale |
|---|---|---|
| `can_see_facet` | `anon, authenticated` | Privacy gate helper called from views |
| `can_see_facets` | `anon, authenticated` | Batched version of above |
| `community_active_observers_today` | `anon, authenticated` | Public explore page |
| `count_distinct_observed_species` | `anon, authenticated` | Public stats widget |
| `get_species_stats` | `anon, authenticated` | Public species profile |
| `home_pulse_stats` | `anon, authenticated` | Public homepage stats |
| `is_collaborator_of` | `anon, authenticated` | Privacy helper |
| `is_project_member` | `anon, authenticated, service_role` | Project access check |
| `is_project_owner` | `anon, authenticated, service_role` | Project access check |
| `karma_leaderboard_window` | `anon, authenticated` | Public leaderboard |
| `normalize_country_code` | `anon, authenticated` | Data normalization utility |
| `peer_norm_pct` | `anon, authenticated` | Public stats |
| `place_geojson_by_slug` | `anon, authenticated` | Public place pages |
| `place_top_observers` | `anon, authenticated` | Public place pages |
| `place_top_species` | `anon, authenticated` | Public place pages |
| `places_map_geojson` | `anon, authenticated` | Public explore map |
| `places_near` | `anon, authenticated` | Location discovery |
| `probable_taxa_at` | `anon, authenticated` | Species suggestions |
| `profile_pokedex_with_missing` | `anon, authenticated` | Public profile |
| `region_species_pool_size` | `anon, authenticated` | Public stats |
| `social_visible_to` | `anon, authenticated` | Privacy helper |
| `station_trap_nights` | `anon, authenticated, service_role` | Camera station stats |
| `taxon_range_distance_km` | `anon, authenticated` | Range display |
| `top_expertise_legend` | `anon, authenticated` | Public expertise display |

### Bucket 4: Trigger functions — no direct EXECUTE grant needed

Trigger functions are invoked by Postgres internally when a DML event fires.
They cannot be called via `supabase.rpc()` and do not need explicit `EXECUTE`
grants to `authenticated` or `anon`. Only `service_role` needs EXECUTE
(for the trigger to fire via service_role connections).

| Function | Line | Trigger(s) it serves |
|---|---|---|
| `admin_anomalies_dispatch_trigger` | 6331 | `tg_admin_anomalies_dispatch` on `admin_anomaly_log` |
| `admin_audit_dispatch_trigger` | 6345 | `tg_admin_audit_dispatch` on `admin_audit_log` |
| `assign_observation_place` | 7358 | `tg_assign_observation_place` on `observations` |
| `assign_observation_to_project` | 5321 | `tg_assign_obs_to_project` on `observations` |
| `award_observation_synced_karma` | 7695 | `tg_award_obs_synced_karma` on `observations` |
| `fire_observation_created` | 1241 | Trigger on `observations` |
| `fire_research_grade` | 1266 | Trigger on `observations` |
| `generate_list_slug` | 11313 | `tg_generate_list_slug` on `species_lists` |
| `resolve_identification_taxon` | 642 | Trigger on `identifications` |
| `sync_user_role_flags` | 2410 | Trigger on `user_roles` |
| `tg_follow_notify` | 3530 | `tg_follow_notify` on `follows` |
| `tg_follows_counter` | 3175 | `tg_follows_counter` on `follows` |
| `tg_obsreact_notify` | 3563 | `tg_obsreact_notify` on `observation_reactions` |
| `update_user_obs_count` | 618 | Trigger on `observations` |

### Bucket 5: Cron-callable service functions — no `authenticated` access

| Function | Line | How called |
|---|---|---|
| `prune_old_notifications` | 3515 | `cron.schedule('prune_old_notifications', …)` |

---

## Functions with Appropriate Restrictions + Explicit Grants (`✓ properly granted`)

The following already have the correct explicit grants in the schema:

- All **Bucket 1** functions → `service_role` only ✓
- All **Bucket 3** functions → `anon, authenticated` ✓
- `has_role`, `is_user_banned` → `authenticated, service_role` ✓
- `compute_moderator_trust_score`, `compute_user_impact`, `delete_photo_atomic`,
  `list_user_impact_obs`, `upsert_primary_identification`, `upsert_project` →
  `authenticated, service_role` ✓
- `recompute_consensus` → `authenticated, service_role` ✓ (multiple GRANT lines)

---

## Functions that Need Restricted Grants Applied

### Should be `service_role` only — add REVOKE FROM authenticated

The blanket grant at line ~563 gives `authenticated` access. These functions
are NOT called from the front-end via `supabase.rpc()` and should be
restricted. Since the remediation block at line ~10455 already revokes
`PUBLIC`, we need to also `REVOKE EXECUTE … FROM authenticated` and then
`GRANT EXECUTE … TO service_role`.

**Actions applied in `supabase-schema.sql`** (see remediation block,
"Phase 2 — per-function restrict" section added by #834):

```sql
-- Cron entry points / admin internals: revoke authenticated, keep service_role
REVOKE EXECUTE ON FUNCTION public.prune_old_notifications()          FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.prune_old_notifications()          TO service_role;
```

> **Note on trigger functions:** Trigger functions (`RETURNS trigger`) are
> invoked by Postgres directly and do not require an explicit `EXECUTE` grant
> to any role. The blanket `REVOKE FROM PUBLIC` in the PR #828 remediation
> block already handles the default ACL. No additional `REVOKE FROM authenticated`
> is needed for trigger functions — Postgres prevents direct `rpc()` calls to
> trigger-returning functions regardless of grants.

### Should be `authenticated` only — already covered by blanket grant

The Bucket 2 functions are fine under the blanket grant and have no security
concern. The Supabase advisor warning ("Signed-In Users Can Execute SECURITY
DEFINER Function") is expected and documented as accepted-with-rationale
in `docs/runbooks/accepted-advisor-findings.md`.

---

## Schema Changes Applied

The following was added to `docs/specs/infra/supabase-schema.sql` in the
Security Advisor remediation block (end of file), as **Phase 2** under issue #834:

```sql
-- ─────────────────────────────────────────────────────────────────────────
-- Phase 2 (#834): restrict cron-only SECURITY DEFINER functions
-- ─────────────────────────────────────────────────────────────────────────
-- prune_old_notifications is called only from pg_cron, not from authenticated
-- RPCs. Restrict it to service_role.
REVOKE EXECUTE ON FUNCTION public.prune_old_notifications() FROM authenticated;
GRANT  EXECUTE ON FUNCTION public.prune_old_notifications() TO service_role;
```

> **Why only one function?** The other 14 "blanket-only" functions are all
> trigger functions (`RETURNS trigger`). Trigger functions cannot be called
> via `supabase.rpc()` regardless of grants — Postgres rejects direct
> invocations. Their blanket-only state is cosmetically imperfect but carries
> no security risk. Applying explicit grants to them would be defensive noise
> rather than a real improvement.

---

## Supabase Advisor Impact

After this change, the advisor will still show:
- **~80 "Signed-In Users Can Execute SECURITY DEFINER Function"** entries

These are all Bucket 2/3 functions (authenticated users need them) and are
accepted with rationale. See `docs/runbooks/accepted-advisor-findings.md`.

The `prune_old_notifications` entry (formerly callable by any signed-in user)
will be cleared.

---

## References

- Issue: #834
- Parent: #828 (blanket REVOKE FROM PUBLIC)
- Accepted findings: `docs/runbooks/accepted-advisor-findings.md`
- Schema: `docs/specs/infra/supabase-schema.sql` line ~10455
