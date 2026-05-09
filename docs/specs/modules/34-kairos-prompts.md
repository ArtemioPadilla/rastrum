# M34 — Kairos contextual prompts

> Closes #724. v1 ships only **`golden_hour`**. Other triggers
> (after-rain, migration window, lunar event) are tracked as separate
> issues for v1.1+.

## Why

The most-loved field-naturalist apps don't ping you to "log more
observations" — they nudge you when *now* is the right time. The
golden hour right before sunset is when birds and pollinators are
most active and the light is best for photography.

Strict opt-in. Hard cap of one notification per topic per day. Never
multiple notifications fanned-out from the same trigger.

## Schema

`public.kairos_subscriptions`:

| Column        | Type        | Notes |
|---------------|-------------|-------|
| user_id       | uuid        | PK part 1, FK → `users.id` ON DELETE CASCADE |
| kind          | text        | PK part 2, CHECK IN ('golden_hour') |
| opt_in        | boolean     | NOT NULL DEFAULT false |
| last_sent_at  | timestamptz | NULL until first send; updated atomically by `kairos-fire` |
| created_at    | timestamptz | NOT NULL DEFAULT now() |
| updated_at    | timestamptz | NOT NULL DEFAULT now() |

RLS: `auth.uid() = user_id` for SELECT/INSERT/UPDATE/DELETE.
Service role bypasses for the cron.

`public.push_subscriptions` is reused as-is (already shipped for
streak-push). The `tz` column on each push subscription gates the
"already sent today?" check.

## Cron

`kairos-fire-15min` runs every 15 minutes. The `kairos-fire` Edge
Function:

1. Reads `kairos_subscriptions` rows with `opt_in = true`.
2. For each user: pulls their most recent located observation
   (centroid for sunset computation), falls back to CDMX
   (19.4326, -99.1332).
3. Computes local sunset using the SunCalc-derived algorithm in
   `supabase/functions/_shared/sun.ts` (mirrored at `src/lib/sun.ts`).
4. Checks `inGoldenHourPromptWindow(sunset, now)` — true when `now`
   ∈ [sunset - 30 min, sunset - 15 min].
5. If `last_sent_at`'s tz-local date equals today's tz-local date,
   skip (one-per-day cap).
6. Sends a payload-less Web Push to each of the user's
   `push_subscriptions` endpoints.
7. On any successful send, updates `last_sent_at = now()`.

The EF is deployed `--no-verify-jwt` and gated by `X-Cron-Secret`
(see `_shared/cron-auth.ts`), matching the existing cron pattern.

## Push body

Payload-less. The Service Worker (`public/sw.js`) infers the topic
from the device's local hour:

- `16:00 - 21:00` local → kairos golden-hour copy
- everything else      → streak reminder copy (legacy 8 PM trigger)

Both copies are bilingual (≤ 80 chars). Tapping the kairos
notification opens `/observe`; tapping the streak notification
opens `/profile/notifications/`.

This heuristic is intentionally simple. If we add more kairos
kinds (after-rain, lunar) we'll switch to RFC 8291 encrypted
payloads — tracked separately.

## UI

`/profile/notifications` (EN) and `/perfil/notificaciones` (ES) —
bound to `routes.profileNotifications`. Sections:

- **Field-time prompts (kairos)** — toggle for golden_hour.
- **Streak reminders** — existing section, moved here for grouping.

The Preferences settings tab still hosts the streak toggle and
links to `/profile/notifications/` for the kairos toggle.

## Tests

- `tests/unit/sun-sunset.test.ts` — pins sunset/sunrise math against
  NOAA reference values for CDMX equinox + Tlacolula solstice + polar
  edge cases. Also covers `inGoldenHourPromptWindow` boundaries
  (-30 min, -15 min, in/out).

## Follow-ups (separate issues)

- After-rain trigger (uses `precipitation_24h_mm` + lat/lng radar lookup).
- Migration window trigger (eBird hotspot peaks per region).
- Lunar event trigger (full moon, eclipse — uses existing lunar phase math).
- Encrypted payloads (RFC 8291) so we can carry topic + place name in the push.
- Per-place name in copy ("Atardecer en Tlacolula 18:30 — …").
