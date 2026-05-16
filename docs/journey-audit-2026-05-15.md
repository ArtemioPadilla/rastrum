# Journey audit — 2026-05-15 production walkthrough

> Traceability record for the manual end-to-end audit of `rastrum.org`
> done with Claude-in-Chrome on 2026-05-15 (including write paths), the
> bugs it found (#1070–#1098), where each fix landed, and which
> committed `journey-*.spec.ts` now guards each journey against
> regression. Companion to [`qa-policy.md`](qa-policy.md) (test policy)
> and [`fogg-audit.md`](fogg-audit.md) (v1.1.5 persuasive-tech audit).

---

## 1. Two journey systems — reconciled

There are **two** distinct things called "journeys" in this repo. They
are not the same and were not previously cross-referenced:

| | **Automated suite** | **Manual production audit** |
|---|---|---|
| What | 21 `tests/e2e/journey-*.spec.ts` Playwright specs | A human-driven Claude-in-Chrome walkthrough of live `rastrum.org`, write paths included |
| Documented in | [`docs/superpowers/specs/2026-05-15-1031-tier1d-journey-specs-design.md`](superpowers/specs/2026-05-15-1031-tier1d-journey-specs-design.md) ("The 10 journeys" table) + plan doc | **This document** (previously undocumented — only the resulting issues + the fix-grouping spec existed) |
| Purpose | Regression gate in CI (`e2e.yml`) | Discovery — find bugs static tests miss on real data/auth/network |
| Cost | Free, headless, mocked auth | Real account, real Supabase, real R2, real model spend |

The automated suite is the *floor*; the manual audit is the *discovery
pass* that produced #1070–#1098. This doc closes the loop between them.

---

## 2. Manual audit methodology

- **Tool:** Claude-in-Chrome MCP (not Playwright). Live site, real
  signed-in account (`artemiopadilla@gmail.com`).
- **Scope:** all primary user journeys *including writes* — observe +
  photo upload, identify cascade, explore/map, social engage, profile/
  watchlist, projects, researcher export, admin/console, delete.
- **Environment limits encountered:** `file_upload` MCP tool blocked
  (photos uploaded manually by the user); native `confirm()`/`alert()`
  auto-dismissed by automation (this itself surfaced #1093/#1095/#1096);
  AI model round-trips **not** exercised (cost / BYO-key — see §4).
- **Step-trace caveat:** no contemporaneous per-step log was kept during
  the *original discovery* walkthrough. The §3 per-journey findings are
  reconstructed from the filed issues and the fix PRs, which are
  authoritative. Treat the "walked" column as the journey class
  exercised, not a verbatim script.
- **Superseded for verification by §8.** On **2026-05-16** a *fresh,
  contemporaneous* Claude-in-Chrome sweep was run against production
  with live console + network error capture (signed-in admin). §8 is
  the real route-by-route matrix — it confirms the §3 fixes hold in
  prod **and** found two bugs (#1112, #1113) the reconstruction missed.
  Where §8 and §5 disagree, §8 (verified) wins.

---

## 3. Findings traceability (16 issues → fixes → regression spec)

Authoritative fix grouping is the 5 thematic groups (G1–G5) in
[`2026-05-15-audit-fixes-implementation-design.md`](superpowers/specs/2026-05-15-audit-fixes-implementation-design.md).
All 16 issues are **CLOSED**; all landing PRs are **MERGED** except
#1101 (auto-merge armed, blocked only on its e2e gate).

> Issue→PR note: GitHub auto-links only the first issue in a comma-list
> `Closes:` (see [`reference_ci_quirks`]), so per-issue PR numbers below
> are by thematic batch + API-confirmed links, not a 1:1 GitHub link.

| Journey class walked | Finding | Issue | Group | Landed in | Regression spec |
|---|---|---|---|---|---|
| Explore → Places | `/explore/places` & `/explorar/lugares` dead — `ReferenceError: lang is not defined` | #1070 | G1 | G1 frontend PR | `journey-guest-browse.spec.ts` (Explore nav) |
| Explore index | Duplicate "Lugares" tile, both → same dead route | #1077 | G1 | G1 frontend PR | `journey-guest-browse.spec.ts` |
| Home (signed-in) | HEAD `observations observed_at=gte` returns 503 every load (count→limit) | #1072 | G5 spike | G5 fix | `journey-observer-first-obs.spec.ts` |
| Streak / "observed today" | Boundary used UTC midnight, not user-local day | #1073 | G1 | G1 frontend PR | covered by TZ-pinned unit suite (`vitest TZ=UTC`) |
| Observe → success CTA | "Ver observación" → "Observation not found" until outbox sync (~25 s) | #1074 | G1 | G1 frontend PR + #1100 friendly not-found | `journey-observer-first-obs.spec.ts` |
| List/grid cards | Broken observation thumbnails (home, recientes, especies) | #1075 | G1 | **#1095** | `journey-guest-browse.spec.ts` |
| Any signed-in first paint | gotrue "Lock not released within 5000 ms" + duplicate `user_roles` fan-out | #1076 | G5 spike | **#1090** (roles cache) + **#1101** (root-cause: 7→1 listeners) | `journey-magic-link-pkce-callback.spec.ts`, all `authedPage` journeys |
| i18n — nearby-species card | "<1 kmaún no en tu dex" — missing separator | #1078 | G2 | G2 copy PR | unit i18n parity |
| i18n — Pokédex empty state | Wrong copy when user has unconfirmed observations | #1079 | G2 | G2 copy PR | `journey-falta-dex-region-pool.spec.ts` |
| PWA install | `manifest start_url` hardcoded `/en/` — ES users get English app | #1080 | G1 | G1 frontend PR | `tests/e2e/pwa.spec.ts` |
| Maps (explore vs community/share) | Basemap inconsistency — PMTiles dark vs OSM raster | #1081 | G1 | **#1091 / #1092** (decision: maps follow theme) | manual / visual |
| Admin → role.grant | Insert → "permission denied for table users" (recurring `handler_exception`) | #1071 | G3 (ask-first) | **#1091** schema (post-approval) | `journey-admin-health.spec.ts` |
| Admin → report.resolve | `handler_exception` "target not found" | #1082 | G4 EF | **#1089** | `journey-mod-flags.spec.ts` |
| CLAUDE.md (M28 paths) | `/comunidad/observers` stale → `/observadores` | #1083 | G2 | G2 docs commit | n/a (doc) |
| Delete observation | `delete-observation` EF unreachable — users cannot delete | #1093 | post-audit | **#1094** (self-gate `verify_jwt`) + **#1095** (in-UI confirm) | `journey-share-observation-public.spec.ts` (owner controls) |
| Delete observation | POST hangs `pending` — gotrue auth-lock steal + no timeout/error UX | #1098 | post-audit | **#1099** (R2 AbortController + client timeout) + **#1100** (post-delete UX) + **#1101** (root cause) | as above + `journey-*` authed paint |

Supporting PRs not tied to one issue: **#1096** (eliminate all native
browser dialogs — in-UI confirm/toast/slide-over, prompted by the
#1093 automation finding), **#1097** (audit-fixes design spec +
implementation plan).

---

## 4. Chat / "Ask Rastrum" / AI-assistant journeys

**This is a documented coverage gap, not a passed journey.**

### Surfaces

| Surface | File | Entry |
|---|---|---|
| Chat page | `src/pages/{en,es}/chat.astro` → `ChatView.astro` | Header **Chat** item; route slug pair `chat: { en: '/chat', es: '/chat' }` (same slug both locales) |
| "Ask Rastrum" / "Pregunta a Rastrum" | `AskRastrumButton.astro` | Deep-link `/{lang}/chat/?attach=<kind>:<id>` — drops into observation, species, project, observer, and self-profile surfaces (`💬` button, ghost/primary variants) |
| Entity attach picker | `ChatEntityPicker.astro` | In-chat picker for the same `EntityKind` set (`src/lib/chat-entities/types`) |

### Automated coverage (exists)

- `journey-chat-find-species-and-observe.spec.ts` — Tier-1d journey #6:
  chat renders past the model-cache gate, composer present, deep-link
  `?attach=` chip path (uses the proven `mockChatModelCached` fixture).
- `chat-deep-link.spec.ts` — `?attach=<kind>:<id>` resolution.
- `chat-entity-picker.spec.ts` — entity picker behaviour.

These assert **structure and the deep-link contract with the model
mocked** — they do not exercise a real AI round-trip.

### The gap

- **No audit issue (#1070–#1098) is chat/Ask/AI-related.** The manual
  walkthrough did **not** drive a live AI conversation: a real
  round-trip needs a BYO key, personal sponsorship, or a platform-pool
  slot and costs model spend, which was deliberately out of scope for a
  read-mostly production audit.
- Consequence: "chat is clean" is **unproven**. What is verified is
  that the chat *shell*, the **Ask Rastrum** deep-link from all five
  entity surfaces, and the entity picker render and route correctly
  (automated specs above). The cascade-backed answer path
  (model selection → vision-provider dispatch → streamed reply →
  attach-context grounding) was not manually walked.

### Resolution (filed #1106 → resolved by PR #1109)

**Premise corrected.** The 2026-05-16 sweep (§8) verified that
"Ask Rastrum" / Chat runs **entirely on-device** (WebLLM — Gemma 4 E2B
~500 MB / Llama 3.2 1B; *"tus mensajes nunca salen del navegador"*).
There is **no operator cost and no API key** for the chat path — the
paid path is the *separate* "Ask my AI" identify cascade (M32), already
covered by the photo-ID journey. So the original "needs BYO key / costs
spend / untestable" framing was wrong.

Decision (recorded in `qa-policy.md` §8, merged): **defer-with-rationale**.
Verified free in prod: the `?attach=` deep-link resolves (no 404/crash)
and the model gate is honest UX. The e2e spec mocks the model because
it is ~500 MB + WebGPU (CI-infeasible) — *not* cost. The only residual
is a one-time manual on-device inference smoke, operator-owned, not a
required CI gate. Issue #1106 **closed**.

---

## 5. Coverage matrix — every manual journey has a regression spec?

The 21 committed specs (Tier-1d #1031/#1063 + pre-existing):

```
journey-admin-health            journey-mod-flags
journey-camera-station-import   journey-observer-first-obs
journey-chat-find-species-…     journey-observer-offline
journey-expert-validate         journey-onboarding-tour-replay
journey-falta-dex-region-pool   journey-passkey-enroll-then-verify
journey-guest-browse            journey-photo-id-cascade
journey-guides                  journey-projects-create-and-join
journey-magic-link-pkce-…       journey-researcher-export
journey-mobile-core             journey-share-observation-public
                                journey-social-engage
                                journey-sponsor-setup
                                journey-watchlist-rare-species-alert
```

| Manually-audited journey | Covering committed spec | Status |
|---|---|---|
| Guest browse / Explore / Places | `journey-guest-browse.spec.ts` | ✅ guarded |
| Observe + first observation | `journey-observer-first-obs.spec.ts` | ✅ |
| Photo-ID cascade (UI shell) | `journey-photo-id-cascade.spec.ts` | ✅ |
| Share / public observation + owner delete | `journey-share-observation-public.spec.ts` | ✅ |
| Watchlist | `journey-watchlist-rare-species-alert.spec.ts` | ✅ |
| Social engage (follow/react/report) | `journey-social-engage.spec.ts`, `journey-mod-flags.spec.ts` | ✅ |
| Projects / camera station | `journey-projects-create-and-join.spec.ts`, `journey-camera-station-import.spec.ts` | ✅ |
| Researcher export | `journey-researcher-export.spec.ts` | ✅ |
| Admin / console (role.grant, report.resolve) | `journey-admin-health.spec.ts`, `journey-mod-flags.spec.ts` | ✅ |
| Falta-dex / Pokédex | `journey-falta-dex-region-pool.spec.ts` | ✅ |
| Auth (magic-link / passkey) | `journey-magic-link-pkce-callback.spec.ts`, `journey-passkey-enroll-then-verify.spec.ts` | ✅ |
| Onboarding tour | `journey-onboarding-tour-replay.spec.ts` | ✅ |
| Offline / PWA | `journey-observer-offline.spec.ts`, `pwa.spec.ts` | ✅ |
| Mobile chrome | `journey-mobile-core.spec.ts` | ✅ |
| **Chat / Ask Rastrum AI round-trip** | `journey-chat-find-species-and-observe.spec.ts` (**model mocked only**) | ⚠️ **shell guarded, AI path not** |

Every manually-audited journey has a structural regression spec. The
**only** uncovered behaviour is the live-model chat answer path (§4).

---

## 6. Production write-test-data cleanup

Read-only sweep completed **2026-05-16** against the live signed-in
account. Result: **clean of this audit's write-residue.**

- [x] Observations — all 6 live obs predate the audit; the only
  audit-day obs (`aade1627…`) was already deleted via `delete-observation`
  after #1099 and is gone.
- [x] Follows — 0 outbound test follows (the one follow on record is
  inbound, ~2 wk pre-audit).
- [x] Reactions — none in inbox; none detectable.
- [x] Watchlist — no test species/place subscriptions.
- [x] Profile diffs — legitimate values only, no test strings.
- [x] Projects / camera-stations / identifications — none (activity
  feed 100% `observation_created`).
- [x] Reports — 2 stale false-spam reports (`user/spam` 28 Apr;
  `observation/spam` 9 May, both self-filed by `@art`, targets not
  spam) were **dismissed** as "No es una violación" with audit-logged
  rationale (2026-05-16). Dashboard "Reportes abiertos" → 0.

No deletions of real data were performed. The only artifact this audit
created (one test observation) was already removed.

---

## 7. Open items

1. **#1101** (auth lock-steal root cause) — ✅ MERGED; e2e gate passed
   (no first-paint-pill regression).
2. **Chat AI round-trip** (#1106) — ✅ resolved by PR #1109
   (defer-with-rationale in `qa-policy.md` §8). See §4 resolution.
3. **Production data residue** — ✅ swept 2026-05-16 (§6): account
   clean; 2 stale false reports dismissed.
4. **#1108** flag-queue triage preview, **#1112** console-observaciones
   embed (PR #1114, merged), **#1113** map sprite warning (PR #1116) —
   all surfaced by §8's fresh sweep; see §8.
5. Worktrees `fix-1025-places` / `fix-1026-lint-test` are unrelated
   active dev (not from this audit) — left untouched.

---

## 8. 2026-05-16 Chrome verification sweep (real, not reconstructed)

Unlike §3 (reconstructed from issues), this is a **fresh
contemporaneous** Claude-in-Chrome pass on production `rastrum.org`,
signed in as admin `@art`, **read-only** (no writes), with **live
console + network error capture** per route (the method that catches
in-page/PostgREST errors automated specs miss — exactly how #1112 was
found).

### Route-by-route result

| Journey / route | Result |
|---|---|
| Home `/es/` | ✅ no console errors |
| Explore hub `/es/explorar/` | ✅ **single "Lugares" tile — #1077 fix confirmed live** |
| Places `/es/explorar/lugares/` | ✅ **fully functional — #1070 fix confirmed live** (was the dead "lang is not defined" page) |
| Recent `/es/explorar/recientes/` | ✅ media 200, photo thumbnails render (**#1075 core fixed**); ⚠️ nit: photo-less obs show a large unstyled grey box |
| Species `/es/explorar/especies/` | ✅ no errors |
| Observe form `/es/observar/` | ✅ dropzone + capture + taxon chips + cloud-AI ready |
| Map `/es/explorar/mapa/` | ✅ basemap renders (slow ~10 s first load); 🟡 **#1113** `circle-11` styleimagemissing (external basemap sprite — obs layers are circle-paint, *not* missing). PR #1116 |
| Public profile (self) `/es/u/?username=art` | ✅ followers/following/karma/dex |
| Projects `/es/proyectos/` | ✅ new-project + empty states |
| Export `/es/perfil/exportar/` | ✅ DwC / SNIB / CONANP + DwC-A ZIP form |
| Pokédex `/es/perfil/dex/` | ✅ no errors |
| Validate `/es/explorar/validar/` | ✅ 17 obs; correct self-validation guard |
| Profile not-found `/es/u/?username=Eugenio_P` | ✅ friendly not-found (expected — display name ≠ username; **not a bug**) |
| Chat / Ask Rastrum `/es/chat/?attach=` | ✅ deep-link resolves; on-device model gate honest (#1106 / §4) |
| Console → flag-queue | ✅ exercised (2 reports dismissed + new target-preview #1108) |
| Console → usuarios / salud / errores | ✅ render; *errores* shows 6 **stale** `handler_exception` from already-fixed #1071/#1082 (predate the fixes — noise) |
| Console → **observaciones** | 🔴 **#1112**: PostgREST ambiguous `observations↔taxa` embed → list never loaded. **Fixed, PR #1114 merged.** |

### Bugs the reconstruction + automated specs both missed

- 🔴 **#1112** Console Observaciones browser non-functional — fixed (PR
  #1114, merged): disambiguated to `taxa!primary_taxon_id`.
- 🟡 **#1113** Explore map `styleimagemissing` for the external basemap
  sprite — fixed (PR #1116): `installSpriteFallback` handler + tests.
  (Premise corrected: obs markers were never actually missing.)

### Explicitly NOT re-run with Chrome this pass (honest scope)

Still **automated-spec-only**, not manually re-walked 2026-05-16:
onboarding tour replay, offline/PWA, mobile-viewport chrome, and social
**write** actions (follow / react / report-submit — kept read-only).
These remain covered by their `journey-*.spec.ts` only; no manual prod
claim is made for them.

### Completeness statement

This sweep covers every primary public + signed-in + console-read
route reachable from the IA (header/MegaMenu/console sidebar). It is
**not** a provably-exhaustive enumeration against the full route
manifest, and it deliberately excludes destructive/write flows and the
automated-only set above. Within that scope it is real (Chrome-verified
with error capture), current, and supersedes §5's reconstructed matrix.

---

[`reference_ci_quirks`]: ../.claude — see agent memory; GitHub
auto-links only the first issue in a comma-list `Closes:`.
