# Karma Phase 1 — Post-Merge Verification (2026-04-28)

Module 23 Phase 1 (`feat/karma-phase-1`, PR #36, squash-merged as
`c8af5ac`). This runbook captures the state of the database immediately
after the schema landed and `gh workflow run db-apply.yml -f
run_rarity_refresh=true` fired.

## Infrastructure check — all green

| Check | Result |
|---|---|
| `user_expertise`, `taxon_rarity`, `karma_events` tables exist | ✅ all 3, all `rowsecurity = true` |
| Karma functions installed | ✅ `award_karma`, `compute_ancestor_path`, `refresh_taxon_rarity`, `recompute_consensus` |
| Cron `refresh-taxon-rarity-nightly` | ✅ `0 3 * * *`, `active = true` |
| Trigger `trg_taxa_ancestor_path` on `public.taxa` | ✅ wired |
| `users.grace_until` backfill for existing users | ✅ all 6 users have a value |
| Smoke verify (post-apply) | 23 public tables, 22 with RLS, 1 without (`spatial_ref_sys` from PostGIS — expected) |

## Data state — dormant, by design

| Metric | Count | Why |
|---|---|---|
| `observations` total | 1 | Platform is brand-new in prod; only one test observation logged |
| `identifications` total | 0 | No cascade has resolved an ID yet |
| `taxa` total | 0 | The cascade inserts `taxa` lazily on first identification |
| `karma_events` total | 0 | `award_karma` fires only when an observation crosses to research-grade |
| `taxon_rarity` rows | 0 | `refresh_taxon_rarity()` ran but had 0 taxa to bucket |
| `user_expertise` rows | 0 | Migration shim ran but `users.is_expert = true` count is 0 |
| `users.is_expert = true` | 0 | No experts approved yet |
| Users in grace | 6 | Backfill correctly applied `created_at + 30 days` |

The karma engine is correctly installed and waiting. It will start producing
data when:

1. Real observations get processed by the cascade (PlantNet / Claude /
   Phi-vision) → cascade upserts `taxa` rows on first encounter.
2. Multiple users vote on the same observation → `recompute_consensus`
   evaluates weighted score per taxon.
3. Consensus crosses to research-grade → `award_karma` fires for all
   voters, populating `karma_events`, `users.karma_total`, and
   `user_expertise`.

## How to repeat this verification

```bash
make db-psql -c "
SELECT 'observations'        AS metric, count(*)::text FROM public.observations
UNION ALL SELECT 'identifications',     count(*)::text FROM public.identifications
UNION ALL SELECT 'taxa',                count(*)::text FROM public.taxa
UNION ALL SELECT 'taxon_rarity',        count(*)::text FROM public.taxon_rarity
UNION ALL SELECT 'user_expertise',      count(*)::text FROM public.user_expertise
UNION ALL SELECT 'karma_events',        count(*)::text FROM public.karma_events
UNION ALL SELECT 'users.is_expert',     count(*)::text FROM public.users WHERE is_expert
UNION ALL SELECT 'users in grace',      count(*)::text FROM public.users WHERE grace_until > now();
"
```

## Known follow-on work (tracked separately)

- **Expert-approval hook.** The `is_expert → user_expertise` migration shim
  is a one-shot at `db-apply` time. When a user is approved as an expert
  *after* the shim ran (via the `expert_applications` flow in module 22),
  no `user_expertise` row is created automatically. Phase 2 should either
  add the equivalent INSERT to the approval handler, or wire a trigger on
  `users.is_expert` flipping to `true`.

- **2-week audit (`trig_01JUvvKSbu2YukPK3jwg6tW5`).** Scheduled to fire
  2026-05-12 09:00 America/Mexico_City. If the platform is still
  pre-launch with sparse data at that point, push the audit further out —
  the calibration verdict needs at least dozens of consensus events to be
  meaningful.

## See also

- Design: `docs/superpowers/specs/2026-04-27-karma-expertise-rarity-design.md`
- Phase 1 plan: `docs/superpowers/plans/2026-04-27-karma-expertise-rarity-phase-1.md`
- Module spec: `docs/specs/modules/23-karma-expertise-rarity.md`
- Auto-apply workflow: `.github/workflows/db-apply.yml`
