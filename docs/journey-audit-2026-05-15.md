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
  the walkthrough. The per-journey findings below are reconstructed from
  the filed issues and the fix PRs, which are authoritative. Treat the
  "walked" column as the journey class exercised, not a verbatim script.

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

### Recommended follow-up (filed: #1106)

A scoped manual pass with a throwaway BYO key (or a pool slot on a test
beneficiary), walking: Ask-Rastrum-from-observation →
attach chip present → ask a grounded question → streamed answer cites
the attached entity → "observe this" CTA round-trips. Capture findings
as a normal issue and add a real-model variant guarded behind a CI
secret (mirroring the smoke-model-assets pattern), or explicitly defer
with rationale in `qa-policy.md`. **Until then, treat the AI answer
path as untested in production.**

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

The audit exercised write paths on the real account. A read-only
sweep of the live signed-in account was completed 2026-05-16:

- [x] **Observations** — all 6 live obs predate the audit
  (27/4–6/5/2026). The only audit-day observation (`aade1627…`,
  15/5) was already deleted via the `delete-observation` EF after
  #1099 and is gone from the list; only its activity-log event
  persists (activity log is not purged on soft-delete). **No
  residue.**
- [x] **Follows** — profile "Seguimiento: 0"; the only follow on
  record is *inbound* (Pamela Ruiz, ~2 weeks pre-audit). No
  outbound test follows. **Clean.**
- [x] **Reactions** — no reaction notifications in the inbox; no
  reaction residue detectable from the account surfaces. **No
  evidence of any.**
- [x] **Watchlist** — feed shows only own-observation activity; no
  test species/place subscriptions. **Clean.**
- [x] **Profile diffs** — legitimate values only (Artemio Padilla,
  @art, MX, member since 24/4/2026). No test strings. **Clean.**
- [x] **Projects / camera-stations / identifications** — activity
  feed is 100% `observation_created`; the lone ID badge (Canis
  familiaris, 6/5) predates the audit. **No residue.**
- [⚠] **Reports** — 2 open reports exist (`user/spam` 28 Apr;
  `observation/spam` 9 May). **Both predate the 15/5 walkthrough**,
  so neither is residue from *this* audit; provenance (earlier test
  fixtures vs. real community reports) is indeterminate from the UI.
  **Left untouched** — triaging them is a moderation write action
  that requires explicit per-item operator decision; surfaced here
  rather than acted on.

**Net: the account is clean of write-residue from this audit.** The
single test observation it created is the only artifact, and it was
already deleted. No deletions were performed during this sweep
(deletions are irreversible — never bulk-delete account data without
explicit per-item user approval; the 2 pre-existing reports are the
operator's call).

---

## 7. Open items

1. **#1101** — auto-merge armed; merges when its `audit`+`test` e2e
   gate (the #1064/#1065 first-paint-pill regression gate) goes green.
2. **Chat AI round-trip** — tracked in **#1106**. Until that pass runs
   (or is defer-with-rationale'd in `qa-policy.md`), the live-model
   answer path is untested in production.
3. **Production data residue** — ✅ swept 2026-05-16 (§6): account
   clean of this audit's write-residue; 2 pre-audit reports surfaced
   for operator triage, left untouched.
4. Worktrees `fix-1025-places` / `fix-1026-lint-test` are unrelated
   active dev (not from this audit) — left untouched.

[`reference_ci_quirks`]: ../.claude — see agent memory; GitHub
auto-links only the first issue in a comma-list `Closes:`.
