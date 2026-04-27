# Privacy

> **This is a plain-language description of what we do with your data, not a legally
> reviewed document. Consult a lawyer before treating this as a binding agreement.**

Last updated: 2026-04-25.

Rastrum is built around the idea that observing biodiversity should not require
giving up control of your data. This page describes — without legalese — what we
collect, where it goes, what we never see, and what you can do about any of it.

If something here surprises you, [open an issue](https://github.com/ArtemioPadilla/rastrum/issues)
and we'll fix it.

---

## What we collect

When you use Rastrum, we may receive or generate the following data:

- **Email address** — only if you sign in. Guest mode requires no account.
- **Photos and short audio clips** you attach to observations.
- **GPS coordinates** when you grant location access (or extract them from a
  photo's EXIF metadata).
- **Observation metadata** — the timestamp, habitat, weather, evidence type,
  any free-text notes you write.
- **Sync timestamps** — when each observation was created and last synced.
- **IP address and user agent** — captured by Supabase auth/access logs and
  Cloudflare's R2 edge logs in the normal course of serving requests.
- **Service-worker telemetry** — your browser tells us indirectly (via fetch
  failures, cache misses) when the offline path runs. We do not pair this with
  your account.

We do not run third-party analytics, ad networks, fingerprinting libraries,
or session-replay tools. There is no Rastrum tracking pixel.

---

## Where it goes

| Data | Stored at | Why |
|---|---|---|
| Email + auth identity | Supabase Postgres (`auth.users`) | To sign you in. |
| Profile, observations, identifications | Supabase Postgres | The application database. |
| Photos and audio blobs | Cloudflare R2 (`media.rastrum.org`) | Cheap, durable media storage with no egress fees. |
| Service-worker app shell | Your device only | So Rastrum works offline. |
| Outbox (pending observations) | Your device only (IndexedDB / Dexie) | Until they sync to Supabase. |

When you ask for a species identification:

- A photo may be sent to the **PlantNet API** — only when you trigger an ID
  run, only the image, and only if a key is configured.
- A photo may be sent to the **Anthropic Claude API** — only when you have
  brought your own (BYO) key in `Profile → Edit`. The key is stored in your
  browser's `localStorage` and forwarded per call. Rastrum servers never store
  it or log it.
- Audio is only ever processed **on your device** by BirdNET-Lite (the model
  is downloaded once to your browser; inference runs locally).

The following models, when used, run **entirely on-device** and the media never
leaves your phone:

- BirdNET-Lite (audio)
- EfficientNet-Lite0 (photo, offline base classifier)
- Phi-3.5-vision (photo, fallback vision LLM)
- Llama-3.2-1B (text, used by the chat page to phrase replies)

---

## Sensitive species and coordinate obscuration

Rastrum enforces coordinate obscuration for species protected under
[NOM-059-SEMARNAT-2010](https://www.gob.mx/semarnat/) and CITES appendices. If
you log a sensitive species:

- Public-readable views see the location coarsened to roughly a 10×10 km
  square (`obscure_level = 'public'`).
- Only you and credentialed researchers (when authenticated and authorised)
  can read the precise coordinates.
- The obscuration is enforced by a database trigger that sets a separate
  `location_obscured` column at insert/update time, so the public view never
  even has the raw value.

You can also opt to obscure coordinates voluntarily for any observation, sensitive
or not — the same mechanism applies.

---

## Indigenous data and CARE / FPIC

For observations made on Indigenous territory, or that document
culturally-significant species, Rastrum is committed to:

- **CARE principles** — Collective benefit, Authority to control, Responsibility,
  Ethics. These complement the FAIR principles for open data.
- **Free, Prior, and Informed Consent (FPIC)** — observations linked to
  Indigenous territory require community consent before they are made public or
  exported to third-party aggregators (GBIF, iNaturalist).
- **Local Contexts BC/TK Notices** — when a community has labeled a record with
  a Biocultural or Traditional Knowledge notice, the notice is shown alongside
  the observation and propagated through the Darwin Core export.

This work is in early stages. Expect it to evolve as the CARI advisory council
forms and partner communities define what they need.

---

## Right to delete

You can delete your account at any time:

1. Sign in.
2. Go to `/profile/edit/`.
3. Click **Delete account**.

When you do:

- Your `auth.users` row is removed.
- Your observations are anonymised — the link from observation rows to your
  user id is severed, but the observations themselves remain (because they
  may have been licensed to others under CC-BY-4.0 / CC0 / CC-BY-NC and
  citing them depends on the data continuing to exist).
- Your photos in R2 are queued for deletion within 30 days. Audio clips are
  deleted immediately.
- Identifications and comments you made are kept but anonymised.

If you want a **full export before deleting**, use `/profile/export/` first —
that hands you a Darwin Core CSV plus a ZIP of your media.

If you need observations that you have already published completely removed
(not just anonymised), [open an issue](https://github.com/ArtemioPadilla/rastrum/issues)
and we will work with you on the right scope.

---

## Cookies and local storage

Rastrum uses `localStorage` (not cookies) for:

- Your authentication session token (managed by Supabase).
- Your bring-your-own (BYO) API keys for PlantNet and Anthropic, if you set
  them. Stored under the `rastrum.byoKeys` key. Cleared on sign-out only if
  you also clear them via the UI; `localStorage` survives sign-out by default.
- Theme preference (light/dark).
- Locale preference (EN/ES).

The service worker maintains an offline cache of the static site shell. You
can clear it via your browser's "site settings → clear data" or by
unregistering the service worker in DevTools.

---

## Children

Rastrum is not directed at users under **13 years of age**. If you are aware
that a child under 13 has created an account, please contact us so we can
remove it. Some jurisdictions set a higher threshold (16 in much of the EU);
guardians should apply the local rule.

---

## Contact

To raise a privacy issue, ask for an export, request a deletion, or report a
suspected leak:

- Open an issue at <https://github.com/ArtemioPadilla/rastrum/issues> — public
  issues for general questions, security advisories for sensitive matters
  (use the "Report a vulnerability" link in that repo's Security tab).
- For urgent privacy questions, mention `@ArtemioPadilla` directly in an
  issue.

Last updated: 2026-04-25.
