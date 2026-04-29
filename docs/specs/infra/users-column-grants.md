# `public.users` column-level GRANT inventory

**Last verified:** 2026-04-29 (after M26 follower counters landed via PR #68)

The `public.users` table has a column-level UPDATE GRANT to the
`authenticated` role to prevent self-elevation of fields like
`is_expert` / `karma_total` / streak counters via a hand-crafted
PostgREST call. RLS WITH CHECK can only gate rows, not columns —
this GRANT pattern is the actual mechanism. Authoritative SQL lives
in `docs/specs/infra/supabase-schema.sql` near the
`grants_locked_columns` block (search for
`REVOKE UPDATE ON public.users FROM authenticated`).

When you add a new trigger, function, or column that needs to write
to `users`, **check this table first**. If the column you want to
update is in the *locked* set, the function must run as
`SECURITY DEFINER` (bypasses the GRANT) — otherwise the write fails
with `permission denied for table users` and rolls back the parent
operation. This is exactly the bug that broke the M26 `follow` Edge
Function until PR #68: `tg_follows_counter` ran as INVOKER and tried
to update `follower_count`, which is locked.

## Writable by `authenticated` (column-level UPDATE granted)

These are the user-controllable profile fields. A signed-in user can
PATCH their own row through PostgREST, gated by RLS on row.

| Column | Type | Used by |
|---|---|---|
| `username` | text (unique, regex-checked) | Profile edit, username generator |
| `display_name` | text (≤80 chars) | Profile edit |
| `bio` | text (≤500 chars) | Profile edit |
| `avatar_url` | text | Profile edit (R2 upload) |
| `region_primary` | text | Profile edit |
| `preferred_lang` | text (enum: es/en/zap/mix/nah/myn/tzo/tze) | Language selector |
| `observer_license` | text (enum: CC BY 4.0 / CC BY-NC 4.0 / CC0) | Profile edit |
| `profile_public` | boolean | Legacy (m08); superseded by `profile_privacy` but still writable |
| `gamification_opt_in` | boolean | Settings → Preferences |
| `streak_digest_opt_in` | boolean | Settings → Preferences |
| `profile_privacy` | jsonb | PrivacyMatrix component (m25) |
| `dismissed_privacy_intro_at` | timestamptz | "Got it" button on the privacy intro banner |
| `expert_taxa` | text[] | Self-declared expertise (read-only metadata; expert status itself is gated separately) |
| `country_code` | text (ISO-3166 alpha-2) | Profile edit (m28 community discovery) |
| `country_code_source` | text ('auto' / 'user') | Profile edit (m28); flipped to 'user' on every save so the "inferred from your region" badge disappears |
| `hide_from_leaderboards` | boolean | Profile edit (m28); inverted UI ("Show me in community discovery and leaderboards") |

## Locked (UPDATE blocked at column level)

These columns are written ONLY by SECURITY DEFINER functions, admin
flows, or system triggers. A direct `update users set <col> = …`
from `authenticated` is denied.

| Column | Writer | Why locked |
|---|---|---|
| `id` | `auth.users` FK | Primary key, immutable |
| `created_at` / `joined_at` | column DEFAULT now() on INSERT | Audit columns; immutable after creation |
| `updated_at` | `tg_users_touch_updated_at` BEFORE UPDATE trigger | Audit column; trigger sets `NEW.updated_at = now()` so clients shouldn't touch it (and the GRANT prevents it). Bug surfaced when ProfileEditForm was setting it from the client → 403. |
| `is_expert` | `expert_applications` admin flow + `is_expert_in()` SQL | Self-elevation would let anyone weight their votes |
| `credentialed_researcher` / `credentialed_at` / `credentialed_by` | admin grant | Unlocks precise coords on sensitive species |
| `karma_total` / `karma_updated_at` / `vote_count` | karma engine triggers (SECURITY DEFINER) | Self-bump would game leaderboards + vote weighting |
| `grace_until` | karma onboarding (SECURITY DEFINER) | Backfilled to `created_at + 30 days`; users shouldn't extend their own grace period |
| `observation_count` | `tg_observation_count` trigger | Denormalised stat; trigger keeps it consistent |
| `last_observation_at` | `tg_observation_count` trigger | Same |
| `stats_cached_at` / `stats_json` | nightly stats refresh job | Server-rolled aggregates |
| `follower_count` / `following_count` | `tg_follows_counter` trigger (SECURITY DEFINER, M26) | Self-bump would inflate social-graph signal |

## Pattern checklist for new triggers / functions

When adding code that writes to `users`, work through this:

1. **Identify the column.** Find the row in the inventory above.
2. **Writable column?** No special handling — invoker permissions
   suffice. The function can be `SECURITY INVOKER` (default).
3. **Locked column?** The function MUST be `SECURITY DEFINER`. Add
   `SET search_path = public` in the same statement (defense against
   search-path manipulation). Drop a one-line comment explaining
   *which locked column* drove the choice — future readers will
   thank you.
4. **Adding a new locked column?** Update this doc + add a brief
   comment on the column's `ADD COLUMN IF NOT EXISTS` line in
   `supabase-schema.sql`.
5. **Adding a new writable column?** Update both this doc AND the
   `GRANT UPDATE (…) ON public.users TO authenticated` block. They
   must stay in lock-step.

## Why we have this pattern

RLS is row-level: it gates *which rows* an actor can read, write, or
delete. It cannot gate *which columns* an actor can update on a row
they otherwise own. Without column-level GRANTs, a signed-in user
could craft a PATCH against their own row and flip
`is_expert = true`, `karma_total = 999999`, etc. — all of which are
their own row, all of which RLS would happily allow.

Column-level GRANTs are Postgres's native answer to this. They're
verbose to maintain (every new locked column = one more line to
review) but the alternative — a separate "user-private" view that
authenticated users update through, with a security-definer trigger
that enforces field-level write rules — is significantly more code
for the same result.

The brittleness Nyx flagged in PR #68 is real: as more triggers
touch `users`, more of them will need `SECURITY DEFINER`, and a
forgotten one fails silently (the parent INSERT just rolls back).
This doc is the inventory we'll consult before writing the next one.
