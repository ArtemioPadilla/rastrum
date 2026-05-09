# Rastrum Tasks — Phase Summary

> **Skim-friendly view of [`docs/tasks.json`](tasks.json) + [`docs/progress.json`](progress.json).**
> Source of truth for both surfaces; renders the live page at
> [/docs/tasks/](https://rastrum.org/en/docs/tasks/).
> 
> **Updated:** 2026-05-09 (v1.1.5 Persuasive Tech Audit — Tier S + Tier A + Ola 2b Fogg principles shipped; only PR #771 peer norms remaining in CI. v1.2 research workflow — M28 community discovery, M29 projects, M30 CLI batch import, M31 camera stations, M32 multi-provider vision, obs-detail redesign, admin console PR16 entity browsers; subtask granularity deepened for 53 roadmap items per #180).

---

## At a glance

| Phase | Name | Status | Done / Total |
|---|---|---|---|
| v0.1 | Alpha MVP (online-first) | done | 14 / 14 |
| v0.3 | Offline intelligence + activity | done | 11 / 11 |
| v0.5 | Beta | shipped (partial) | 11 / 13 |
| v1.0 | Public Launch | shipped (partial) | 18 / 21 |
| v1.0.x | Post-launch polish | in_progress | 9 / 25 |
| v1.1 | UX polish + admin console + M22/M26/M27 | shipped (mostly) | 39 / 44 |
| v1.2 | Research workflow (M28-M32 + obs-detail + privacy) | shipped 2026-04-30 | 17 / 17 |
| v1.1.5 | Persuasive Tech Audit (Fogg principles) | Tier S+A+Ola 2b shipped; #771 peer norms in CI | 15 / 16 |
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

**9 of 25 items done.** (Latest done: `posthog-analytics` 2026-05-08 — reverse-proxy snippet + 14 capture sites + exception autocapture + identify/reset on auth + drift CI guards + runbook. See `docs/runbooks/posthog.md`.)

Remaining:

- `megadetector-bbox-cascade-server` — Server-side bbox crop on the identify Edge Function so Claude + PlantNet also receive an animal-only crop  _(· planned — Phi-side already shipped via the client cascade in `megadetector-bbox-cascade`)_
- `speciesnet-distilled` — Distilled SpeciesNet for on-device animal classification (~100 MB ONNX, iWildCam categories) so common camera-trap species don't need cloud LLMs  _(· planned)_
- `arch-diagram-parallel` — Update architecture page cascade SVG to show parallel race (currently shows serial waterfall)  _(✓ done)_
- `identify-server-cascade` — Move runParallelIdentify to identify Edge Function for server-side parity (currently client-only)  _(· planned)_
- `inapp-camera-secondary` — Re-introduce in-app getUserMedia camera as secondary 'preview' path with system camera staying primary  _(! blocked: Awaits feedback from real users — deferred from v1.0 because system camera is more reliable on test devices. GitHub issue #18)_
- `expert-app-admin-ui` — Admin review UI for expert_applications (schema shipped v1.0; admin approve/reject UX missing; **console tab shipped** — `ExpertApplicationsBrowser.astro` + `console-tabs.ts` entry live since admin-console series; closes #328)  _(· planned — remaining: approve/reject actions + email notification)_
- `bioblitz-events-ui-poll` — Bioblitz event detail UI — build when first community organizer requests one  _(! blocked: Speculative without a pilot event. Reshelved here from v1.0 alongside its schema sibling.)_
- `plantnet-quota-monitor` — Alerting / dashboard for PlantNet daily-quota usage (500/day shared); fall through gracefully when exhausted  _(· planned)_
- `oauth-logo-google` — Upload Rastrum logo + privacy/terms URLs at Google Cloud Console OAuth consent screen  _(! blocked: Manual operator action — see GitHub issue #3)_
- `oauth-logo-github` — Upload Rastrum logo at GitHub Developer Settings OAuth app  _(! blocked: Manual operator action — see GitHub issue #3)_
- `tasks-json-deepfill` — Deepen tasks.json subtask granularity where 3-subtask backfill is thin (esp. v1.0 social + tokens items)  _(· in_progress — 53 items expanded from ≤3 to 5–7 specific subtasks per #180)_
- `issue-5-gps-retest` — GPS auto-fill retest on Eugenio's Android device — fix shipped, awaiting confirmation  _(! blocked: Awaits real-device retest — see GitHub issue #5)_
- `issue-18-camera-retest` — 'Tomar foto' retest on Eugenio's Android — Android-specific hint shipped, awaiting confirmation  _(! blocked: Awaits real-device retest — see GitHub issue #18)_
- `smoke-test-nightly` — Nightly cron-fired Playwright smoke test against production rastrum.org (currently only PR-triggered)  _(· planned)_
- `license-per-record-ui` — UI for per-observation license selection (CC-BY default; CC0, CC-BY-NC, all-rights-reserved options)  _(· planned)_
- `docs-toc-mobile` — Sticky scrollspy TOC pill row on mobile doc pages (auto-extracts h2s, IntersectionObserver active state)  _(! blocked: Open PR #23 — pending rebase + aria-current fix; reviewed and approved-with-comments)_

## v1.1 — UX polish (post-launch brainstorm) — shipped (mostly)

**35 of 37 items done.** (Originally 15; added 6 cross-cutting items
shipped 2026-04-27/28: M22, owner CRUD, atomic delete-observation,
suggest-from-share-page, OG pipeline, onboarding v2; then the 16-PR
admin-console series shipped 2026-04-26 → 2026-04-29: PR1-PR16 covering
foundation → engineering hygiene → observability → future-proofing →
deferred cleanup → observability UI surface → entity browsers.)

Admin console "do all" series (2026-04-26 → 2026-04-29):
- `admin-console-foundation` (PR1) → `admin-console-pr16-entity-browsers` (PR16) — schema + chrome + 36 Edge Function handlers + 8 crons + 7 read-only entity browsers across 16 PRs. Full primitives now live: time-bounded role grants, two-person rule with `enforce_two_person_irreversible` feature-flag gate, HMAC-SHA256 webhook subscriptions with `_meta` replay protection + reconcile cron + per-delivery drilldown UI + click-to-replay, hourly anomaly detection, weekly health digest with 12-week sparkline UI + manual recompute, forensics CSV export, structured `function_errors` sink with admin browser tab + single + bulk ack, real moderator trust score, durable observability dry-run workflow, and PR16's read-only browsers over Identifications / Notifications / Media / Follows / Watchlists / Projects / Taxon changes (shared `ConsoleEntityBrowser` template + `entity-browser.ts` runtime, server-side paginated, URL-driven filter state). _(✓ all 16 done)_

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

- `m26-v1-1-review-followups` — Six small polish items flagged by ArtemIO/Nyx on PR #100 + #101 reviews. Shipped 2026-04-29 as PR #149 (ConfirmDialog component replaces `confirm()`/`alert()` in the Block flow + delete-photo flow, matching the `ReportDialog` pattern) + PR #150 (the other 5: `?u=` alias removed since it had zero references, `document.title` → i18n key in PublicProfileViewV2/ExploreSpeciesView/PokedexView, runVisitor error-vs-not-found split, `lib/overflow-menu.ts` extraction across all 3 consumers, `fave_count_aria-{one,other}` naming standardization). _(✓ done)_
- `social-graph-m26-v11` — Follow-ups: ReactionStrip count overlay on feed cards (needs an aggregate RPC to avoid N+1), Block/Report on observation cards + comments, "Block this user" affordance on profile cards in lists, additional ARIA refinements. _(· planned)_
- `deploy-functions-resilience` — Pin esm.sh imports to versioned URLs across `supabase/functions/*/index.ts` so a transient esm.sh 522 doesn't permanently park the auto-deploy. Surfaced when PR #66's auto-deploy 522'd on a Cloudflare hiccup. _(· planned)_
- `visitor-pokedex-route` — Public `/u/<handle>/dex/` page so the Pokédex link on PublicProfileViewV2 doesn't have to be hidden for non-owners (PR #68 currently hides it as a workaround). _(· planned)_

## v1.3 — Module 27: AI Sponsorships — shipped 2026-04-28

**1 item done.** Shipped via PRs #78 (core), #84 (UX polish — 9 gaps), #94 (cobertura completa — stubs activados, request flow, docs page).

- `ai-sponsorships` — Permite a cualquier user compartir su credencial Anthropic (API key u OAuth long-lived token) con beneficiaries específicos. Cuota mensual por llamadas, auto-pause por rate-limit, karma híbrido, y removal del operator-key fallback en `identify`. Entregado: schema (5 tablas + RLS + Vault) + cron jobs + audit log; Edge Functions `sponsorships` (CRUD + heartbeat) e `identify` modificado; UI en `/profile/sponsoring/`, `/profile/sponsored-by/`, banner en `/identify`, discovery card, header dropdown, mobile drawer entries, badge de sponsor + recíproco en perfil público; Resend SMTP para threshold (80%/100%) + auto-pause emails; request-to-be-sponsored flow (5 endpoints + dialogs ambos lados); onboarding tour first-visit + replay; página `/docs/sponsorships` (EN+ES); time range selector 7/30/90 en analytics; report abuse button por beneficiary; CI guards (smoke + secret-leak). **Operator action única:** `gh secret set SPONSORSHIPS_CRON_TOKEN` (hecho). **Operator action opcional:** `gh secret delete ANTHROPIC_API_KEY` (no urgente; identify ya no la lee). _(✓ done)_

### v1.2 shipped 2026-04-29 — Module 28 + observation-detail redesign

Both features landed as 6-PR sequences each. Plans at
`docs/superpowers/plans/2026-04-29-{community-discovery,obs-detail-redesign}-plan.md`,
specs at `docs/superpowers/specs/2026-04-29-*-design.md`.

- `community-discovery-m28` — Walks back the shipped "no leaderboards" stance with
  explicit consent. Explore MegaMenu split (Biodiversity / Community columns).
  `/community/observers/` page with composable filter chips (sort, country, taxon,
  experts-only, nearby) backed by denormalized counters refreshed nightly. Privacy
  gate at the SQL layer via dual views: `community_observers` (anon-safe, no
  centroid) and `community_observers_with_centroid` (authenticated only) plus the
  authenticated-only `community_observers_nearby(...)` SQL RPC for the Nearby
  filter. Country picker + `hide_from_leaderboards` opt-out + `country_code_source`
  'auto'/'user' badge on Profile → Edit. PRs #92 (PR1 schema), #96 (PR2 EF + cron),
  #102 (PR4 Profile → Edit), #122 (PR5+PR6 atomic — page + MegaMenu split + i18n
  rewrite + OG card + roadmap flip). The one-time backfill (formerly PR3 operator
  action) is now automated via the `community-backfill.yml` workflow_dispatch
  button. _(✓ shipped — see `docs/runbooks/community-discovery.md`)_

- `obs-detail-redesign` — Rebuilt `/share/obs/?id=...` as two-column desktop /
  stacked mobile layout. PRs #91 (PR1 — extract reusable `MapPicker.astro` from
  `ObservationForm.astro`), #98 (PR2 — schema deltas: `last_material_edit_at` +
  `media_files.deleted_at` + `observations_material_edit_check_trg` material-edit
  trigger + `observation-enums.ts` + `obs_detail.*` i18n), #103 (PR3 —
  `PhotoGallery.astro` native lightbox + new two-column layout + `ShareObsView`
  i18n migration), #120 (PR4 — `ObsManagePanel.Details` tab: date/time + habitat
  + weather + establishment + sci-name override + notes + obscure-level), #124
  (PR5 — Location tab with coordinate-edit modal via `MapPicker mode='edit'`,
  `pickerId='obs-detail-edit'`, `wireManagePanelLocation` + `pointGeographyLiteral`
  helper), #125 (PR6 — Photos tab + atomic `delete-photo` Edge Function:
  soft-delete + ID demote clearing validated_by/validated_at/is_research_grade +
  last_material_edit_at bump in one transaction via `delete_photo_atomic`
  SECURITY DEFINER RPC). Soft-delete only for v1; R2 orphan GC (`gc-orphan-media`
  cron) is a v1.1 follow-up. _(✓ shipped — see `docs/runbooks/obs-detail-redesign.md`)_

### v1.2 shipped 2026-04-29 — research-workflow modules (M29 / M30 / M31 / M32)

A second wave landed the same day, focused on the CONANP-Oaxaca / DRFSIPS / PROREST 2026 research workflows.

- `projects-anp-m29` — **Module 29 (Projects).** Researchers define a polygon
  (ANP, reserve, sampling grid) at `/{en,es}/projects/<slug>/`, and observations
  whose location falls inside are **auto-tagged via a BEFORE INSERT/UPDATE
  trigger** on `observations`. Schema: `projects` (slug UNIQUE +
  `polygon geography(MultiPolygon, 4326)` + public/private visibility) +
  `project_members` + RLS + GIST index. `upsert_project` is `SECURITY DEFINER`
  (PostgREST can't write geography); the `projects_with_geojson` view ships
  `WITH (security_invoker = true)`. Prerequisite for M30 and M31. PR #132.
  _(✓ shipped — runbook [`docs/runbooks/projects-anp.md`](runbooks/projects-anp.md);
  v1.1 follow-up: surface the link from chrome — currently only reachable via direct URL.)_

- `cli-batch-import-m30` — **Module 30 (CLI batch import).** Node 20+
  TypeScript CLI (`rastrum-import`): walks a directory of camera-trap photos,
  reads EXIF GPS + timestamp, uploads to R2 via the new `POST /api/upload-url`
  Edge Function, and creates an observation through the `rst_*` API token.
  Built for the **CONANP-Oaxaca / DRFSIPS / PROREST 2026** workflow (500–2000
  images per deployment). `--project-slug` auto-tags into the M29 polygon.
  Resumable via state file. PR #134. _(✓ shipped)_

- `camera-stations-m31` — **Module 31 (Camera stations + sampling effort).**
  Schema (PR #141) + create-station UI on the project-detail page
  (PR #213) + `/api/observe camera_station_id` server-side resolution +
  CLI `--project-slug --station-key` flags (PR #208). A camera station is a
  fixed deployment with one or more **active periods** (start/end).
  Standardised wildlife indices (RAI, detection rate per 100 trap-nights,
  species richness) all depend on knowing how long the camera was
  sampling — this module captures that ground truth. Schema:
  `camera_stations` + `camera_station_active_periods`. Depends on M29.
  _(✓ shipped — period management + per-station detection-rate dashboard
  tracked in #224 / #225 as v1.2 follow-ups)_

- `multi-provider-vision-m32` — **Module 32 (Multi-provider vision + per-sponsor
  model + platform pool).** Bundles three closely-coupled M27 extensions that
  share the same provider abstraction: (a) AWS Bedrock provider +
  per-sponsor `preferred_model`; (b) OpenAI / Azure OpenAI / Google Gemini /
  Vertex AI providers; (c) platform-wide call pool (`sponsor_pools` +
  `consume_pool_slot` RPC). `_shared/vision-provider.ts` exports a
  `VisionProvider` interface implemented by 6 concrete providers;
  `buildProvider(credential)` is the single dispatcher. Closes
  #115/#116/#118. PR #143. v1.1 follow-ups all shipped 2026-04-30:
  sponsor UI + Donate-to-pool tab (PR #215), Vertex AI service-account
  auto-rotation (PR #209), pool monthly-reset + ledger-vacuum + Vertex
  expiry-monitor crons (PR #207), nightly per-provider smoke probe
  (PR #210). _(✓ shipped — pool dashboard with top-taxa, cost-per-100
  picker, pool karma incentives tracked as #226/#227/#228)_

## v1.1.5 — Persuasive Tech Audit (Fogg principles) — Tier S+A+Ola 2b shipped; #771 peer norms final

**15 of 16 items done.** A principles-driven UX audit applying B.J. Fogg's
*Persuasive Technology* (Stanford CS) chapter-by-chapter to Rastrum's
existing surfaces. Tier S (foundation), Tier A (transparency + real-world
feel), and Ola 2b (conditioning + suggestion + kairos + cause-and-effect +
variable rewards) all merged 2026-05-08 / 2026-05-09. Only PR #771
(normative-influence peer-norm bars on license / privacy) remains in CI.

### Tier S — shipped 2026-05-08 (Reduction + Praise + Self-monitoring + Social Facilitation + Responsiveness)

- `fogg-quick-observation` — Reduction. One-tap Quick Observation flow (foto + GPS + async ID); long-press the centre FAB or `?quick=1` collapses the standard 5-tap form to a single action; no-GPS path saves as draft + `promoteDraftsWithGps` worker. PR #759 (closes #721). _(✓ done)_
- `fogg-photo-praise` — Praise. EXIF-driven photo praise badge on upload (5 priority-ordered rules: sharp_action, portrait_aperture, long_lens, good_light, balanced_exposure); silent when EXIF missing or ISO ≥ 800 — never aesthetic, never dishonest. PR #757 (closes #733). _(✓ done)_
- `fogg-triage-sla` — Responsiveness. Public roadmap-triage SLA dashboard at `/docs/status/`; nightly workflow computes open count + median first-comment hours + resolved-30d via `gh` CLI, fault-tolerant fallback preserves last good JSON. PR #761 (closes #740). _(✓ done)_
- `fogg-active-observers-banner` — Social Facilitation. Active-observers micro-banner on `/observe` ("Hoy 7 personas observan en Oaxaca · únete"); `community_active_observers_today(p_country)` RPC mirrors the M28 anon-safe predicate (`hide_from_leaderboards = false`). PR #758 (closes #743). _(✓ done)_
- `fogg-falta-dex` — Self-monitoring. "Show missing" toggle on the Pokédex appends silhouette cards for species the user hasn't observed but are present in their region; owner-only; Option A baseline (Rastrum's own data per country, no GBIF ETL). PR #760 (phase-1 of #726, supersedes #561). _(✓ done — runbook [`docs/runbooks/falta-dex.md`](runbooks/falta-dex.md))_

### Tier A — shipped 2026-05-08 / 2026-05-09 (Real-World Feel + Reputed Credibility + Transparency)

- `fogg-field-theme` — Real-World Feel. High-contrast Field theme (Campo) for direct sunlight; pure black bg / white text / no gradients; 1.25× hit-target sizing on mobile FAB + inputs; auto-engages at > 5 000 lux via `AmbientLightSensor` when stored preference is 'auto'. PR #768. _(✓ done)_
- `fogg-about-humanized` — Reputed Credibility. Humanized About page replaces auto-generated copy with team / funding / governance / live-stats / press sections; build-time stats from Supabase REST + publishable anon key; explicit "currently unfunded" framing. PR #770 (closes #739). _(✓ done)_
- `fogg-why-am-i-seeing-this` — Transparency. WhyAmISeeingThis algorithmic disclosure on every ranked surface; single source of truth in `src/lib/algorithms.ts`, global modal pattern (focus trap, Esc/backdrop close), wired today on `community_observers` + `explore_recent` + `explore_species_recent`; new `/docs/algorithms/` reference page enumerates the catalog + 4 principles. PR #772 (closes #738). _(✓ done)_

### Cleanup — superseded features removed

- `fogg-cleanup-superseded` — Net -2048 LOC across 18 files: dropped `DisambiguationBanner` (#684) + `NearbySimilarCard` (#679) + `places-url` (#678) whose user-facing intent is now better served by the Fogg replacements. Replacement intent: #736 "Why this species?" panel (Tier B), #774 contextual species (Tier A in flight), #760 falta-dex (shipped), and the M28 Nearby flow's existing `community_observers_nearby_at` RPC. PR #766. _(✓ done)_

### Ola 2b — shipped 2026-05-09

- `fogg-seasonal-themes` — Conditioning. Seasonal + regional theme variants reflecting MX's ecological calendar: monarca (Oct–Mar), lluvias (Jun–Sep), secas (Apr–May), default (brand emerald). Inline boot script resolves (now, region) before first paint to avoid flicker; 5-button picker in Profile → Apariencia. MX-Norte / MX-Sur fall back to MX-Centro mapping for v1. PR #769 (closes #731). _(✓ done)_
- `fogg-percentile-card` — Self-monitoring. Tú-vs-promedio MX comparison card on `/profile/` (4 metrics × percentile bar); `user_metrics_percentile` MV with `PERCENT_RANK()` over cohort (≥ 5 obs in 90 days, country = MX); refresh wrapped in guarded BEGIN/EXCEPTION inside existing nightly `recompute_user_stats()` cron. Honest fallback when cohort_n < 50. NEVER raw rank, NEVER "people above you" copy — Fogg-ethical normative comparison only. PR #773 (closes #744). _(✓ done)_
- `fogg-contextual-suggestions` — Suggestion Technology. Chip strip on `/observe` surfaces 5–10 species likely at the user's location + month via `probable_taxa_at(p_lat, p_lng, p_month, p_limit)` RPC (`ST_DWithin(50 km)` + month ±1 + research-grade-or-confirmed). Tap pre-fills the manual ID, never auto-submits. Cache layer deferred — live RPC < 300 ms at current scale. PR #774 (closes #723). _(✓ done — runbook [`docs/runbooks/contextual-suggestions.md`](runbooks/contextual-suggestions.md))_
- `fogg-ecological-impact-viz` — Cause-and-Effect. `/profile/impact` (en) / `/perfil/impacto` (es) 5-metric retrospective: Transect-equivalent km, Observations in open-data exports, Expert-confirmed observations, Observations in research projects, At-risk species seen. `compute_user_impact(uuid) → jsonb` SECURITY DEFINER RPC; honest framing renders `—` with `no_data_note` when a metric can't be computed. PR #775 (closes #728). _(✓ done)_
- `fogg-kairos-prompts` — Kairos. Opt-in golden-hour Web Push that fires 15–30 min before local sunset, capped at 1/user/day. `kairos_subscriptions` table + `kairos-fire` Edge Function (`--no-verify-jwt` + `X-Cron-Secret`) scheduled every 15 min via pg_cron; sunset/sunrise via Meeus / SunCalc-derived helper at `src/lib/sun.ts` + `supabase/functions/_shared/sun.ts` (15-test parity vs NOAA). After-rain / migration-window / lunar-event triggers tracked separately for v1.1. PR #777 (closes #724). _(✓ done — module spec [`docs/specs/modules/34-kairos-prompts.md`](specs/modules/34-kairos-prompts.md), runbook [`docs/runbooks/kairos-prompts.md`](runbooks/kairos-prompts.md))_
- `fogg-variable-rewards` — Variable Rewards. Transparent, opt-in `SurpriseOverlay` modal with FIXED catalog of 3 kinds (no runtime extension): `dato_curioso` (10% random per synced obs, requires curated species fact for locale), `rarito` (deterministic — fires when primary taxon's `taxon_rarity.bucket = 'rare'`), `comunidad_activa_hoy` (deterministic — fires when ≥ 2 active observers in user's country today). Hard cap of 1 surprise/day total enforced both client-side (localStorage) and server-side (`record_surprise_event` SECURITY DEFINER). Default-OFF opt-in toggle in Settings → Preferences. Rules disclosed at `/docs/surprises` — Fogg ch. 9 ethics, never slot-machine darkness. PR #779 (closes #727). _(✓ done)_

### Ola 2b — in flight 2026-05-09

- `fogg-peer-norms` — Normative Influence. Show peer norms when configuring license / privacy ("82% of MX observers choose this"); `license_norm` + `privacy_norm` materialised views, `peer_norm_pct(scope, country, key)` SECURITY INVOKER lookup, weekly refresh cron. Defaults are unchanged; copy is informational only. PR #771 (CI in flight, closes #745). _(· in flight)_

---

## Resolved issues

### #328 — AI-mode-selector + expert-applications console tab (closed)

Both features were shipped in prior PRs and are live in the codebase:

- **Expert-applications console tab:** `ExpertApplicationsBrowser.astro` + `console-tabs.ts` entry + EN/ES route pages. Shipped as part of the admin-console series (PR1–PR16). The remaining `expert-app-admin-ui` subtasks (approve/reject actions + email notification) are separate planned work.
- **AI mode selector in ObserveView2:** Three-way toggle (Sponsored / Own key / Local) with `localStorage` persistence under `rastrum.obs2.aiMode`. Shipped as part of the ObserveView2 + ai-sponsorships work.

No code changes needed — this is a docs-only update to reflect completion.
