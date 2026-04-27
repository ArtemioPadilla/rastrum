# UX revamp — design spec

> Status: drafted 2026-04-26. Brainstormed end-to-end with the user; awaiting
> review before the implementation plan is written.

## Why this exists

Today's chrome was built for a 5-route brochure site. Rastrum is now a
field-first PWA with auth, an observation pipeline, exports, tokens, public
profiles, multi-page docs, EN/ES parity, and a roadmap of more identifier
surfaces. The navigation should be reshaped around the verb users came to do
(observe, identify, explore) rather than the list of pages we have.

We haven't shipped v1.0 publicly yet, so we have headroom to revamp without
breaking external link equity. The goal is a single coherent revamp shipped
in five small PRs, with no broken URLs at any point.

## Personas served

All four personas inform decisions; none is sacrificed:

- **Field observer** (mobile, signed-in) — primary verb is observe; one-thumb,
  patchy-signal context.
- **First-time visitor** (desktop, signed-out) — needs a clear hero and a
  fast path to "try it now."
- **Doc / spec reader** (desktop, deep) — researcher, contributor, grant
  reviewer; navigates 9+ doc pages and the roadmap.
- **Power user** (desktop, signed-in) — manages tokens, exports DwC
  archives, applies for expert role, runs batch imports.

## Mental model rules

These rules are the spine of the IA. When in doubt, fall back to them.

1. **Profile = identity** (who you are, what you've done). It is read-mostly.
2. **Settings = configuration** (everything you change). Single canonical
   home for every editable preference.
3. **Verbs are top-level** (Observe, Explore, Chat). Reference clusters
   (About, Docs) live on the right of the chrome.
4. **Identify is a hub-spoke from home**, not a top-level nav item. It is
   the lightweight first-touch flow; Observe is the saved workflow.
5. **The FAB always means "photo → identification."** Its destination
   shifts contextually (Observe by default, Quick ID when on /observe), but
   it is never hidden.
6. **Read-mode pages get a footer**; **app-mode pages do not** — the bottom
   bar is the chrome on app pages.

---

## Section 1 — Information architecture

### Top-level surfaces

- **Verbs** (left of chrome / mobile bottom bar): Observe, Explore ▾, Chat
- **Reference** (right of chrome): About, Docs ▾
- **Home** is reachable via the logo only; no longer a nav item
- **Identify** is reached via the homepage hero CTA only

### New routes

| Route | Status | Purpose |
|---|---|---|
| `/explore/` | new landing | tabs: Map · Recent · Watchlist · Species |
| `/explore/recent` | new | feed of recent public observations |
| `/explore/watchlist` | moved | from `/profile/watchlist` (it's public data) |
| `/explore/species` | new placeholder | Phase 2 — per-species pages |
| `/profile/settings/[tab]` | new | tabbed shell — Profile · Preferences · Data · Developer |

ES slugs: `/explorar/recientes`, `/explorar/seguimiento`, `/explorar/especies`,
`/perfil/ajustes/[tab]`.

### URL preservation (zero broken links)

| Old | New | Mechanism |
|---|---|---|
| `/profile/edit` | `/profile/settings/profile` | 301 |
| `/profile/tokens` | `/profile/settings/developer` | 301 |
| `/profile/export` | `/profile/settings/data` | 301 |
| `/profile/import` | `/profile/settings/data` | 301 |
| `/profile/expert-apply` | `/profile/settings/developer` | 301 |
| `/profile/watchlist` | `/explore/watchlist` | 301 |
| `/profile/import/camera-trap` | unchanged | reachable from Settings → Data |
| `/profile/observations` | unchanged | linked from hub + avatar dropdown |
| `/profile/u/[username]` | unchanged | public profile |
| `/share/obs/[id]` | unchanged | public OG card |
| `/identify` | unchanged | quick demo, hub-spoked from home |

`src/i18n/utils.ts` adds: `exploreRecent`, `exploreWatchlist`, `exploreSpecies`,
`profileSettings`, plus a `routeTree` map (label, EN slug, ES slug, parent)
that powers breadcrumbs and the search index.

---

## Section 2 — Desktop chrome

### Layout

- **Lockup**: 🌿 Rastrum wordmark + small zinc-500 tagline below ("Biodiversity,
  observed in your language" / "Biodiversidad, observada en tu idioma").
  Tagline hidden under `md` (Tailwind 768px).
- **Left of separator** (verbs): Observe · Explore ▾ · Chat
- **Right** (reference + auth): About · Docs ▾ · 🔔 (when authed) · avatar / Sign in
- **Active state**: matching nav item gets emerald color and a 2px
  underline rail. `/explore/map` highlights "Explore". `/docs/roadmap`
  highlights "Docs". Settings sub-pages don't highlight any nav item — the
  avatar is the surface.
- **Search trigger**: small ⌕ button in the header (right of "Docs ▾"),
  visible on ≥md. Triggers ⌘K palette (§6).

### Removed from chrome

- Home (lives on logo only)
- Map (now under Explore ▾)
- EN/ES toggle (moves to footer + Settings → Preferences)
- Theme toggle (moves to footer + Settings → Preferences)
- Mobile hamburger (mobile gets its own pattern in §3)

### Mega-menu — `Docs ▾`

3-column, right-aligned, opens on hover (200ms delay) on desktop and click on
touch. Closes on outside click, route change, or Esc. ARIA `aria-expanded`
+ roving focus. Groupings:

| Product | Progress | Community |
|---|---|---|
| Vision | Roadmap | Indigenous |
| Features | Tasks | Funding |
| Architecture | Market | Contribute |

Each item has a one-line description below the title (zinc-500, 11px).

### Small dropdown — `Explore ▾`

4 items: Map · Recent · Watchlist · Species. Single-column, opens on hover.

### Per-section accent rail

- **Observe** = `emerald-500` (current brand)
- **Explore** = `teal-500`
- **Chat** = `sky-500`
- **Docs / About** = `stone-500`

The active-section accent is used only on the nav rail, focus rings within
that section, and a 1px hairline on the page heading. CTAs stay emerald
everywhere; only the section accent shifts. Profile/Settings inherit emerald
(you're configuring "you", which is the brand verb).

### Files touched

- `src/components/Header.astro` — full rewrite
- `src/components/MegaMenu.astro` — new
- `src/i18n/{en,es}.json` — `nav.tagline`, `nav.explore_*`, mega-menu group headers
- `src/i18n/utils.ts` — new route entries, `routeTree`

---

## Section 3 — Mobile chrome

### Top header (mobile)

- Always: wordmark (no tagline) · 🔔 (when authed) · ≡ hamburger
- When ≡ is open: icon flips to ✕; bottom bar stays visible (drawer is
  right-side, ~200px wide, doesn't cover it)
- ⌕ search button on the top header, left of the bell, opens full-screen
  palette (§6)
- No avatar in the top header; avatar lives in the Profile tab to avoid
  redundancy

### Bottom bar (5 slots, center FAB)

- **Signed-in**: Explore · Chat · [📷 FAB] · Recent · Profile
- **Signed-out**: 4-tab bar (Home · Identify · Map · Sign in) — no FAB.
  Sacred geometry: the FAB only appears when it means "observe"
- **iOS safe-area**: bottom bar uses `env(safe-area-inset-bottom)` for
  the home-indicator gap
- **On full-bleed map** (`/explore/map`): bar uses `backdrop-blur` + 70%
  opacity so map controls remain partially visible

### FAB rule

The FAB is **never hidden**. Destination is contextual:

- Anywhere except `/observe` → tap = `/observe`. Caption: "Observe".
- On `/observe` → tap = `/identify` (quick photo ID, no save). Caption:
  "Quick ID", with a small yellow ⚡ badge in the top-right corner.
- Long-press (Phase 2) → action sheet: Save observation · Quick identify ·
  Audio observation.

Geometry: 56×56 button, lifted 22px above the bar with a 4px ring of the
body bg so it punches through. Shadow + emerald glow for affordance.

A11y: `aria-label` = "Start observation" / "Iniciar observación", or
"Quick identify" when badged. Respects `prefers-reduced-motion`.

### Hamburger drawer (mobile-only)

Accessible via ≡ in the top header. Right-side overlay, ~200px wide, doesn't
cover the bottom bar.

- **Reference**: About · Docs ▸ (drills into 3-group accordion: Product /
  Progress / Community)
- **Account (signed-in)**: Settings ▸ · Sign out
- **Account (signed-out)**: Sign in
- **Preferences**: EN/ES segmented switch + ☀/🌙 theme switch (these
  otherwise live in `/profile/settings/preferences`; the drawer is a
  quick-access shortcut)

### Breakpoints

- `<sm` (640px): mobile chrome (bottom bar + slim top header + drawer)
- `≥sm`: desktop chrome (Section 2). No middle ground; tablets get the
  desktop nav.

### Files touched

- `src/components/MobileBottomBar.astro` — new
- `src/components/MobileDrawer.astro` — new
- `src/components/Header.astro` — adds mobile branch
- `src/layouts/BaseLayout.astro` — render `MobileBottomBar` as a sibling
  of `main`; add `pb-20 sm:pb-0` so content isn't hidden under the bar

---

## Section 4 — Account hub & avatar dropdown

### The rule

> **Profile = who you are and what you've done. Settings = what you configure.**

If a user asks "where is X?", the answer is mechanical: if X is something
you change, it's in Settings. If X is something you see, it's on Profile.

### Avatar dropdown (slim, hot path)

- Header strip: avatar · display name · @handle (so identity is unambiguous
  when multiple sessions exist)
- View profile → `/profile`
- My observations → `/profile/observations`
- Watchlist → `/explore/watchlist` (note: jumps out of /profile, since
  watchlist is public-data exploration)
- Settings ▸ → `/profile/settings/profile`
- (divider)
- Sign out

### `/profile` — identity hub

- Identity strip: avatar, display name, @handle, joined date
- Stats row: Observations · Watchlist · Day streak (uses existing
  `StreakCard`)
- Recent observations preview: 4 thumbnails with "See all observations →"
  link to `/profile/observations`
- Single primary CTA: **⚙ Settings** button (top-right of identity strip)
- Secondary: "View public ↗" link to `/profile/u/[username]`
- Replaces the existing `ProfileView.astro`; same data sources

No duplicate edit cards. The hub never tries to be a settings entry-point
beyond the one ⚙ Settings button.

### `/profile/settings/[tab]` — tabbed shell

Four tabs, each direct-linkable:

- **Profile** — display name, username, bio, avatar (wraps existing
  `ProfileEditForm`)
- **Preferences** — language (EN/ES segmented), theme (☀/🌙/auto),
  notification preferences, BYO API keys (PlantNet, Claude, etc. from
  `byo-keys.ts`)
- **Data** — Import (CSV + camera trap subroute) + Export (DwC archive)
- **Developer** — API tokens (rst_*) + Expert application + MCP server URL

`/profile/settings/` (no tab) redirects to `/profile/settings/profile`.

Mobile: tabs become a vertical list; each tab is its own scroll; back
returns to `/profile/settings/`.

### Files touched

- `src/components/ProfileView.astro` — rewrite as identity hub
- `src/components/SettingsShell.astro` — new (tabs + slot)
- `src/components/PreferencesForm.astro` — new
- `src/pages/{en,es}/profile/settings/[tab].astro` — new (4 tabs × 2 langs)
- `src/i18n/utils.ts` — settings route entries
- `src/i18n/{en,es}.json` — settings tab labels, preferences strings

---

## Section 5 — Footer & breadcrumbs

### Context-aware footer

Footer renders on **read-mode** pages and is hidden on **app-mode** pages.

- **Read-mode**: `/`, `/identify`, `/about`, `/docs/*`, `/share/*`, `/404`
- **App-mode**: `/observe`, `/explore/*`, `/chat`, `/profile`, `/profile/settings/*`,
  `/auth/callback`

Decided in `BaseLayout.astro` via a `chromeMode` prefix table in
`src/lib/chrome-mode.ts`. Single source of truth — flipping a route's
mode is a one-line edit to that table.

### Footer layout (desktop)

5-column grid:

1. **Brand strip** — wordmark, tagline, 2-line description, social links
   (GitHub, Mastodon, RSS)
2. **Product** — Observe · Identify · Map · Chat · Install PWA
3. **Learn** — About · Vision · Roadmap · Architecture · Indigenous
4. **Community** — Contribute · Funding · Issues ↗ · Discussions ↗
5. **Legal** — License (MIT/AGPL) · Privacy · Contact · Status

Bottom strip (below the columns): copyright, license summary, EN/ES
segmented switch, ☀/🌙 theme switch, version stamp linked to changelog.

### Footer layout (mobile, read-mode only)

- Brand strip stays visible (~80px tall)
- 4 link sections collapse to native `<details>` accordions
- Bottom strip (EN/ES + theme + version) always visible
- `pb-20` + safe-area-inset on the final element so it isn't hidden under
  the bottom bar

### Breadcrumbs

- Render only when `pathname` has depth ≥ 2 segments past the locale.
  `/en/observe/` → no crumbs; `/en/profile/settings/data/` → crumbs.
- Source of truth: `routeTree` in `i18n/utils.ts` mapping each route to
  `{label, parent}`. Keeps EN/ES symmetric and avoids per-page boilerplate.
- Doc breadcrumbs use the mega-menu groupings as parent: `/docs/architecture/`
  → `Docs › Product › Architecture`.
- Mobile: 11px text, single line, ellipsis truncation in middle if >3
  segments. Tapping `…` opens a small dropdown listing the elided
  segments.
- Hidden on app pages with their own header treatment (Observe form,
  full-bleed map).

### Files touched

- `src/components/Footer.astro` — full rewrite
- `src/components/Breadcrumbs.astro` — new
- `src/lib/chrome-mode.ts` — new (or inline in `i18n/utils.ts`)
- `src/i18n/utils.ts` — `routeTree`, `getCrumbs(path, lang)`
- `src/i18n/{en,es}.json` — footer column headings + link labels
- `src/layouts/BaseLayout.astro` — conditional `<Footer />` + `<Breadcrumbs />`

---

## Section 6 — Global search (⌘K palette)

Keyboard-first overlay; triggers on ⌘K / Ctrl-K (desktop) and via a ⌕ icon
in the mobile top header.

### Result groups (priority order)

1. **Quick actions** — verbs (New observation, Quick identify, Sign out,
   Toggle theme, Switch to ES). Always available.
2. **Pages** — IA from §1 (Observe, Explore tabs, Chat, About, Profile,
   Settings tabs). Static index.
3. **Docs** — every doc page with section anchors. Static index built at
   `astro build` time from page frontmatter.
4. **Your observations** (signed-in only) — last 50 cached locally;
   live-search via Supabase RPC for older. Hidden when signed out.
5. **Species** (Phase 2) — once `/explore/species` ships.

### Engine

- `fuse.js` (~6KB gz) for fuzzy match. No network for static surfaces.
- Observations layer hits Supabase via a debounced RPC at >3 chars (250ms
  debounce); local index debounce 80ms.
- EN+ES bilingual matching: indexes include both labels per item, so
  "observación" matches "New observation" on the EN locale and vice
  versa.
- Privacy: queries never leave the device for the static index. Only the
  observations search hits the network, and only authenticated. No
  analytics on query strings.

### Keyboard contract

- ⌘K / Ctrl-K — toggle
- Esc — close
- ↑ / ↓ — navigate
- Enter — open selection (route or run quick action)
- ⌘+Enter — open in new tab (page/doc results)
- Tab — cycle group filter (All → Actions → Pages → Docs → Observations)

### A11y

- `role="combobox"` on input; `aria-expanded`, `aria-controls`,
  `aria-activedescendant`
- Focus trap inside the overlay; restored on close
- Each row is `role="option"` with descriptive `aria-label` including the
  destination ("New observation, Quick action")
- Mobile overlay opens with `autofocus` on the input → keyboard fires
  immediately

### Files touched

- `src/components/CommandPalette.astro` — new (overlay shell)
- `src/components/CommandPaletteRow.astro` — new
- `src/lib/search/index.ts` — new (load index, run fuse, expose `search(q, lang)`)
- `src/lib/search/build-index.ts` — new (build-time script that scans
  pages + docs + nav + actions, emits to `public/search-index.{en,es}.json`
  so the JSON is served as a static asset and lazy-loaded on first ⌘K
  open rather than bundled into the initial JS payload)
- `src/lib/search/observations.ts` — new (Supabase RPC client)
- `src/components/Header.astro` — add ⌕ trigger button
- `src/layouts/BaseLayout.astro` — mount palette + global keyboard listener
- `astro.config.mjs` — integration to run `build-index.ts` in `astro:build:setup`
- `package.json` — add `fuse.js`

---

## Section 7 — Polish, onboarding tour, phasing

### Tagline (md+ only)

Two-line lockup under the wordmark on desktop. Source string in
`i18n/{en,es}.json` as `nav.tagline`.

- EN: "Biodiversity, observed in your language."
- ES: "Biodiversidad, observada en tu idioma."

Mobile drops it to keep the header at ~52px.

### Onboarding tour

5-step guided tour shown after first sign-in. **Skippable** at every step;
**replayable** from Settings → Preferences → "Replay onboarding tour."

Steps:

1. **Welcome** — modal, no spotlight. "Rastrum helps you identify and log
   any species. Here's the quick tour." (Skip / Start)
2. **The FAB** — spotlight on the bottom-bar camera (mobile) or "Observe"
   nav item (desktop). "Tap to start observing — anywhere in the app."
3. **Quick ID variant** — spotlight on the badged FAB on `/observe`.
   "While observing, the same button becomes ⚡ Quick ID — photo lookup,
   no save."
4. **Explore tabs** — spotlight on Explore tab/nav item. "Map, recent
   observations, your watchlist, and (soon) species pages — all under
   Explore."
5. **Settings + BYO key** — spotlight on Profile tab/avatar. "Add a free
   PlantNet API key in Settings → Preferences for instant identification.
   Takes about 2 minutes." (Done / Open Settings — opens
   `/profile/settings/preferences#byo-keys` with the PlantNet field
   auto-focused)

#### Triggers

- First sign-in on a device → tour auto-starts ~600ms after the
  home/observe page mounts
- Replay link in Settings → Preferences
- Manual entry from the home page hero (signed-out): "Take the tour"
  link below "Start Identifying" — runs the same tour against the home
  + bottom-bar mockup. Useful for evaluators
- `localStorage[rastrum.onboarding.seen] = "v1"` when finished or skipped.
  Version suffix lets us re-run the tour later if we add new chrome
  (species pages → tour v2)

#### Implementation

- Custom Astro component, **not** a library. Driver.js / Shepherd are
  ~15–25KB gz; custom is <3KB. We control look + a11y.
- `src/components/OnboardingTour.astro` — overlay shell with a `steps` prop
- `src/lib/tour.ts` — step config (selector, content, placement, optional
  `onAdvance` hook for waiting on element mount)
- `data-tour="fab"`, `data-tour="explore-tab"`, etc. on chrome elements —
  selector source of truth, decoupled from class names
- Spotlight: full-page `<dialog>` with CSS `clip-path` punching a hole
  around the highlighted element using the element's bounding rect
- Resize/orientation: recompute on `resize` + `orientationchange`; tour
  pauses if no DOM target found (e.g. mobile-only step on desktop) and
  skips that step

#### A11y

- `role="dialog"` + `aria-modal="true"` on the tooltip; focus trapped
  while the tour is active
- Esc = Skip; Enter / → = Next; ← = Back
- Spotlight does NOT block screen readers from the highlighted element
- Respects `prefers-reduced-motion`
- Each step's tooltip carries an `aria-label` describing the highlighted
  element ("camera button, observe action")

#### Desktop variant

Same 5 steps with adjusted spotlights:

- Step 2 (FAB): spotlights "Observe" header item (desktop has no FAB)
- Step 3 (Quick ID): spotlights the home hero CTA — desktop discovers
  Quick ID via /identify, not via a FAB
- Tour respects `chromeMode`: doesn't open on app-mode pages where
  pointing at chrome is awkward (e.g. mid-form on /observe)

### Phasing — five PRs, each shippable independently

#### PR 1 — IA + chrome rebuild (~2–3 days)

- Rewrite `Header.astro` (verb-first split + active rail + tagline)
- New `MegaMenu.astro`, `MobileBottomBar.astro`, `MobileDrawer.astro`
- New routes: `/explore/recent`, `/explore/watchlist` (redirect from old),
  `/explore/species` (placeholder)
- Add `routeTree`, `chromeMode`, new i18n strings
- Per-section accent rails wired in

> Ships: nav looks new, mobile gets bottom bar + FAB, no auth/data changes.

#### PR 2 — Account hub + Settings shell (~1–2 days)

- Rewrite `ProfileView` as identity hub (no duplicate cards)
- New `SettingsShell.astro` + `/profile/settings/[tab]` routes
- Move `ProfileEditForm` into Settings → Profile
- 301 redirects for `/profile/edit`, `/profile/tokens`, `/profile/export`,
  `/profile/import`, `/profile/expert-apply`
- Avatar dropdown trimmed to hot path
- New `PreferencesForm` absorbing lang/theme/byo-keys

> Ships: account model is the new model. Old URLs continue working via 301.

#### PR 3 — Footer + breadcrumbs (~1 day)

- Rewrite `Footer.astro` (5-column desktop, mobile accordion)
- New `Breadcrumbs.astro` reading from `routeTree`
- `chromeMode` gating: footer hides on app-mode pages, breadcrumbs render
  only at depth ≥ 2
- Move EN/ES + theme switches out of header into footer + Preferences

> Ships: footer is a proper IA hand-off; deep routes are locatable.

#### PR 4 — Global search (⌘K palette) (~2 days)

- Add `fuse.js`, build-time `search-index.{en,es}.json`
- `CommandPalette.astro` + global keyboard listener in `BaseLayout`
- Quick actions, pages, docs (Phase 1 scope)
- Observations search via Supabase RPC (signed-in only, debounced)
- ⌕ trigger button in header (desktop) and mobile top bar

> Ships: ⌘K from anywhere, finds anything in the IA.

#### PR 5 — Polish + onboarding tour (~1 day)

- 5-step onboarding tour (custom, <3KB) with EN+ES copy
- Empty states: `/profile/observations` when zero, watchlist when empty,
  `/explore/recent` when no public obs in your area
- Active-state QA across breakpoints; focus-ring audit; keyboard a11y sweep
- Update `tasks.json` + `progress.json` entries for the revamp

> Ships: the revamp feels finished, not just rearranged.

**Total**: ~7–9 working days end to end. PR 1 is the riskiest (touches
every page via header); PRs 2–5 are layered additions. Each PR carries
its own e2e smoke (Playwright).

---

## Phase 2 — explicitly out of scope

These are intentionally not in this revamp. They have a clear home in the
new IA when they ship.

- **Species pages** at `/explore/species` (placeholder ships, populated
  later when GBIF / CoL integration lands)
- **Long-press FAB action sheet** (Phase 1 = single-tap; Phase 2 adds
  Save / Quick / Audio multi-action)
- **Custom typography pair** (current zinc/system stack stays)
- **Empty-state illustrations** (Phase 1 uses tasteful copy + icon;
  bespoke art later)
- **Mascot / brand glyph** (keep the leaf 🌿 lockup)
- **Deep linking from search to observation detail** (search returns to
  `/profile/observations` with a query param; per-observation detail page
  is a separate feature)
- **Onboarding tour v2** when species pages or other major chrome lands —
  bumps `localStorage[rastrum.onboarding.seen]` from `"v1"` to `"v2"`

---

## Acceptance criteria

- **No broken URLs.** Every existing path either keeps working or 301s to
  its new home.
- **EN/ES parity.** Every new string in both i18n files; every new route
  paired in `routes`.
- **Active state always visible** on the chrome — desktop rail, mobile
  bottom-bar tab.
- **Field observer test**: from cold start, signed-in mobile user can reach
  a saved observation in ≤4 taps.
- **Lighthouse a11y > 95** on home, observe, profile, settings.
- **No `console.log`** in shipped code; `typecheck` + `test` + `build` all
  green.
- **Playwright e2e** covers: open ⌘K from any page, FAB → /observe,
  FAB → /identify on /observe, footer hidden on app pages, settings tabs
  direct-linkable, onboarding tour completes + can replay.

---

## Open follow-ups (not blockers for the implementation plan)

- Should `/explore/recent` be classified as **read-mode** (it's a feed, so
  a footer makes sense) or stay **app-mode** like the rest of `/explore/*`?
  Default in this spec: app-mode. Easy to flip with a one-line table edit.
- Long-press FAB action sheet (Phase 2) — confirm whether audio-observation
  shortcut deserves first-class status or stays inside `/observe`.
