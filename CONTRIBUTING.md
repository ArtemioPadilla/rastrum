# Contributing to Rastrum

Thanks for your interest in helping. Rastrum is a small, opinionated
codebase, so a quick read of this page (under five minutes) will save
review cycles.

## Code of conduct

We follow the [Contributor Covenant](https://www.contributor-covenant.org/version/2/1/code_of_conduct/).
Be respectful and constructive; we try to be the same. Reports go to
the project owner via GitHub or by email — see [`SECURITY.md`](SECURITY.md)
for the address used for sensitive reports.

## Local development

### Prerequisites

- [Node.js](https://nodejs.org/) ≥ 22.12.0 (npm ships with it).
- A Supabase project + Cloudflare R2 bucket if you want to exercise
  identification, observation, or upload features. The static landing
  pages and most unit tests run without either.

### One-time setup

```bash
git clone https://github.com/ArtemioPadilla/rastrum.git
cd rastrum
npm install
cp .env.example .env.local   # then fill in PUBLIC_SUPABASE_URL etc.
```

The full env-var matrix lives in [`README.md`](README.md#environment-variables);
the convention map is in [`AGENTS.md`](AGENTS.md).

### Day-to-day

```bash
npm run dev          # http://localhost:4321
npm run build        # static site into dist/
npm run typecheck    # tsc --noEmit
npm run test         # vitest (225 tests today)
npm run test:e2e     # Playwright on chromium + mobile-chrome
npm run test:lhci    # Lighthouse CI against dist/
```

Schema work uses the `Makefile`:

```bash
make db-apply        # idempotent supabase-schema.sql
make db-verify       # tables + RLS + triggers
make db-seed-badges  # 39-badge seed
```

## Pull request conventions

Read [`AGENTS.md`](AGENTS.md) before your first PR — the conventions
that bite first-time contributors are documented there.

### Hard rules

1. **One logical change per PR.** A refactor PR has no feature commit;
   a feature PR has no incidental refactors. Split when in doubt.
2. **EN/ES parity.** Every user-facing string lives in both
   `src/i18n/en.json` and `src/i18n/es.json`. Page bodies live in
   shared `*View.astro` components so EN and ES routes are
   structurally identical.
3. **Idempotent SQL.** `CREATE TABLE IF NOT EXISTS`, `DROP POLICY …
   IF EXISTS; CREATE POLICY …`, `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
4. **No `console.log` in shipped code.** `console.warn` for
   genuinely-exceptional ignored errors only.
5. **Astro JSX `Record<string, …>` casts** must be extracted to typed
   frontmatter consts — see [`AGENTS.md`](AGENTS.md#astro-jsx-gotcha--records-is-parsed-as-a-tag).
6. **Pre-PR checklist:** `npm run typecheck && npm run test && npm run build`.

### Commit messages

Conventional Commits (`feat:`, `fix:`, `docs:`, `refactor:`, `test:`).
A subject under 70 chars is enough; add a body when *why* isn't
obvious from the diff.

### Issue templates

Pre-filled forms at [`.github/ISSUE_TEMPLATE/`](.github/ISSUE_TEMPLATE/):

- `bug.yml` — production bug report.
- `feature.yml` — feature request.
- `question.yml` — open-ended question / triage.
- `translation.yml` — EN/ES translation issue.

## Licensing & data sovereignty

Code: [MIT](LICENSE). Per-observation data: observer-selected
CC BY 4.0 / CC BY-NC 4.0 / CC0. Bird vocalization model (BirdNET-Lite):
non-commercial CC BY-NC-SA — only loaded for citizen-science use.

Indigenous data sovereignty is a first-class concern. Before
contributing features that touch geographically-scoped data,
sensitive-species obscuration, or community partnerships, read
[`docs/specs/modules/07-licensing.md`](docs/specs/modules/07-licensing.md)
and the governance section of [`docs/progress.json`](docs/progress.json).

## Questions

Open a GitHub Discussion or file a `question.yml` issue. Sensitive
security reports follow [`SECURITY.md`](SECURITY.md).
