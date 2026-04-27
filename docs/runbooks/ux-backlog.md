# UX backlog — post-launch brainstorm (2026-04-27)

This file captures the *rationale* behind each item in the `v1.1`
phase of [`docs/progress.json`](../progress.json) so the "why" doesn't
get lost when the items are pulled into PRs months later.

> **TL;DR.** After v1.0 shipped (53/57 items) and the family-launch
> walkthrough generated 8 GitHub issues, an architectural review of the
> identification flow surfaced three classes of UX gaps:
> (1) data legibility (% pill is opaque),
> (2) cascade routing (every photo treated as a plant first),
> (3) viral surface (no native share path).
> The 15 items below address those gaps + adjacent quick wins.

---

## How to use this file

- `progress.json` is the source of truth for *what* is planned. Read
  this file for *why*.
- When you start work on an item, copy its `id` from `progress.json`,
  scroll to its section here for the rationale, then open a PR with
  the `id` in the title (e.g. `feat(ux): ux-confidence-ring`).
- When merging, flip `done: true` on the item in `progress.json` and
  optionally add a `done_at: "2026-MM-DD"` field for cleanup.
- This doc is engineering-only — no EN/ES copy needed. The user-facing
  labels live in `progress.json` for the bilingual `/docs/roadmap/` page.

---

## Top tier — week 1 if appetite

### `ux-confidence-ring`
**Replace the percentage pill with an SVG arc.** Percentages are
abstract; a half-filled emerald ring vs a quarter-filled amber ring is
*pre-attentive* — recognised in <250 ms with no math. Use a 32px circle
with a 3px stroke; arc length proportional to confidence; color graded
emerald (≥85%) → amber (50–85%) → red (<50%). The `i` info popover
keeps the numeric % for users who care.

**Effort:** ~1 hour. **Files:** `IdentifyView` / `ObservationForm`
result card, new `<ConfidenceRing>` component.

### `ux-quick-taxon-chips`
**Five icons under the photo upload area** (🌿 plant · 🐦 bird · 🐾
mammal · 🐛 insect · 🍄 fungus). Tapping one **primes the parallel
cascade**: e.g. 🐦 disables PlantNet, prefers BirdNET (audio) and the
vision LLMs. Without the chip, the cascade pretends every photo is a
plant first, wasting latency on PlantNet 403s for non-plant photos.
The chip is also a *user-mental-model* signal — "you tell us what you
saw, we identify it" beats "we'll guess what kind of thing this is."

**Effort:** ~3 hours. **Files:** `ObservationForm` photo block,
`runParallelIdentify` accepts a `taxonHint` arg, `identify-runners.ts`
filters runners by hint.

### `ux-photo-compression`
**Resize photos > 4 MP to 4 MP via canvas before upload.** Phone
cameras are routinely 12–48 MP; PlantNet and Claude downscale anyway.
Compressing client-side cuts R2 storage 4× and shaves seconds off sync
on Latin America's mobile networks. Quality stays the same (PlantNet's
own docs say resolution above 1024 px doesn't improve top-1).

**Effort:** ~1 hour. **Files:** `src/lib/observe.ts`
`saveObservationToOutbox` pre-write hook.

### `ux-share-button`
**"Compartir" button on the result card** → opens a system share sheet
with the existing `/share/obs/<id>` URL + OG card. The OG renderer
(`supabase/functions/share-card/index.ts`) already exists; just needs
a button that builds the URL + invokes `navigator.share()` on mobile,
copy-to-clipboard on desktop. Critical for the family-launch viral
loop — if dad takes a photo of a hummingbird and shares to the family
WhatsApp, the OG card lands clean.

**Effort:** ~2 hours. **Files:** `ObservationForm` result card,
`/profile/observations` row.

---

## Mid tier — week 2 if signups warrant it

### `ux-save-as-draft`
**Allow submit without GPS.** Field biologists in cell-dead zones lose
their work today because the form blocks on missing location. New
secondary CTA "Guardar borrador" skips the location validation and
sets `sync_status='draft'`. Sync engine resolves location later via
EXIF GPS (already extracted) or stays manual. Ship as a real first-class
state on `observations.sync_status` so the UI can surface "5 drafts
need location" on the profile.

**Effort:** ~3 hours. **Files:** `ObservationForm` submit handler,
`syncOutbox` draft handling, `MyObservationsView` filter chip.

### `ux-onboarding-tour`
**3-card carousel on first sign-in.** Cards: install PWA / take a
photo / see your profile. Skippable; flag in `localStorage` so it
never repeats. Eugenio's struggle to find the install button on
Android is the proof that we need this.

**Effort:** ~4 hours. **Files:** new `OnboardingTour.astro`,
`BaseLayout.astro` mount on first authed paint.

### `ux-chat-suggestions`
**Pre-canned follow-up chips below each AI reply.** "¿Es venenosa?"
"¿Cómo la distingo de X?" "Hábitat típico". Tap inserts the prompt as
the next user turn. Reduces cold-start friction — users don't always
know what to ask next, and watching a chat sit idle is its own friction.

**Effort:** ~2 hours. **Files:** `ChatView.astro` after each assistant
turn, prompt templates in `chat-attachment-helpers.ts`.

### `ux-chat-persistence`
**Persist chat history per device in Dexie.** Currently lost on reload.
A short-lived chat is fine; a chat that survives across sessions feels
like an actual assistant. Per-device storage avoids the privacy
trade-off of syncing chat content to Supabase.

**Effort:** ~3 hours. **Files:** new Dexie store `chatTurns`,
`ChatView` boot reads it, append on each new turn.

---

## Lower tier — month 2+

### `ux-explore-time-slider`
**Drag a month slider on /explore** to filter the observation layer by
month. Reveals seasonal patterns — best when the dataset is large
enough for it to be meaningful. Defer until ≥1k observations.

### `ux-skeleton-screens`
**Replace bare spinners with content-shaped placeholders** on
/observations, /explore, profile feed. Cheap perceived-performance win
that's barely visible per-page but cumulatively makes the platform
feel snappier.

### `ux-voice-chat-input`
**SpeechRecognition API in /chat composer.** Accessibility win for
visually impaired users and indigenous-language native speakers who
might prefer to dictate. Browser support is uneven (Safari iOS 14.5+,
Chrome stable); fall through to text-only on unsupported.

### `ux-first-observation-celebration`
**Confetti + "Bienvenido a Rastrum 🌱" on the user's literal first
synced observation.** Cheap, memorable, doesn't repeat. Use
`canvas-confetti` (3 KB).

### `ux-indigenous-taxa-search`
**Search Zapoteco / Náhuatl / Maya / Mixteco / Tseltal common names
→ scientific name.** This is the highest-impact item for the platform's
mission, but requires:
1. A name corpus per language. CONABIO's NaturaLista has some; partner
   with community curators (Centro de Investigación Cultural for Zapoteco,
   etc.) to verify.
2. Governance review per the local-contexts module (CARE / FPIC).
3. Schema column on `taxa` for an indigenous-name array.

Don't start coding without (1) and (2) done. The schema is the easy
part.

### `ux-photo-dedupe`
**Perceptual hash warns when the user uploads the same photo twice.**
Field workflow: someone takes a photo, can't tell if it synced, uploads
again. We end up with duplicate observations. Hash on EXIF-stripped
bytes + dimensions; warn if hash matches an existing observation by
the same observer in the last 7 days.

### `ux-streak-push`
**Web Push notification at 8 PM local** when a streak is 1 day from
breaking. Strict opt-in (the streak feature is already opt-in, this
inherits that). Single nightly notification per user; never multiple.
Browser Push API works on Android Chrome and iOS 16.4+ Safari.

---

## What this is NOT

- It's not a product roadmap. The roadmap lives in `progress.json`
  (v1.5 / v2.0 / v2.5 phases). This is the layer of polish *between*
  v1.0 launch and v1.5 territory work.
- It's not a commitment list. Items may be dropped if real users don't
  ask for them.
- It's not exhaustive. New items will land here as launch feedback
  arrives.

---

## How items move from this list to "shipped"

1. PR opens with `feat(ux): <id>` in title (e.g. `feat(ux): ux-share-button`).
2. PR description references this file's section for the rationale.
3. On merge, flip `progress.json` → `done: true` for that `id` and add
   `done_at: "YYYY-MM-DD"`.
4. Optionally: add a one-line "Lessons learned" footer to this file's
   section if the implementation surfaced anything non-obvious.
