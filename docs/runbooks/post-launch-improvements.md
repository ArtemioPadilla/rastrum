# Post-launch improvements — checklist (2026-04-27)

> Living checklist of the 17 items surfaced during the v1.0 family-launch
> debug session (CORS bug → 12-hour outage). Each item has a rationale,
> a concrete acceptance criterion, and a current status. Companion to
> `docs/progress.json` (which tracks the *roadmap*); this file tracks
> the *operational* punch list that came out of real-user pain.

Status emoji:
`[x]` shipped · `[ ]` open · `[~]` in-flight

---

## How to use

- Pick an item, flip its checkbox to `[~]` while you work, `[x]` when
  it lands. Add the commit SHA to its row.
- New items go at the bottom; renumber only when a whole section retires.
- This file is engineering-only; the user-facing roadmap lives in
  `progress.json`.

---

## Tier 1 — operational hardening (the "never again" tier)

These exist because today's CORS bug went undetected for 12 hours. Each
one closes a class of failure that was invisible in production.

- [x] **#1 SW VERSION bump.** Bump `VERSION` in `public/sw.js` so every
      existing user gets the update toast on next visit. Without this,
      users running the broken-CORS bundle stay on it until their cache
      TTL elapses.
- [ ] **#2 Sync-failure telemetry.** New `supabase/functions/sync-error`
      endpoint; `syncOutbox` calls `navigator.sendBeacon` with `{user_id,
      error_message, blob_count}` after `failed > 0`. No PII; enough to
      catch the next CORS-bug-class regression in minutes, not hours.
      *Acceptance: a deliberate failure on staging fires exactly one
      beacon and lands in `public.sync_failures`.*
- [x] **#3 Bust CORS preflight cache on deploy.** Append `?v=<build>` to
      the `get-upload-url` invocation so a cached negative preflight
      from a prior broken state can't survive a deploy.
- [ ] **#7 Edge Function CORS audit in CI.** A test that hits `OPTIONS`
      on every deployed Edge Function and asserts
      `access-control-allow-origin` is set. Runs in PR (against staging)
      and post-deploy. *Acceptance: deleting CORS from any function fails
      CI.*
- [ ] **#8 Rate-limit `get-upload-url` per user.** ~60 mints/min per
      user_id; 429 above. Prevents accidental retry storms (#5/#6 will
      both auto-flush) and abuse on the shared R2 free tier.
- [ ] **#9 Self-healing error rows.** Postgres cron scans
      `observations.sync_status='error'` older than 24 h, surfaces a
      banner ("3 photos didn't upload — review them") on next visit.
      Closes the loop on rows the auto-retry-on-mount missed.

## Tier 2 — UX gaps surfaced during family launch

- [ ] **#4 PlantNet 404/quota soft-fail.** Treat 404 + 429 as "skip this
      runner", not "all failed". Cascade falls through to Claude / Phi.
      *Today, exhausting the shared 500/day key freezes the cascade.*
- [ ] **#5 Drafts auto-promote on GPS arrival.** `registerSyncTriggers`
      scans drafts whose location got filled in (manual entry or fresh
      GPS) and flips `sync_status` from `'draft'` → `'pending'`.
- [ ] **#6 Share-when-synced intent.** Share button on a pending row
      queues the intent; fires `navigator.share()` after `rastrum:sync-
      row-done` matches the row id.
- [ ] **#10 Identify-only quota gate.** `/es/identificar` is currently
      open to anonymous users; one bad actor with a script can drain the
      shared PlantNet quota. Either (a) gate behind sign-in or (b)
      rate-limit per-IP at the Edge Function. (a) is simpler.
- [ ] **#11 Map shows pending Dexie rows.** `ExploreMap` reads from
      Supabase only; merge in Dexie unsynced rows so the user's
      just-uploaded pin appears immediately.
- [ ] **#12 Mobile keyboard avoidance on submit.** Add
      `scroll-margin-bottom` + a sticky submit footer so the iOS/Android
      keyboard doesn't hide the Save button when the notes textarea is
      focused.
- [ ] **#13 Offline banner.** Passive banner ("Sin conexión —
      guardando localmente") whenever `navigator.onLine === false`,
      even with empty queue. Today the user has zero proactive signal.

## Tier 3 — performance / size

- [ ] **#14 Lazy-load WebLLM.** `local-ai.ts` pulls ~600KB into every
      page transitively. Move to dynamic `import()` gated on user
      opt-in. *Wins ~600KB on the cold-load path for the 95% of users
      who never use Phi.*
- [ ] **#15 `MyObservationsView` N+1 query.** Joined-select issues
      one round-trip per row. Replace with a single denormalised RPC
      (`my_observations_page`) returning `{obs, primary_photo,
      primary_id}` flat. *100 rows → 1 query, not 100.*

## Tier 4 — out-of-scope-but-valuable

These don't fit v1.0.x but are tracked here so they don't get lost.

- [ ] **#16 Resend SMTP runbook.** Switch from Supabase built-in SMTP
      (3 emails/hour cap) to Resend (3k/mo free). Document config +
      DNS + Supabase dashboard steps.
- [ ] **#17 Stripe Pro tier skeleton.** Webhook handler + `users.tier`
      flip on `checkout.session.completed`. Schema already has the
      column. Wiring only.

---

## OG cards — current architecture (2026-04-27)

> The Open Graph image system was rebuilt to remove all per-request
> server-side compute. The pattern is borrowed from watchboard.

**Rendering pipeline:**

| Surface | When rendered | Where stored | Render path |
|---|---|---|---|
| Static pages (home, observe, identify, explore, chat, about, docs/*) | Build time, via `npm run build:og` | `public/og/<slug>.png` → shipped to GitHub Pages | satori → resvg-js → PNG |
| User observations | Client-side, at observation save | R2: `og/<obs-id>.png` (served by `media.rastrum.org`) | satori → SVG → OffscreenCanvas → PNG |
| User profiles | Client-side, on Profile → Edit save | R2: `og/u/<username>.png` (served by `media.rastrum.org`) | satori → SVG → OffscreenCanvas → PNG |

**Per-request compute: zero.** All cards are static files served by CDN
(GitHub Pages or Cloudflare R2). The renderer runs once per piece of
content (build time for static pages, client-side at save for user
content) and never again.

**Shared layout:** `src/lib/og-layout.ts` exports a single satori
React-element tree builder used by both renderers. Edit there once;
both paths produce identical cards.

**Known limitation:** the static `/share/obs/?id=…` page can't insert a
per-observation `og:image` meta tag at HTML build time (the obs ID
isn't known then), so it falls back to the generic `/og/default.png`
when scraped. The per-observation PNG still exists at
`media.rastrum.org/og/<obs-id>.png` and can be embedded directly in
shares (the Share button → Web Share API does this), but the static
share page cannot reference it without server templating. Closing
this last gap requires either a thin Cloudflare Worker on the share
URL OR pre-rendering one HTML file per observation; both are
explicitly out of scope for the "no per-request server" target.

## Done log (this PR)

| # | Item | Commit |
|---|---|---|
| 1 | SW VERSION bump | TBD |
| 3 | CORS preflight cache bust | TBD |
| 4 | PlantNet 404/quota soft-fail | TBD |
| 5 | Drafts auto-promote | TBD |
| 6 | Share-when-synced | TBD |
| 7 | Edge CORS CI audit | TBD |
| 11 | Map shows pending rows | TBD |
| 12 | Mobile keyboard avoidance | TBD |
| 13 | Offline banner | TBD |
| 14 | Lazy-load WebLLM | TBD |
| 15 | MyObservations N+1 | TBD |

(Update this table as items merge — `git log --oneline -- '*<item>*'` works.)

## Beyond the original 17 — shipped 2026-04-27/28

These weren't in the original post-launch list; they emerged during
the family-launch debugging + Module 22 implementation cycle.

| Theme | Item | Commit |
|---|---|---|
| **Module 22** | Community-validation spec v1.0 → v1.3 (Copilot + audit revisions) | `3853f59` |
| | Module 22 implementation: SQL + 3 components + 4 routes + chip + nav | `e40cea7` |
| | Validate card surfaced on `/explorar/` index | `4ff9487` |
| | Suggest CTA + community-IDs list on every `/share/obs/?id=` | `9f03eb5` |
| **Owner CRUD** | Manage panel on share/obs (notes/scientific-name/obscure/delete) | `b364866` |
| | `delete-observation` Edge Function — atomic R2+DB delete (no orphans) | `51aa558` |
| **Activity feed** | Hydrate per-row photo + species + click target | `21be914` |
| **Share page** | LEFT join on identifications so unidentified obs show "Unknown species" instead of 404 | `6476c9e` |
| **OG pipeline** | Build-time satori for static pages + client-side at sync | `0a22e2e` |
| | Profile OG card on Profile→Edit save | `220dbd5` |
| | Manifest cleanup (192px icon, screenshots, `mobile-web-app-capable`, `related_applications`, isPwaInstalled) | `d26aece` |
| **Auth + Eugenio** | resolveObserverRef no longer downgrades signed-in users to guest | `92cdf24` |
| | Manual `username` patch for Eugenio's pre-onboarding row | (SQL, ad-hoc) |
| **Sync hardening** | Web Locks across tabs + beforeunload during in-flight upload | `a7b6e0a` |
| | get-upload-url CORS + R2 secret rotation via CI sync | `3596fd0` |
| **Console hygiene** | mobile-web-app-capable + password-fields-in-form | `e75f83c` |
| | Firefox-aware install hint (Android menu vs. desktop fallback) | `c63035d` |

The "remaining items" from the original 17 (#2 sync-failure telemetry,
#9 self-healing error rows, #16 Resend SMTP, #17 Stripe Pro tier) are
all still scaffolded but intentionally not turned on — they ship when
the corresponding business need arrives.
