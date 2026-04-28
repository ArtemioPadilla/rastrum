# Module 26 — Social graph + reactions

**Status:** v1.0 — implementation in progress
**Spec source:** `docs/superpowers/specs/2026-04-28-social-features-design.md`
**Sequenced before:** Module 27 (comments + mentions), Module 28 (real-time + ID-help).

## Scope

- Asymmetric follow with opt-in close-collaborator tier (`follows`, status workflow).
- Per-target reaction tables for observations, photos, identifications.
- Block + report kits.
- In-app notifications with per-kind preferences.
- 90-day pruning of read notifications.

## Out of scope (parked to M27/M28/M29)

- Comments + @mentions (M27).
- Email digests, Resend integration (M27).
- Supabase Realtime subscriptions and per-target mutes (M28).
- Region/taxon groups (M29 if demand).

## Privacy composition

Reactions inherit observation visibility (`obs_public_read`), photo
visibility (existing `media_public_read`), and identification visibility
(`id_public_read`). Two new SQL helpers (`social_visible_to`,
`is_collaborator_of`) extend the existing `is_credentialed_researcher`
fast path so close-collaborators see precise coords on obscured
observations of users they collaborate with.

## Tables

`follows`, `observation_reactions`, `photo_reactions`,
`identification_reactions`, `blocks`, `reports`, `notifications`. Counter
columns added to `users`. See the design spec for full DDL.

## Edge Functions

`follow`, `react`, `report`. All `verify_jwt=true`. Rate-limits enforced
in-function via windowed `count(*)` over the source tables.

## Risks

See "Risks and open questions" in the design spec.
