# Testing & CI

**Version target:** v0.1 (baseline), expanded every phase

Rastrum's reliability bar is higher than a typical web app because:

1. **Offline-first** means data lives on-device for days. A bad release
   can corrupt observations that are not yet synced.
2. **RLS security** is the only thing standing between anonymous users and
   other users' private observations. A broken policy is a data breach.
3. **Biodiversity data is append-only in spirit.** Observations shipped to GBIF
   cannot be recalled.

Every PR runs the checks below. CI fails hard — no "advisory" gates.

---

## Test Pyramid

```
           ┌────────────────────────┐
           │  E2E (Playwright)      │  ~20 tests — golden paths
           ├────────────────────────┤
           │  Integration           │  ~60 tests — API, Dexie, sync
           ├────────────────────────┤
           │  RLS policy (pgTAP)    │  ~30 tests — per-role, per-table
           ├────────────────────────┤
           │  Unit (Vitest)         │  ~200 tests — pure functions
           └────────────────────────┘
```

---

## Unit — Vitest

**Scope:** pure functions, preprocessing, validation, formatting, Dexie
schema migrations, Darwin Core mapping.

```bash
npm run test:unit         # vitest run
npm run test:unit:watch   # vitest
```

**Config:** `vitest.config.ts` with `environment: 'jsdom'` for browser APIs.

**Must-have suites:**
- `observationToDwC()` — every DwC field mapping + obscuration behaviour.
- `checkImageQuality()` — blur/size thresholds.
- `getObscurationLevel()` — NOM-059 / CITES matrix.
- `applyLocationPrivacy()` — grid rounding math.
- `validateObservation()` — required fields, GPS accuracy warning.
- Dexie schema migration (v1 → vN) replayability.

---

## RLS Policy Tests — pgTAP

**Scope:** every RLS policy on `observations`, `identifications`, `media_files`,
`users`, `taxa`. Run against a disposable Supabase branch on every PR.

```bash
npm run test:rls          # spins up supabase branch, runs pgTAP, tears down
```

**Must-have assertions:**
- Anonymous role cannot SELECT a `sync_status='pending'` observation.
- Anonymous role cannot SELECT a synced observation whose `obscure_level='full'`.
- Anonymous role can SELECT a synced observation with `obscure_level='0.2deg'`
  and sees `location_obscured`, not `location`.
- User A cannot SELECT / UPDATE / DELETE User B's observations.
- User A can migrate their own guest observations into their account.
- A non-`is_expert` user cannot set `identifications.is_research_grade = true`.
- Inserting an identification with `is_primary = true` causes the denormalised
  `observations.primary_taxon_id` / `obscure_level` / `location_obscured`
  columns to update via the `sync_primary_id_trigger`.
- Only one primary identification per observation (uniq index).

Example pgTAP test:

```sql
BEGIN;
  SELECT plan(3);

  -- Setup: create two users and an obscured observation
  INSERT INTO auth.users (id, email) VALUES
    ('00000000-0000-0000-0000-000000000001', 'alice@test'),
    ('00000000-0000-0000-0000-000000000002', 'bob@test');

  INSERT INTO observations (id, observer_id, location, sync_status, obscure_level)
  VALUES ('aaaa...', '00000000-...0001',
          ST_GeographyFromText('POINT(-96.7 17.0)'), 'synced', '0.2deg');

  -- As Bob, try to read Alice's raw coords
  SET LOCAL role = 'authenticated';
  SET LOCAL request.jwt.claim.sub = '00000000-0000-0000-0000-000000000002';

  SELECT results_eq(
    $$ SELECT location IS NULL FROM observations WHERE id = 'aaaa...' $$,
    $$ VALUES (true) $$,
    'Bob cannot see Alice raw coords'
  );

  SELECT finish();
ROLLBACK;
```

---

## Integration — API, Dexie, sync engine

**Scope:** PlantNet cascade logic, Claude JSON-response parsing, Dexie outbox
transitions, sync engine upload-then-upsert ordering.

Uses **MSW** (Mock Service Worker) for PlantNet and Anthropic; **fake-indexeddb**
for Dexie.

**Must-have suites:**
- PlantNet low-confidence (score < 0.7) falls through to Claude with the
  top-3 PlantNet candidates passed in the user message.
- Claude response missing required JSON fields → observation marked
  `identification.status = 'needs_review'`, not rejected.
- Offline submit: observation persists with `sync_status='pending'`,
  `navigator.onLine` flip fires `syncOutbox()`.
- Sync engine orders: media upload → mediaBlobs marked uploaded → observation
  upsert → mark synced. Failure at any step leaves state restartable.

---

## E2E — Playwright

**Scope:** golden paths + offline PWA audit.

**Must-have tests:**
- Install PWA, go offline, capture a photo, fill form, submit → observation
  appears in "pending sync" list. Toggle online → appears on server.
- Guest user creates 3 observations, is blocked on 4th, signs in, all 3
  migrate to their account and sync.
- Map page loads with pmtiles offline (pre-cached), displays clustered pins.
- Magic-link auth: request link, follow callback URL, lands on `/en/observe/`.

Runs headless in CI on Chromium + WebKit (Safari mobile parity matters).

---

## Accessibility & Performance

- `@axe-core/playwright` runs on every E2E page visit. Zero serious or
  critical violations allowed.
- Lighthouse CI budget (checked on PR previews):

| Metric | Budget |
|---|---|
| Performance | ≥ 90 |
| Accessibility | ≥ 95 |
| Best Practices | ≥ 95 |
| SEO | ≥ 90 |
| PWA | ≥ 90 |
| JS bundle (initial) | ≤ 180 KB gzipped |
| LCP (mobile 3G) | ≤ 2.5 s |

---

## Type & Lint

- `tsc --noEmit` on every PR. Strict mode, no `any` escape hatches in app code.
- `eslint --max-warnings=0`.
- `prettier --check`.

---

## CI Wiring

Extend `.github/workflows/deploy.yml` with a `test` job that runs before
`build`:

```yaml
  test:
    runs-on: ubuntu-latest
    services:
      postgres:
        image: supabase/postgres:15.1.0.147
        env:
          POSTGRES_PASSWORD: postgres
        ports: ['5432:5432']
    steps:
      - uses: actions/checkout@v4
      - uses: actions/setup-node@v4
        with: { node-version: '22', cache: 'npm' }
      - run: npm ci
      - run: npm run typecheck
      - run: npm run lint
      - run: npm run test:unit -- --coverage
      - run: npm run test:rls
      - run: npx playwright install --with-deps chromium webkit
      - run: npm run test:e2e

  build:
    needs: test
    # ... existing build steps
```

---

## Release-gate checklist

Before tagging any vN release, verify:

- [ ] All tests green on `main` for 24h.
- [ ] Lighthouse budgets met on production preview.
- [ ] Supabase migrations applied to staging and checked with `db diff`.
- [ ] No untested RLS policy additions since last release.
- [ ] Dexie schema version bumped if observation/media shapes changed.
- [ ] Darwin Core export sample validated against the GBIF data validator.
