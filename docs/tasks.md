# Rastrum Tasks — Phase Summary

> **Skim-friendly view of [`docs/tasks.json`](tasks.json) + [`docs/progress.json`](progress.json).**
> Source of truth for both surfaces; renders the live page at
> [/docs/tasks/](https://rastrum.org/en/docs/tasks/).
> 
> **Updated:** 2026-04-27 (post-launch + v1.1 cross-cutting shipments + on-device MegaDetector cascade).

---

## At a glance

| Phase | Name | Status | Done / Total |
|---|---|---|---|
| v0.1 | Alpha MVP (online-first) | done | 14 / 14 |
| v0.3 | Offline intelligence + activity | done | 11 / 11 |
| v0.5 | Beta | shipped (partial) | 11 / 13 |
| v1.0 | Public Launch | shipped (partial) | 18 / 21 |
| v1.0.x | Post-launch polish | in_progress | 8 / 24 |
| v1.1 | UX polish (post-launch brainstorm) | shipped (mostly) | 19 / 21 |
| v1.2 | Profile privacy & public profile | shipped 2026-04-28 | 3 / 3 |
| **v0.1 → v1.0** | **Public launch** | **shipped 2026-04-26** | **54 / 59** |

Phases v1.5, v2.0, v2.5 are tracked in [`progress.json`](progress.json) but have no shipped code yet — they are planned scope only.

Rationale for each v1.1 UX item lives in [`docs/runbooks/ux-backlog.md`](runbooks/ux-backlog.md).

---

## v0.1 — Alpha MVP (online-first) — done

**14 of 14 items done.**

All items shipped. ✅

## v0.3 — Offline intelligence + activity — done

**11 of 11 items done.**

All items shipped. ✅

## v0.5 — Beta — in progress / planned

**11 of 13 items done.**

Remaining:

- `gbif-ipt` — GBIF IPT pilot publish (Darwin Core Archive ZIP)  _(! blocked: GBIF publisher account + IPT host (DwC-A generator landed))_
- `local-contexts` — Local Contexts BC/TK Notice integration  _(! blocked: Governance track — community consent before code)_

## v1.0 — Public Launch — in progress / planned

**18 of 21 items done.**

Remaining:

- `bioblitz-events-ui` — Bioblitz events — UI (event detail page, live aggregates, participation badges)  _(! blocked: Build when first community organizer requests one — speculative without a pilot event)_
- `capacitor-ios` — Capacitor iOS App Store wrapper (v1.2)  _(! blocked: Apple Developer Program ($99/yr) + Capacitor build pipeline)_
- `oauth-custom-domain` — Custom auth domain on Supabase OAuth (auth.rastrum.org instead of raw Supabase URL)  _(! blocked: Supabase Pro plan ($25/mo) — deferred for zero-cost target)_

## v1.0.x — Post-launch polish — in_progress

**8 of 24 items done.**

Remaining:

- `megadetector-bbox-cascade-server` — Server-side bbox crop on the identify Edge Function so Claude + PlantNet also receive an animal-only crop  _(· planned — Phi-side already shipped via the client cascade in `megadetector-bbox-cascade`)_
- `speciesnet-distilled` — Distilled SpeciesNet for on-device animal classification (~100 MB ONNX, iWildCam categories) so common camera-trap species don't need cloud LLMs  _(· planned)_
- `arch-diagram-parallel` — Update architecture page cascade SVG to show parallel race (currently shows serial waterfall)  _(· planned)_
- `identify-server-cascade` — Move runParallelIdentify to identify Edge Function for server-side parity (currently client-only)  _(· planned)_
- `inapp-camera-secondary` — Re-introduce in-app getUserMedia camera as secondary 'preview' path with system camera staying primary  _(! blocked: Awaits feedback from real users — deferred from v1.0 because system camera is more reliable on test devices. GitHub issue #18)_
- `expert-app-admin-ui` — Admin review UI for expert_applications (schema shipped v1.0; admin approve/reject UX missing)  _(· planned)_
- `bioblitz-events-ui-poll` — Bioblitz event detail UI — build when first community organizer requests one  _(! blocked: Speculative without a pilot event. Reshelved here from v1.0 alongside its schema sibling.)_
- `plantnet-quota-monitor` — Alerting / dashboard for PlantNet daily-quota usage (500/day shared); fall through gracefully when exhausted  _(· planned)_
- `oauth-logo-google` — Upload Rastrum logo + privacy/terms URLs at Google Cloud Console OAuth consent screen  _(! blocked: Manual operator action — see GitHub issue #3)_
- `oauth-logo-github` — Upload Rastrum logo at GitHub Developer Settings OAuth app  _(! blocked: Manual operator action — see GitHub issue #3)_
- `tasks-json-deepfill` — Deepen tasks.json subtask granularity where 3-subtask backfill is thin (esp. v1.0 social + tokens items)  _(· planned)_
- `issue-5-gps-retest` — GPS auto-fill retest on Eugenio's Android device — fix shipped, awaiting confirmation  _(! blocked: Awaits real-device retest — see GitHub issue #5)_
- `issue-18-camera-retest` — 'Tomar foto' retest on Eugenio's Android — Android-specific hint shipped, awaiting confirmation  _(! blocked: Awaits real-device retest — see GitHub issue #18)_
- `smoke-test-nightly` — Nightly cron-fired Playwright smoke test against production rastrum.org (currently only PR-triggered)  _(· planned)_
- `license-per-record-ui` — UI for per-observation license selection (CC-BY default; CC0, CC-BY-NC, all-rights-reserved options)  _(· planned)_
- `docs-toc-mobile` — Sticky scrollspy TOC pill row on mobile doc pages (auto-extracts h2s, IntersectionObserver active state)  _(! blocked: Open PR #23 — pending rebase + aria-current fix; reviewed and approved-with-comments)_

## v1.1 — UX polish (post-launch brainstorm) — shipped (mostly)

**19 of 21 items done.** (Originally 15; added 6 cross-cutting items
shipped 2026-04-27/28: M22, owner CRUD, atomic delete-observation,
suggest-from-share-page, OG pipeline, onboarding v2.)

Cross-cutting shipments (2026-04-27/28):
- `community-validation` — Module 22 implementation: `validation_queue` view, 3 RLS policies, 4 routes, suggest modal + dashboard, research-grade chip on existing views, suggest CTA on `/share/obs`.  _(✓ done)_
- `owner-observation-crud` — Manage panel on share/obs (notes / scientific-name override / obscure_level / delete) + atomic `delete-observation` Edge Function (no orphan R2 blobs).  _(✓ done)_
- `og-pipeline` — Build-time satori PNGs for static pages + client-side renderer at sync time for user content; manifest has screenshots + 192px icon for richer install UI.  _(✓ done)_
- `ux-onboarding-v2` — 4-step pipeline setup (explain → configure → summary → install) with WCAG focus trap, replay event, telemetry, Anthropic key live verify, missing model rows. See [`docs/runbooks/onboarding-events.md`](runbooks/onboarding-events.md).  _(✓ done)_

Remaining:

- `ux-indigenous-taxa-search` — Indigenous-language taxon search (Zapoteco / Náhuatl / Maya / Mixteco / Tseltal → scientific name); requires corpus + governance per local-contexts  _(! blocked: Needs corpus partnership (CONABIO + community Co-PIs) and governance review before code lands)_
- `ux-streak-push` — Web Push notification at 8 PM local when a streak is 1 day from breaking — opt-in only, single nightly notification  _(· planned)_

## v1.2 — Profile privacy & public profile — shipped 2026-04-28

**3 of 3 items done.** Shipped via PRs #38 (spec), #40 (v1.2.0 foundation), #41 (v1.2.1 widgets).

- `profile-privacy-matrix` — Per-facet visibility matrix on `users.profile_privacy` (19 keys × 3 levels) with 3 presets, `can_see_facet()` SQL helper, 10 facet-gated views. Replaces module 08's binary `profile_public`; tightens module 23's `user_expertise_public_read` policy. _(✓ done)_
- `public-profile-route` — `/u/?username=` route with hero + observation map + stats counts + validation reputation + karma section + Pokédex link; static `noindex,nofollow` meta; 301 redirect from legacy `/profile/u/?username=…`. _(✓ done)_
- `profile-widgets-richer` — Calendar heatmap, taxonomic donut, streak ring, top species grid, observation mini-map, badges grid, activity timeline, Pokédex page, intro banner; reused on `/profile/` (owner). _(✓ done)_

**v1.2.2 cleanup deferred:** visitor `/u/<username>/dex/` route, `Person` JSON-LD on PublicProfileViewV2, wire widgets into visitor `/u/<username>/`, migrate `share/obs/index.astro` off `profile_public`, drop legacy `profile_public` boolean (one-release safety net runs out at v1.3).

## v1.2 — Module 26: Social graph + reactions — shipped 2026-04-28/29

**3 items done, 1 follow-up todo.** Shipped via PRs #43 (foundation), #62 (CI/CD revamp + MIN(uuid) fix), #63 + #64 (UI integration + polish).

- `social-graph-m26` — Asymmetric follow + opt-in close-collaborator tier; per-target reaction tables (`observation_reactions`, `photo_reactions`, `identification_reactions`); blocks (read-symmetric); reports queue; in-app inbox with 90-day prune cron; `social_visible_to()` + `is_collaborator_of()` STABLE SQL helpers; fan-out triggers (follow → notification, observation_reactions → notification, with block-aware skip); three Edge Functions (`follow`, `react`, `report`) with inline windowed `count(*)` rate-limits. _(✓ done)_
- `ci-cd-edge-auto-deploy` — Path-filtered auto-deploy of Edge Functions on push to `main` (mirrors `db-apply.yml`). Filesystem-derived "all functions" list eliminates drift between the UI dropdown enum and the deploy loop. Manual `workflow_dispatch` preserved for surgical rollback. Same PR fixed a `MIN(uuid)` schema bug in `profile_top_species` that was blocking subsequent `db-apply` reruns. _(✓ done)_
- `social-graph-m26-ui` — UI integration so the M26 surfaces are discoverable from the chrome: BellIcon repointed to `/inbox` with unread badge from `notifications`; rich notification cards (avatars + thumbnails + type-coded icons + skeletons + wildlife empty state); profile follower/following pills + ⋮ overflow menu (Block + Report); shared `ReportDialog` modal mounted globally in `BaseLayout` (focus trap, Esc, backdrop close, reason radio + optional note); `FollowButton` swapped to call the m26 `follow` Edge Function with a 4th "Requested" state for private profiles; `ReactionStrip` rewritten to self-hydrate and wired interactive on `/share/obs/`. _(✓ done)_

Remaining:

- `social-graph-m26-v11` — Reaction count chip on feed cards (`observation_reaction_summary` view with `security_invoker = true`, batched fetch with no N+1), overflow ⋮ menu (Block + Report) on observation cards via the existing `PublicProfileViewV2` pattern, per-comment Block/Report in `Comments.astro` (lazy import of `blockUser`), ARIA refinements (live region on ReactionStrip toggle, role=menu/menuitem on overflows, aria-label per InboxView row), 12 new i18n keys under `socialgraph.cards.*` + `socialgraph.reactions.*`. _(✓ done — PR #101)_
- `deploy-functions-resilience` — Pinned `@supabase/supabase-js@2` → `@2.39.7` across 24 Edge Function files so a transient esm.sh 522 (which broke PR #66's auto-deploy until manual workflow_dispatch backfill) can't park the auto-deploy in a failed state again. _(✓ done — PR #97; one follow-up sub-item still planned: pin imports in PR #99's 5 new admin handlers once #99 merges)_
- `visitor-pokedex-route` — Public `/{en,es}/u/dex/?username=<handle>` route. Parametrized `PokedexView.astro` with a visitor mode prop, gated by `can_see_facet(target, 'pokedex', viewer)` RPC, EN+ES paired pages with `noindex,nofollow`, OG card via `profile-dex-visitor` slug, un-hid the Pokédex link in `PublicProfileViewV2` (was workaround-hidden in PR #68), 7 new `pokedex.visitor_*` i18n keys. _(✓ done — PR #100)_

### Bundled review follow-ups still planned

- `m26-v1-1-review-followups` — Six small polish items flagged by ArtemIO/Nyx on PR #100 + #101 reviews: `?u=` alias documentation, `document.title` → i18n key, runVisitor error-vs-not-found split, `ConfirmDialog` component to replace `confirm()`/`alert()` in the Block flow (matches `ReportDialog` pattern), extract overflow-menu logic into `lib/overflow-menu.ts` (currently duplicated 3× across `PublicProfileViewV2`, `ExploreRecentView`, `Comments`), and `fave_count` data-attr naming standardization across feed views. All non-blocking; deferred for a deliberate v1.2 polish sweep. _(· planned)_
