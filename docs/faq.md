# Frequently Asked Questions

Everything we have been asked enough times to write down. If your question is
not here, [open an issue](https://github.com/ArtemioPadilla/rastrum/issues)
and we'll add it.

Last updated: 2026-04-25.

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

The most common reasons:

- **No PlantNet key configured.** Sign in, go to `Profile → Edit`, and add a
  free PlantNet key (`my.plantnet.org/account`). Without a key, the cascade
  skips PlantNet and falls through to slower / opt-in plugins.
- **Offline-only cascade.** If you're offline and don't have any on-device
  models downloaded, the cascade has nothing to run. You can still log the
  observation without an ID; the cascade re-runs when you sync.
- **Photo too dark / blurry / cropped.** Identifiers like PlantNet fail
  silently on photos with no recognisable subject. Retake closer or with
  better light.

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
  Llama-3.2-1B) never see the network for the data — only the one-time
  download of the model itself.

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

## Technical

### Where can I report bugs?

Two places:

- The **Report issue** button at the bottom-right of every page (it
  pre-populates a GitHub issue with your locale, page, and basic device
  info).
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

Last updated: 2026-04-25.
