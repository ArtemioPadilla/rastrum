# Module 23 — Karma, Per-Taxon Expertise, and Rarity Multiplier

**Status:** Phase 1 implemented · Phases 2–3 deferred
**Implements:** the v1.2 future-work line in module 22 (weighted votes by reputation).

## Summary

A continuous reputation system layered on top of module 22's community
validation engine. Three signals:

1. **karma_total** — global score, gates platform privileges over time.
2. **user_expertise(user_id, taxon_id, score)** — per-taxon score that
   replaces the binary `users.is_expert + expert_taxa` weighting in
   `recompute_consensus`. Granularity is rank-aware (kingdom →
   species) via `taxa.ancestor_path` array overlap.
3. **taxon_rarity(bucket, multiplier)** — nightly-materialized
   percentile buckets that scale rewards (rarer = more karma).

## Reward formula

`win_delta  =  +5  ×  rarity_multiplier  ×  streak_multiplier  ×  expertise_multiplier  ×  confidence_factor`
`loss_delta =  −2  ×  min(rarity_multiplier, 2.0)  ×  confidence_factor`

Loss only fires when a deeper-expertise voter wins consensus.
Users in their first 30 days OR first 20 votes are penalty-immune
(grace period).

## Data model (additive)

- New tables: `user_expertise`, `taxon_rarity`, `karma_events`.
- New columns: `users.karma_total`, `users.karma_updated_at`,
  `users.grace_until`, `users.vote_count`, `taxa.ancestor_path uuid[]`,
  `taxa.parent_id uuid`.
- New functions: `compute_ancestor_path()`, `taxa_set_ancestor_path()`,
  `refresh_taxon_rarity()`, `award_karma()`. Replaced:
  `recompute_consensus()` (uses user_expertise instead of is_expert).
- New cron: `refresh-taxon-rarity-nightly` at 03:00 UTC.

## Backwards compatibility

`users.is_expert` and `users.expert_taxa` remain readable. A migration
shim hydrates `user_expertise` from these columns at apply time. The
columns will be dropped one release cycle after Phase 1 ships.

## Performance

Per consensus event: ~10–20 ms added (rarity lookup + ancestor_path
overlap + ledger insert + user/expertise update). Storage at 10k-user
scale: ~500 MB/year. No new Edge Functions in v1; weekly digest lands
in Phase 2.

## See also

- Full design rationale + UX decisions:
  `docs/superpowers/specs/2026-04-27-karma-expertise-rarity-design.md`
- Phase 1 implementation plan:
  `docs/superpowers/plans/2026-04-27-karma-expertise-rarity-phase-1.md`
- Module 22 (consensus engine, expertise weight integration point):
  `docs/specs/modules/22-community-validation.md`
