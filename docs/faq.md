# Frequently Asked Questions

Everything we have been asked enough times to write down. If your question is
not here, [open an issue](https://github.com/ArtemioPadilla/rastrum/issues)
and we'll add it.

Last updated: 2026-05-04.

---

## Getting started

### How do I install the app on my phone?

Rastrum is a Progressive Web App (PWA), not a native app — there's nothing
to install from an app store.

- **Android (Chrome / Edge / Brave):** open <https://rastrum.org>; an
  "Install" button appears in the bottom-right corner. Tap it. The icon
  lands on your home screen and behaves like any other app.
- **iOS (Safari):** Apple does not show an automatic install prompt. Open
  <https://rastrum.org>, tap the **Share** icon, then **Add to Home
  Screen**. The icon shows up alongside other apps.
- **Desktop:** the same install button shows in Chrome/Edge/Brave on the
  right of the address bar.

A native iOS App Store wrapper is on the v1.2 roadmap (it requires an Apple
Developer account); the PWA covers most use cases for now.

### Do I need an account?

No. Rastrum has a guest mode: open the site, hit the camera button, log an
observation. It stays on your device until you sign in.

Signing in (magic link, Google, GitHub, passkey, or 6-digit OTP code) gives
you:

- Cloud sync — observations live in your account and survive a phone reset.
- Sharing — others can see and comment on your observations.
- Activity feed and badges.
- API tokens for programmatic access.
- Karma points for contributions to the community.

A "convert guest to account" flow runs the first time you sign in: any local
observations get attached to your new account.

### Is it free?

Yes. There are no subscription fees, no ads, no upsells. The data you
contribute is published under a per-record Creative Commons license you
choose (BY 4.0 by default).

Where Rastrum costs money internally — model bandwidth, Supabase database,
Cloudflare R2 — those are paid by the maintainers (Cloudflare R2's free
egress + Supabase's free tier carry the project today).

---

## Identification

### Why don't I see identification suggestions?

The platform runs PlantNet, Claude (if you've added your own key), and
Phi-3.5-vision on-device (if downloaded) **in parallel** on every
photo. The first confident match wins. Most common reasons you'd see
no suggestion:

- **The photo isn't a plant and no vision model is available yet.**
  PlantNet only identifies plants; for animals / mushrooms / scenery
  Rastrum offers a one-time ~2.4 GB download of an on-device AI
  (Phi-3.5-vision) that runs offline forever. If you skipped that
  offer, you can download it later from `Profile → Edit → AI settings`
  or type the species name manually.
- **Offline + no on-device models downloaded.** If you're offline and
  haven't downloaded BirdNET-Lite (audio) or Phi-3.5-vision (photos),
  identification has nothing local to run. The observation still saves
  locally and identifies on next sync.
- **Photo too dark / blurry / out-of-frame.** All identifiers fail on
  photos without a recognisable subject. Retake closer or with better
  light.
- **Power-user shortcut:** if you have an Anthropic API key, paste it
  in `Profile → Edit → AI settings → Claude key`. Identification then
  runs through Claude Haiku 4.5 in parallel with PlantNet, which gives
  instant identification for animals + plants + everything else
  without downloading any model.

### How accurate is identification?

It depends on the taxon and the photo:

- **Plants** — PlantNet's top-1 in the cascade is correct ~70-90% of the
  time on a clear photo of a flower or leaf, less for habit shots or fruits
  out of season.
- **Birds** — BirdNET-Lite (audio) is strong on the ~6,000 species in its
  global model when the call is clean and the species is in range. Photos
  of birds are harder; we route through Phi-3.5-vision or Claude (BYO
  key).
- **Insects, fungi, lichens, marine life** — significantly less reliable.
  Treat any AI ID as a *suggestion*, not a determination.

The cascade reports a confidence score with every ID. Below 0.4 we flag it
as "low confidence" and don't promote the observation to research-grade.
Above 0.4 it's still your job to look at the photo and decide whether the
guess matches what you saw.

### What's the new SpeciesNet on-device classifier?

As of v1.2 (shipped 2026-05-04), Rastrum includes a distilled **SpeciesNet
on-device animal classifier** (Module 18). It runs locally in the browser
using ONNX Runtime Web — no network request, no API key required. It covers
the most commonly observed vertebrates and expands the offline identification
surface beyond BirdNET's audio-only scope.

To activate it the first time, open `Profile → Edit → AI settings → Download
SpeciesNet`. The download is ~120 MB. After that it runs on every new
observation photo automatically.

### Can I correct an identification?

Yes. On the observation form (or after the fact, on the observation detail
page), edit the **scientific name** field and save. Your manual entry
overrides the AI's guess; the original AI suggestion is kept in the
identification history for transparency.

If you're a credentialed researcher, your edits to other people's
observations carry a 3× weight in the consensus algorithm — see the docs
section on [expert validation](/en/docs/contribute/) for how to apply.

---

## Audio

### Why does BirdNET ask me to download something?

BirdNET-Lite is the on-device audio identifier (Cornell Lab of Ornithology;
CC BY-NC-SA 4.0). The model file is ~50 MB. We download it once, the first
time you record audio, and cache it locally. After that:

- Identification runs entirely on your phone.
- No audio leaves your device.
- It works offline.

You can clear the cached model from `Profile → Edit → BirdNET-Lite → Clear
cache` if you ever need to re-download.

### Why doesn't my recording identify?

Likely causes:

- **Model not downloaded yet** — the first recording downloads the model;
  subsequent recordings use the cached copy.
- **Species isn't in the global 6,000-species model** — BirdNET-Lite
  prioritises the most-recorded species worldwide. Endemics and regional
  rarities can be absent.
- **Recording too short or too noisy** — the model needs at least ~2-3
  seconds of relatively clean signal. Heavy wind, traffic, or overlapping
  voices destroy the spectrogram.
- **Wrong taxon** — BirdNET only handles birds. Insect, mammal, and frog
  calls are out of scope today.

---

## Camera stations

### What are camera stations?

Camera stations (Module 31, shipped v1.2) let you register a physical
camera trap deployment and attach your observations to it. Each station
tracks:

- Location and deployment period (start / end dates).
- A sampling-effort record so diversity indices stay comparable across
  different trap densities and durations.

You set the station inside the observation form via the new **camera station
selector**. Period management (creating, editing, and closing a deployment
period) is available from `Profile → Camera stations`.

### Can I bulk-import camera trap photos?

Yes. `rastrum-import` (CLI, Module 30) ingests a folder of camera trap
images, clusters them by EXIF timestamp, runs MegaDetector v5 + SpeciesNet
(operator endpoint), and creates one observation per cluster. Run
`rastrum-import --help` for usage.

---

## Explore and maps

### What are species profile pages?

Introduced in v1.2 (M34 Phase 1), each identified species now has its own
page at `/en/explore/species/<slug>/`. The page shows:

- Taxonomy and common names (EN + ES).
- Distribution map built from community observations.
- Reference media.
- Observation history from the community.

You can reach species pages by clicking any species name in the explore
grid, on observation cards, or in identification results.

### What are the interactive audio thumbnails?

Observations with audio recordings now show a play button inline — on the
explore map, profile grid, and species pages. Tap to preview the audio
without opening the full observation detail. The player uses wavesurfer.js
and never re-downloads the clip if it was already cached.

### What are the clickable map pins?

The explore map (`/explore/`) now shows thumbnail popup cards when you click
a pin. Each popup includes the species name, date, observer username, and a
small photo thumbnail. Click the card to go to the full observation.

Sensitive observations (NOM-059 / CITES) still display with obscured
coordinates; the popup shows a ± 10 km radius indicator instead of a precise
pin.

### What is the community heatmap?

The community map (`/community/map/`) displays a heatmap of observer
centroids (the geographic centre of each user's observations). It shows
where community activity is concentrated — useful for coordinators
planning outreach or new collection sites.

Access requires being signed in. Coordinates are aggregated to the centroid
level; individual observation locations are not exposed through this view.

---

## Karma and community

### What is karma?

Karma is a lightweight reputation score that reflects your contributions
to the Rastrum community. Points accrue from:

- Submitting observations.
- Being the first person to record a species in Rastrum (`first_in_rastrum`
  badge category).
- Syncing observations after offline capture (`observation_synced` event).
- Donating to AI sponsorship pools (see below).
- Expert validations and community consensus confirmations.

Your karma score appears on your public profile and on the community
leaderboard (`/community/observers/`).

### What are AI sponsorship pools?

AI sponsorship pools (Module 27) let users share their Anthropic API
credentials with other Rastrum users who don't have one. The pool owner
sets a cost cap per 100 calls. Contributors donate to the pool; the
platform draws from the pool when a non-keyed user requests identification.

- Create or join a pool from `Profile → AI sponsorships`.
- Donating to a pool earns karma points.
- A per-pool donation page is available at `/community/donate/<pool>/`.
- Cost transparency: the model picker shows cost-per-100-calls so pool
  owners can make informed choices.

---

## Privacy and data

### Where do my photos go?

It depends on whether you're signed in and whether you've triggered an
identification:

- **Signed in:** photos upload to Cloudflare R2 (`media.rastrum.org`) and
  are linked to your observation row in Supabase. Default visibility is
  public; you can mark an observation as obscured for sensitive species.
- **Guest / offline:** photos stay in your phone's IndexedDB outbox until
  you're online and signed in.
- **Identification:** photos are sent to PlantNet (when a key is set) and
  to Anthropic (only when you supply your own key). They are never sent to
  Anthropic by default.
- **On-device models** (BirdNET, EfficientNet-Lite0, Phi-3.5-vision,
  Llama-3.2-1B, SpeciesNet) never see the network for the data — only the
  one-time download of the model itself.

See the [privacy page](/en/privacy/) for the full breakdown.

### Can I delete my account?

Yes. Sign in → `/profile/edit/` → **Delete account**. After confirmation:

- Your auth identity is removed.
- Your observations are anonymised (the link to your user id is severed).
- Photos in R2 are queued for purge within 30 days.
- Audio is deleted immediately.
- Identifications and comments are retained but anonymised.

If you want a full export first, use `/profile/export/`. If you need
observations removed entirely (rather than anonymised), open an issue and
we'll work it out.

### What if I want my observation to be private?

Two paths:

- **Sensitive species are obscured automatically.** If your observation
  matches NOM-059-SEMARNAT-2010 or CITES appendices, the public-readable
  coordinates are coarsened to ~10×10 km. Only you and credentialed
  researchers see the precise location.
- **Voluntary obscuration.** On the observation form, set the "Obscure
  coordinates" toggle. The same coarsening applies.

We don't have a "private observation" mode (where the observation is
invisible to everyone but you) at v1.0. If you have a use case for it,
[file an issue](https://github.com/ArtemioPadilla/rastrum/issues).

---

## Offline and sync

### What happens if I observe without signal?

- The observation, photos, and audio are saved to your phone's IndexedDB
  outbox immediately.
- A small "pending sync" indicator appears in the avatar dropdown.
- When the next network request succeeds, the outbox flushes: media goes
  to R2, the observation row goes to Supabase, identifications run on the
  server.
- If sync fails, we retry on the next online event. You don't have to do
  anything.

You can keep observing while sync runs in the background.

### What happens if I lose my phone?

- **Synced observations are safe** in your Rastrum account. Sign in on a new
  device and they show up immediately.
- **Unsynced guest observations are lost** — they only ever lived in the
  IndexedDB on the lost phone. This is the one good reason to sign in.

If you sign in *before* losing the phone, anything that synced is durable.
If you sign in *after* losing it, the unsynced records are gone.

---

## Push notifications

### How do I opt into streak reminders?

Go to `Profile → Notifications` and enable **Streak reminders**. Rastrum
will send a push notification when your observation streak is at risk (no
observation logged today). You can opt out at any time from the same toggle.

Push notifications require browser permission. If you previously denied it,
you'll need to reset it from your browser settings.

---

## Technical

### Where can I report bugs?

Two places:

- The **Report issue** button at the bottom-right of every page — including
  `/console/*` admin and moderator dashboards — (it pre-populates a GitHub
  issue with your locale, page, and basic device info).
- Directly at <https://github.com/ArtemioPadilla/rastrum/issues>.

For a more discussion-shaped question (feature requests, "how do I…"),
prefer [Discussions](https://github.com/ArtemioPadilla/rastrum/discussions).

### Can I use the API?

Yes. Rastrum exposes a REST API at `/functions/v1/api/...` and a
[Model Context Protocol](https://modelcontextprotocol.io) server at
`/functions/v1/mcp` for AI agents.

- Create a personal token at `/profile/tokens` (token format: `rst_*`).
- Tokens are scoped (`observe`, `identify`, `export`).
- See [Module 14](/en/docs/) for the REST surface and
  [Module 15 (MCP)](/en/docs/) for the agent integration. Worked examples
  for Claude Desktop, Cursor, VS Code, and GitHub Copilot Coding Agent
  configurations are in those module specs.

### Why am I seeing the old version after a deploy?

Usually a stale service worker. Hard-refresh your tab
(`Ctrl+Shift+R` on Win/Linux, `Cmd+Shift+R` on Mac) or close and reopen
the tab. If you're still seeing the old version, see the
[service worker cache runbook](https://github.com/ArtemioPadilla/rastrum/blob/main/docs/runbooks/sw-cache.md)
for diagnosis steps.

---

## Anything else?

Open an issue at <https://github.com/ArtemioPadilla/rastrum/issues> and we
will reply (and add the answer here if it's a recurring question).

Last updated: 2026-05-04.
