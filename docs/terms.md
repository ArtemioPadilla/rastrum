# Terms of Use

> **This is a plain-language description of how we expect Rastrum to be used,
> not a legally reviewed document. Consult a lawyer before treating this as a
> binding agreement.**

Last updated: 2026-04-25.

---

## Acceptance

By visiting `https://rastrum.org` or any subdomain, by signing in, or by using
any Rastrum API or MCP server, you accept these terms. If you don't accept
them, don't use the service.

The service is operated by the Rastrum project (volunteers + maintainers
listed at <https://github.com/ArtemioPadilla/rastrum>). The codebase is
released under the MIT license (client) and AGPL-3.0 (server). Per-observation
data is licensed by you, the observer, under one of the Creative Commons
options described below.

---

## Account and tokens

- One account per human. We do not allow shared organisational accounts at
  this time. If you need a multi-user setup (a NGO, a research lab, an
  agency), open an issue and we'll work it out.
- You are responsible for the security of your authentication and your
  personal API tokens (`rst_*`). Tokens are SHA-256 hashed on our side, but
  the plaintext is shown to you exactly once at creation and we cannot
  recover it. If you leak a token, revoke it at `/profile/tokens`.
- Don't share an account or token with someone else. If you need a separate
  identity for a coworker or a co-researcher, ask them to create their own.

---

## Acceptable use

What we ask:

- **Don't scrape.** The public data is published under per-record CC
  licenses; respect each record's license. For bulk academic use, prefer the
  Darwin Core export (`/profile/export/`) or the GBIF mirror once that
  pipeline is live.
- **Don't submit fake or AI-fabricated observations.** Rastrum is a citizen
  science platform; the integrity of the data depends on it being real. AI
  identifications of real photos are fine and explicitly supported.
  Generating fake photos and uploading them is not.
- **Don't harass other users.** No targeted abuse, no doxxing, no
  threats — in observation comments, in profile bios, anywhere.
- **Don't try to circumvent sensitive-species obscuration.** The
  coordinate-coarsening for NOM-059 / CITES species exists to protect those
  species from poaching. Do not attempt to de-anonymise it via timing
  attacks, repeated queries, scraping, social engineering, or any other
  means.
- **Don't abuse the API.** Soft rate limits apply per token; we will revoke
  tokens that exceed them in a way that suggests automation rather than a
  good-faith client.

---

## Per-observation licensing

When you submit an observation, you choose a license for it:

- **CC BY 4.0** (default) — anyone can reuse the photo and metadata as long
  as they credit you.
- **CC BY-NC 4.0** — same as above but non-commercial use only.
- **CC0** — you waive all rights; the observation is in the public domain.

By submitting the observation, you grant Rastrum a non-exclusive,
non-transferable license to display the observation, generate share cards,
include it in Darwin Core exports, mirror it to GBIF (if you opt in), and
serve it through the public API — all under the per-record license you
selected.

We do not ever change the license you picked. You can edit a record (or
delete it) from `/profile/observations/`.

---

## Sensitive species

If your observation matches a species listed in NOM-059-SEMARNAT-2010 or
CITES appendices, Rastrum will coarsen the public coordinates to
approximately a 10×10 km square. Precise coordinates remain readable to:

- you (the observer)
- credentialed researchers, when authenticated

Don't attempt to circumvent this. Don't post precise GPS coordinates of
sensitive species in your observation notes, and don't post screenshots of
maps that show the precise location.

---

## Third-party APIs

Rastrum integrates with services that have their own terms:

- **PlantNet** — when you submit a photo for plant identification, the
  photo and any associated metadata travel to PlantNet's servers under their
  terms (<https://my.plantnet.org/legal>). Their license also governs how
  PlantNet may store and reuse the photo.
- **Anthropic** — when you bring your own (BYO) Anthropic API key, photos
  used for Claude vision identification are sent to Anthropic under
  *your* contract with Anthropic (<https://www.anthropic.com/legal>).
  Rastrum does not store the key and does not relay your call through our
  servers.
- **OpenFreeMap, Cloudflare R2, Supabase** — infrastructure providers; their
  terms govern uptime and storage.

When you use BYO keys, *you* are bound by the upstream provider's terms.
Don't paste somebody else's key.

---

## Suspension and appeals

We may suspend or terminate accounts that violate these terms. We try to give
warning except in the case of clear abuse (impersonating someone, scraping,
mass-uploading fakes, attempting to compromise the system). If you think
your account was suspended in error:

- [Open an issue](https://github.com/ArtemioPadilla/rastrum/issues) and tag
  `@ArtemioPadilla`.
- Or reach out via the email address listed on the maintainer's GitHub
  profile.

We'll review and reply, usually within a week.

---

## Disclaimer of warranty

Rastrum is provided "as is", on a best-effort basis. There is no service
level agreement (SLA), no uptime guarantee, no warranty of fitness for a
particular purpose. The server is licensed under AGPL-3.0; the AGPL-3.0
disclaimer of warranty applies in full.

In particular: **identifications produced by Rastrum are suggestions, not
authoritative determinations.** Treat every species identification as a
hypothesis to verify against expert knowledge or peer-reviewed sources before
taking any decision based on it (conservation, foraging, regulatory, medical,
or otherwise).

---

## Governing law

These terms are intended to be read in good faith. Where a question of law
arises, the operator is based in **Mexico**, and Mexican law applies in the
absence of a more specific agreement. **This clause should be reviewed by a
lawyer before treating it as binding** — see the disclaimer at the top of
this page.

---

## Changes to these terms

We may update these terms — for example to clarify a privacy practice, add a
new third-party integration, or close a loophole. When we do, the "Last
updated" date at the top of this page changes, and a note is added to the
GitHub commit log. Material changes are announced in
[GitHub Discussions](https://github.com/ArtemioPadilla/rastrum/discussions).

---

## Contact

For terms-related questions:

- Open an issue at <https://github.com/ArtemioPadilla/rastrum/issues>.
- Or contact `@ArtemioPadilla` on GitHub.

Last updated: 2026-04-25.
