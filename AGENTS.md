# AGENTS.md

> Briefing for AI coding agents (Claude Code, Copilot, Cursor, Codex, …)
> working in this repo. Read this before making changes.

---

## What this is

**Rastrum** is an open-source biodiversity observation PWA targeting Latin
America. Astro + Tailwind frontend, Supabase backend (Postgres + PostGIS +
RLS), Cloudflare R2 for media, Edge Functions (Deno) for AI identification.
Bilingual EN/ES from day one.

- **Public site:** https://rastrum.org
- **Repo:** https://github.com/ArtemioPadilla/rastrum
- **License:** MIT (code), AGPL-3.0 (server per README), per-observation CC
  (BY / BY-NC / CC0)

---

## Project orientation (in priority order)

| Read first | Why |
|---|---|
| [`docs/progress.json`](docs/progress.json)              | Source of truth for the roadmap. Bilingual labels (`_es` suffix). |
| [`docs/tasks.json`](docs/tasks.json) + [`docs/tasks.md`](docs/tasks.md) | Per-roadmap-item subtask breakdown. Check current status before starting work. |
| [`docs/specs/modules/00-index.md`](docs/specs/modules/00-index.md) | Catalog of 13 module specs. Each module has its own design doc. |
| [`docs/specs/infra/supabase-schema.sql`](docs/specs/infra/supabase-schema.sql) | Idempotent SQL — apply with `make db-apply`. |
| `Makefile`                                                | Run `make help` to see every dev workflow. |

---

## Quick commands

```bash
make help                     # list every target with descriptions
make install                  # npm ci
make dev                      # astro dev — http://localhost:4321
make build                    # static build into dist/
make test                     # vitest run (~20 tests today)
make typecheck                # tsc --noEmit
make db-apply                 # apply supabase-schema.sql (idempotent)
make db-verify                # show tables, RLS, triggers, extensions
make db-seed-badges           # seed 39-badge catalogue
make db-cron-schedule         # apply pg_cron schedules
make db-cron-test             # fire both cron jobs once + show responses
make db-psql                  # interactive psql shell
```

Edge Function deploys go through CI because the local `supabase` CLI
(2.90.0) is broken on this project's config:

```bash
gh workflow run deploy-functions.yml --ref main \
  -f function=identify   # or all / get-upload-url / etc.
gh run watch <run-id>
```

---

## Architecture cheatsheet

```
src/
├── components/             Astro components — both pages + shared widgets
│   ├── *View.astro         Shared per-feature views (RoadmapView, TasksView,
│   │                       ProfileView, ExploreMap, ExportView, …)
│   └── *Form.astro         Forms (ObservationForm, ProfileEditForm, SignInForm)
├── i18n/{en,es}.json       Translations. ANY new UI string lives here.
├── i18n/utils.ts           t(lang) helper, route map, docPages list.
├── layouts/                BaseLayout (PWA, theme, SW reg) + DocLayout (sidebar)
├── lib/
│   ├── supabase.ts         Singleton supabase-js client
│   ├── auth.ts             Magic link, OAuth, OTP, passkey, signOut
│   ├── byo-keys.ts         Per-plugin user-supplied API keys (localStorage)
│   ├── db.ts               Dexie IndexedDB outbox (RastrumDB)
│   ├── sync.ts             Outbox → R2 → Supabase + cascade engine
│   ├── upload.ts           R2 (preferred) / Supabase Storage upload helper
│   ├── local-ai.ts         WebLLM (Phi-3.5-vision, Llama-3.2-1B)
│   ├── darwin-core.ts      DwC mapping (CSV + SNIB + CONANP presets)
│   ├── identifiers/        Plugin platform — see `13-identifier-registry.md`
│   │   ├── types.ts        Identifier interface + KeySpec + IdentifyInput
│   │   ├── registry.ts     Singleton registry (collision-detected)
│   │   ├── cascade.ts      runCascade() — license-cost-sorted waterfall
│   │   ├── index.ts        bootstrapIdentifiers() registers built-ins
│   │   └── *.ts            One file per plugin
│   └── types.ts            ObserverRef, Observation, MediaFile, …
├── pages/{en,es}/          Locale-paired routes. /en/observe ↔ /es/observar
├── pages/auth/callback.astro  Language-neutral OAuth/PKCE landing page
├── pages/share/obs/        Public OG-card observation viewer
└── env.d.ts                Typed import.meta.env

supabase/
├── functions/<name>/index.ts    Deno Edge Functions (deploy via CI)
│   ├── identify              Photo cascade entry point
│   ├── enrich-environment    Lunar phase + OpenMeteo backfill
│   ├── recompute-streaks     Nightly cron
│   ├── award-badges          Nightly cron
│   ├── share-card            Public OG card renderer
│   ├── get-upload-url        R2 presigned upload URLs
│   ├── export-dwca           Darwin Core Archive ZIP
│   ├── api                   REST API (rst_* token auth)
│   └── mcp                   MCP server for AI agents (rst_* token auth, JSON-RPC over HTTP)
└── config.toml             Local CLI config (deploy via CI, not local)

docs/
├── progress.json           Roadmap (60+ items, bilingual labels)
├── tasks.json              Per-item subtask breakdown (rendered at /docs/tasks/)
├── tasks.md                Markdown audit of every item + subtasks
└── specs/
    ├── infra/              SQL schema, cron, testing, future migrations, CI yml
    └── modules/            13 module specs + 00-index.md
```

---

## Conventions

### Code style
- **TypeScript strict mode.** `any` is a smell; prefer `unknown` + narrowing.
- **Default to no comments.** Only add a comment when *why* is non-obvious.
  Never explain what the code does — well-named identifiers do that.
- **No emoji in code or commits unless asked.** UI emoji are fine when
  intentional (icons, brand marks).
- **No `console.log` in shipped code.** `console.warn` for genuinely
  exceptional ignored errors only.

### Astro JSX gotcha — `Record<…>` is parsed as a tag
Inline TypeScript casts like `(foo as Record<string, unknown>).bar` inside
JSX expressions get parsed as opening tags by Astro's esbuild integration.
**Always extract these casts to typed local variables in the frontmatter:**

```astro
---
// ✓ Good — cast in frontmatter
const map = data as unknown as Record<string, MyShape>;
const item = map[key];
---
<div>{item.label}</div>
```

```astro
<!-- ✗ Bad — build error -->
<div>{(data as Record<string, MyShape>)[key].label}</div>
```

### EN/ES parity is a hard rule
- Every public-facing string lives in `src/i18n/en.json` AND `src/i18n/es.json`.
- Doc pages (`/{en,es}/docs/*`) must be **structurally identical** —
  enforce by extracting the body into a shared `*View.astro` component.
- The `_es` suffix pattern in `progress.json` and `tasks.json` provides
  per-record translation; the `loc()` helper in views picks the right one.
- New routes get a slug pair: `routes.signIn = { en: '/sign-in', es: '/ingresar' }`.

### Idempotent everything
- SQL: `CREATE TABLE IF NOT EXISTS`, `DROP POLICY IF EXISTS … ; CREATE POLICY …`,
  `ALTER TABLE … ADD COLUMN IF NOT EXISTS`.
- Seed data: `INSERT … ON CONFLICT (key) DO UPDATE SET …`.
- Cron schedules: `cron.unschedule()` then `cron.schedule()` by name.
- Migrations: replay-safe so `make db-apply` is callable any time.

### RLS and privacy invariants
- **Every public table has RLS enabled.** No exceptions.
- **`obs_public_read`** depends on the denormalised `obscure_level` +
  `location_obscured` columns on `observations` — kept in sync by the
  `sync_primary_id_trigger` whenever the primary identification changes.
- **BYO API keys** (`localStorage[rastrum.byoKeys]`) are forwarded
  per-call to the Edge Function as `client_keys.<provider>`. Never
  persisted server-side, never logged.
- **Sensitive species** (NOM-059 / CITES) use the `obscure_level` enum
  to coarsen public coordinates; precise coords only readable by the
  observer or a credentialed researcher.

### Module spec convention
- Implementation specs live at `docs/specs/modules/NN-*.md`, numbered
  sequentially. **The module spec wins** when it disagrees with
  `rastrum-v1.md` (the older monolithic spec, now vision-only).
- New modules: claim the next `NN-*.md`, register in
  `modules/00-index.md`, link from any consuming module.

### Identifier plugin contract
Adding a new model/service for species ID is a 3-step recipe:
1. Write `src/lib/identifiers/<plugin>.ts` exporting an `Identifier`.
2. `import` + `register()` in `src/lib/identifiers/index.ts`.
3. (Server-side only) extend the Edge Function's `force_provider` switch.
The registry has runtime collision detection on `id`. See
`docs/specs/modules/13-identifier-registry.md` for the full contract.

---

## Known pitfalls (things that bit me)

| Symptom | Cause | Fix |
|---|---|---|
| `supabase functions deploy` → "Missing required field: db.port" | CLI 2.90.0 has a regression on this project's config | Deploy via `gh workflow run deploy-functions.yml`. Never local. |
| Astro build: `Expected ")" but found <string,…>` | Inline `Record<…>` cast in JSX | Pull the cast into the frontmatter as a typed const |
| Vitest: `localStorage.clear is not a function` | Node 22's experimental localStorage shadows happy-dom's | Map-backed shim at top of test file (see `byo-keys.test.ts`) |
| Magic link redirects to `localhost:3000` | Supabase Site URL still default | Dashboard → Authentication → URL Configuration → set Site URL + allow-list `/auth/callback/` |
| Email auth "rate limit exceeded" after 3 sends | Supabase free tier built-in SMTP cap | Custom SMTP (Gmail App Password or Resend) — see module 04 |
| 403 from `/rest/v1/users` even with valid JWT | "Auto-expose new tables" was disabled at project creation | Schema includes explicit `GRANT SELECT/INSERT/UPDATE/DELETE` to anon + authenticated; replay `make db-apply` |
| OAuth provider returns no email | GitHub user has private email | `signInWithGitHub('read:user user:email')` scope requested in `auth.ts` |
| Edge Function 401 from cron | publishable `sb_publishable_…` key not accepted as Bearer by Edge Functions | Cron-only functions are deployed `--no-verify-jwt` |

---

## Things you should NOT do without asking

- **Don't run destructive git** (`git reset --hard`, `git push --force`,
  `git checkout --` against unstaged changes, `branch -D`) without explicit
  user permission. This repo is solo-developed but the user occasionally
  pushes from another machine.
- **Don't skip hooks** (`--no-verify`). Investigate the failure instead.
- **Don't commit `.env.local`, `supabase/config.toml.bak`, or anything in
  `.claude/`**. These are gitignored for a reason.
- **Don't enable a Supabase RLS policy without testing it.** A broken
  policy is a silent data leak. Use `make db-policies` to inspect.
- **Don't add new dependencies** without justifying. The bundle is
  performance-sensitive; every package adds to the PWA install size.
- **Don't auto-deploy Edge Functions on every push.** They use shared
  secrets; intentional `workflow_dispatch` keeps deploys deliberate.

---

## How to add new work

### A new doc page
1. Create EN page at `src/pages/en/docs/<name>.astro`.
2. Mirror at `src/pages/es/docs/<name>.astro` — same component, only the
   `lang` prop differs. Body lives in a shared `<NameView lang />`.
3. Add the slug to `docPages` in `src/i18n/utils.ts`.
4. Add `sections.<name>` and `descriptions.<name>` to both i18n files.
5. Run `make build` and confirm both pages render identically.

### A new identifier plugin
See "Identifier plugin contract" above. Use the existing plugins
(`plantnet.ts`, `claude.ts`, `phi-vision.ts`) as templates.

### A new module spec
1. Find the next free number in `modules/00-index.md`.
2. Create `docs/specs/modules/NN-<slug>.md`. Use the structure of an
   existing spec (`07-licensing.md` is a good template).
3. Add the row to `00-index.md`.
4. Cross-link from any consuming module.

### A new schema change
1. Edit `docs/specs/infra/supabase-schema.sql` directly. Make every
   statement idempotent.
2. Apply via `make db-apply`. Verify with `make db-verify` and
   `make db-policies`.
3. If the change affects `progress.json` items, update the relevant
   item's subtasks in `docs/tasks.json` too.

### A new roadmap item
1. Add to `docs/progress.json` (the right phase, with `_es` translation).
2. Add a corresponding entry to `docs/tasks.json` with subtasks.
3. Optionally add to `docs/tasks.md` for the prose narrative.
4. The `/docs/roadmap/` and `/docs/tasks/` pages re-render automatically.

---

## Pre-PR checklist

```bash
make typecheck     # zero errors
make test          # all green (currently 19 tests)
make build         # zero errors, page count matches expectations
git status -s      # nothing untracked except .claude/ or .env.local
```

If touching SQL: `make db-apply` then `make db-verify`. If touching Edge
Functions: deploy via `gh workflow run deploy-functions.yml -f function=<name>`.

---

## When to ask vs when to just do

- **Just do**: refactors, bug fixes, doc updates, parity work, test
  additions, new components that don't change UX, performance fixes.
- **Ask first**: new external dependencies, schema changes that aren't
  additive, deleting code, anything that touches RLS, anything that
  changes the BYO-key privacy model, anything that bills the operator.

---

## Useful URLs while working

| What | URL |
|---|---|
| Production | https://rastrum.org |
| Supabase project | https://supabase.com/dashboard/project/reppvlqejgoqvitturxp |
| GitHub Actions | https://github.com/ArtemioPadilla/rastrum/actions |
| R2 bucket settings | https://dash.cloudflare.com/?to=/:account/r2/default/buckets/rastrum-media |
| Roadmap | https://rastrum.org/en/docs/roadmap/ |
| Tasks | https://rastrum.org/en/docs/tasks/ |
| MCP server | https://reppvlqejgoqvitturxp.supabase.co/functions/v1/mcp |
| API tokens | https://rastrum.org/en/profile/tokens |

---

## Audit / E2E

End-to-end browser tests run via Playwright; performance and a11y budgets
via Lighthouse CI. Both are wired into GitHub Actions
(`.github/workflows/e2e.yml`, `.github/workflows/lhci.yml`).

```bash
npm run test:e2e            # Playwright on chromium + mobile-chrome
npm run test:e2e:ui         # Playwright UI mode (debug locally)
npm run test:e2e:mobile     # mobile-chrome project only
npm run test:lhci           # Lighthouse CI against ./dist
npm run test:audit          # build + e2e + lhci end-to-end
```

Reports land in:
- `playwright-report/` — HTML report, opened with `npx playwright show-report`
- `test-results/` — failure traces, screenshots, videos
- `.lighthouseci/` — JSON + HTML for each URL audited

The suite is **intentionally minimal** — smoke + nav + docs + observe form +
PWA + a11y + mobile + offline. Total runtime under a minute locally on
chromium. Add tests sparingly; if you need a complex flow, ask whether
mocking is cheaper than a real test, and skip it if it depends on a real
Supabase session. See the per-spec comments for what's deliberately out of
scope (auth flows, identifier cascade, real SW caching).

The Playwright preview server uses port `4329` to avoid colliding with a
stray `astro dev` on `4321`. Override with `E2E_PORT=…` if needed.
