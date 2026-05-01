# Deprecation Plan: users.profile_public

> Tracked by issue #251. The `profile_public` boolean column on `public.users`
> is superseded by the `profile_privacy` JSONB matrix (Module 25, v1.2.0).

## Background

The original `profile_public` boolean was a simple on/off toggle for profile
visibility. Module 25 introduced a per-facet privacy matrix (`profile_privacy`)
that gives users granular control over what's visible (observations, stats,
badges, location, etc.).

## Current usage (as of v1.0.1)

| File | Usage | Migration path |
|---|---|---|
| `src/lib/types.ts` | `UserProfile.profile_public` field | Keep for backward compat until v1.2 |
| `src/lib/community.ts` | Visibility check in community queries | Replace with `profile_privacy` check |
| `supabase/functions/share-card/index.ts` | OG card observer name gating | Replace with `profile_privacy.display_name` |
| `docs/specs/infra/supabase-schema.sql` | Column definition + RLS policies | Add deprecation comment, keep column |
| `src/components/ProfileEditForm.astro` | "Profile visible" checkbox | Wire to both columns during transition |

## Migration plan

### Phase 1 (v1.0.x) — current
- Add `@deprecated` annotations to code that reads `profile_public`
- Document this plan (this file)
- Both columns coexist; `profile_public` is the source of truth for legacy code

### Phase 2 (v1.1)
- New code reads from `profile_privacy` matrix exclusively
- Profile Edit form writes to BOTH columns on save (dual-write)
- Add a migration function that backfills `profile_privacy` from `profile_public`
  for users who haven't set the matrix yet

### Phase 3 (v1.2)
- Remove all reads of `profile_public`
- Stop dual-writing
- Add `ALTER TABLE users DROP COLUMN IF EXISTS profile_public` to schema
- Remove from `UserProfile` type

## Decision log

- 2026-05-01: Deprecation plan created (issue #251)
- Target removal: v1.2 (after profile_privacy has been live for one release cycle)
