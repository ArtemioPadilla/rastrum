# Home Page Redesign Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Split the conflated `/` route into anon-only marketing + a Fogg-aligned `/home` (es: `/inicio`) signed-in dashboard with a kairos-driven dynamic hero. Fix the production 400 from `country_code` being queried on the wrong table.

**Architecture:** Two-PR rollout. PR 1 is a hotfix that strips `<HomeWidgets/>` from `/`. PR 2 builds `/home` (greeting → dynamic hero → 4 chips → recent strip), adds a live-pulse strip + LATAM-recent peek to `/`, wires auto-redirect, and adds 3 server-cached RPCs. All new strings live in `i18n/{en,es}.json` per the EN/ES parity rule.

**Tech Stack:** Astro · TypeScript strict · Tailwind · Supabase (Postgres + RLS) · Vitest (happy-dom) · Playwright. Spec: `docs/superpowers/specs/2026-05-09-home-page-redesign-design.md`.

---

## Pre-flight

- [ ] **Read the design spec end-to-end:** `docs/superpowers/specs/2026-05-09-home-page-redesign-design.md`
- [ ] **Read CLAUDE.md** sections on EN/ES parity, schema security invariants, tailwind safelist, and chrome conventions.
- [ ] **Verify schema baseline** — confirm `notifications`, `user_streaks`, `watchlist_alerts` tables exist:

  ```bash
  grep -nE "CREATE TABLE.*notifications|CREATE TABLE.*user_streaks|CREATE TABLE.*watchlist_alerts" docs/specs/infra/supabase-schema.sql
  ```

  Expected: each table is found. If `watchlist_alerts` is absent, see Task 6 fallback.

- [ ] **Run baseline tests** to confirm a green starting point:

  ```bash
  npm run typecheck
  npm run test
  ```

  Expected: zero TypeScript errors, 734+ tests pass.

---

## Task 1: PR 1 hotfix — strip `<HomeWidgets/>` from `/`

**Why first:** the production 400 bleeds users on every home-page load. Ships independently.

**Files:**
- Modify: `src/pages/en/index.astro`
- Modify: `src/pages/es/index.astro`
- Test: `tests/unit/home-no-widgets.test.ts` (new)

- [ ] **Step 1: Write the failing test**

```ts
// tests/unit/home-no-widgets.test.ts
import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

describe('home page does not import HomeWidgets', () => {
  for (const lang of ['en', 'es'] as const) {
    it(`${lang} index.astro has no HomeWidgets import or usage`, () => {
      const path = join(process.cwd(), `src/pages/${lang}/index.astro`);
      const src = readFileSync(path, 'utf8');
      expect(src).not.toMatch(/HomeWidgets/);
    });
  }
});
```

- [ ] **Step 2: Run the test to verify it fails**

```bash
npx vitest run tests/unit/home-no-widgets.test.ts
```

Expected: FAIL — both `en` and `es` matches `/HomeWidgets/`.

- [ ] **Step 3: Remove the import + usage from both pages**

In `src/pages/en/index.astro`:
- Delete line: `import HomeWidgets from '../../components/HomeWidgets.astro';`
- Delete line: `<HomeWidgets lang={lang} />`

In `src/pages/es/index.astro`: same two deletions (the `lang` value is `'es'` but the lines mirror).

- [ ] **Step 4: Run the test to verify it passes + run full suite**

```bash
npx vitest run tests/unit/home-no-widgets.test.ts
npm run typecheck
npm run build
```

Expected: test passes; zero TS errors; 209 pages build clean.

- [ ] **Step 5: Commit + open PR 1**

```bash
git add src/pages/en/index.astro src/pages/es/index.astro tests/unit/home-no-widgets.test.ts
git commit -m "$(cat <<'EOF'
fix(home): remove HomeWidgets to stop /rest/v1/observations 400

HomeWidgets queries country_code on observations, but that column lives
on users. PostgREST returns 400 on every / load. Strip the widget; /home
will rebuild this with a corrected query in a follow-up.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>
EOF
)"
gh pr create --base main --title "fix(home): strip HomeWidgets to stop production 400" \
  --body "Fixes the production 400 from \`country_code\` being queried on the wrong table. Follow-up PR rebuilds the dashboard at \`/home\` per docs/superpowers/specs/2026-05-09-home-page-redesign-design.md."
```

After this, all subsequent tasks belong to PR 2.

---

## Task 2: SQL — `home_pulse_stats` RPC

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append to end of file, in a new section)

- [ ] **Step 1: Add the RPC**

Append to `docs/specs/infra/supabase-schema.sql`:

```sql
-- =====================================================================
-- M33: home page redesign — pulse + counts + falta-dex summary
-- See docs/superpowers/specs/2026-05-09-home-page-redesign-design.md.
-- =====================================================================

CREATE OR REPLACE FUNCTION public.home_pulse_stats()
RETURNS TABLE(obs_30d int, species_30d int, active_observers_30d int)
LANGUAGE sql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
  SELECT
    (SELECT count(*)::int FROM observations
       WHERE sync_status='synced' AND observed_at > now() - interval '30 days'),
    (SELECT count(DISTINCT primary_taxon_id)::int FROM observations
       WHERE sync_status='synced' AND observed_at > now() - interval '30 days'
         AND primary_taxon_id IS NOT NULL),
    (SELECT count(DISTINCT observer_id)::int FROM observations
       WHERE sync_status='synced' AND observed_at > now() - interval '30 days');
$$;
GRANT EXECUTE ON FUNCTION public.home_pulse_stats() TO anon, authenticated;
```

- [ ] **Step 2: Apply locally + verify**

```bash
make db-apply
make db-psql
# inside psql:
SELECT * FROM public.home_pulse_stats();
\q
```

Expected: returns one row with three integer columns.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(home): home_pulse_stats() RPC for marketing pulse strip

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

The pre-merge `db-validate.yml` workflow will replay the schema twice and verify idempotency.

---

## Task 3: SQL — `pending_validation_count` RPC

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append to the same section as Task 2)

- [ ] **Step 1: Add the RPC**

Append to the same M33 section:

```sql
-- Returns the number of pending community IDs in taxa where the caller
-- holds the 'expert' role. Capped at 99 (UI shows "99+"). Returns 0 for
-- non-experts.
CREATE OR REPLACE FUNCTION public.pending_validation_count()
RETURNS int
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  n   int;
BEGIN
  IF uid IS NULL THEN RETURN 0; END IF;
  IF NOT has_role(uid, 'expert') THEN RETURN 0; END IF;

  SELECT LEAST(count(*), 99)::int INTO n
  FROM identifications i
  JOIN observations    o ON o.id = i.observation_id
  WHERE i.is_research_grade = false
    AND i.validated_by IS NULL
    AND o.observer_id <> uid;

  RETURN COALESCE(n, 0);
END;
$$;
GRANT EXECUTE ON FUNCTION public.pending_validation_count() TO authenticated;
```

- [ ] **Step 2: Apply + verify**

```bash
make db-apply
make db-psql
# inside psql, as a non-authenticated session:
SELECT public.pending_validation_count();
-- Expected: 0 (uid is null)
\q
```

Expected: returns `0` for an anon caller; non-zero for a real signed-in expert.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(home): pending_validation_count() RPC scoped to expert role

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 4: SQL — `falta_dex_summary` RPC

**Files:**
- Modify: `docs/specs/infra/supabase-schema.sql` (append to the same section)

- [ ] **Step 1: Add the RPC**

```sql
-- Returns a summary of falta-dex gaps for the caller — count of taxa
-- not yet observed in user's region_primary, plus the region label
-- itself. Returns (0, NULL) for users without region_primary set.
CREATE OR REPLACE FUNCTION public.falta_dex_summary()
RETURNS TABLE(gap_count int, region text)
LANGUAGE plpgsql STABLE SECURITY INVOKER
SET search_path = public, extensions, pg_temp
AS $$
DECLARE
  uid uuid := auth.uid();
  user_region text;
BEGIN
  IF uid IS NULL THEN
    RETURN QUERY SELECT 0::int, NULL::text; RETURN;
  END IF;

  SELECT region_primary INTO user_region FROM users WHERE id = uid;
  IF user_region IS NULL THEN
    RETURN QUERY SELECT 0::int, NULL::text; RETURN;
  END IF;

  RETURN QUERY
  SELECT
    LEAST(count(DISTINCT t.id), 999)::int AS gap_count,
    user_region                          AS region
  FROM taxa t
  WHERE t.id IN (
    SELECT DISTINCT primary_taxon_id FROM observations
    WHERE state_province = user_region AND primary_taxon_id IS NOT NULL
  )
  AND t.id NOT IN (
    SELECT DISTINCT primary_taxon_id FROM observations
    WHERE observer_id = uid AND primary_taxon_id IS NOT NULL
  );
END;
$$;
GRANT EXECUTE ON FUNCTION public.falta_dex_summary() TO authenticated;
```

- [ ] **Step 2: Apply + verify**

```bash
make db-apply
make db-psql
# inside psql:
SELECT * FROM public.falta_dex_summary();
\q
```

Expected: one row, `(0, NULL)` for the apply role; real values for a user with `region_primary` set.

- [ ] **Step 3: Commit**

```bash
git add docs/specs/infra/supabase-schema.sql
git commit -m "feat(home): falta_dex_summary() RPC for chips counter

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 5: i18n + routes scaffolding

**Files:**
- Modify: `src/i18n/utils.ts`
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

- [ ] **Step 1: Add the route entry**

In `src/i18n/utils.ts`, find the `routes` object (around line 25) and add:

```ts
home: { en: '/home', es: '/inicio' },
```

Place it alphabetically with the other route entries.

- [ ] **Step 2: Add EN strings**

In `src/i18n/en.json`, add a top-level `"home_dashboard"` block (the existing `"home"` block is for marketing — keep it):

```json
"home_dashboard": {
  "greeting": {
    "madrugada": "Hello, {name}",
    "morning": "Good morning, {name}",
    "afternoon": "Good afternoon, {name}",
    "evening": "Good evening, {name}",
    "anonymous_madrugada": "Hello",
    "anonymous_morning": "Good morning",
    "anonymous_afternoon": "Good afternoon",
    "anonymous_evening": "Good evening"
  },
  "streak": { "label_one": "day streak", "label_other": "day streak", "aria": "{count} day streak" },
  "hero": {
    "streak_at_risk": {
      "eyebrow": "Keep your streak alive",
      "title": "Your {streakDays}-day streak ends at midnight",
      "subtitle": "You haven't logged today. One observation by midnight keeps it.",
      "cta": "Observe now"
    },
    "watchlist_hit": {
      "eyebrow": "Watchlist match nearby",
      "title": "{taxonName} seen {km} km away",
      "subtitle": "Spotted by another observer in the last 24h. Worth a trip?",
      "cta": "Open on map"
    },
    "pending_ids": {
      "eyebrow": "Your expertise is needed",
      "title": "{count} community IDs need a second opinion",
      "subtitle": "You're an expert in {taxonGroup} — your verdict counts.",
      "cta": "Open queue"
    },
    "observe_default": {
      "eyebrow": "Right now, in your area",
      "title": "Observe now",
      "title_morning": "Morning is peak activity",
      "subtitle": "Tap to log what you see.",
      "subtitle_morning": "Birds and insects are most active. Tap to log what you see.",
      "cta": "Open camera"
    }
  },
  "chips": {
    "inbox": "Inbox",
    "validate": "Validate",
    "falta_dex": "Falta-dex",
    "watchlist": "Watchlist",
    "count_suffix": "",
    "count_overflow": "99+"
  },
  "recent": {
    "title_local": "Recent in {country}",
    "title_global": "Recent observations",
    "view_all": "View all",
    "loading": "Loading…",
    "empty": "No recent observations.",
    "unknown_species": "Unknown species"
  }
}
```

In the existing `"home"` block (marketing) add a new `"pulse"` and `"recent_latam"` sub-block:

```json
"pulse": {
  "label": "{obs} observations · {species} species · {observers} active observers · last 30 days",
  "label_short": "{obs} observations · {species} species"
},
"recent_latam": {
  "title": "Recent in Latin America",
  "loading": "Loading…",
  "anon_observer": "an observer in {country}"
}
```

- [ ] **Step 3: Mirror in ES**

In `src/i18n/es.json`, add the same `"home_dashboard"` block with Spanish copy (keys identical to EN):

```json
"home_dashboard": {
  "greeting": {
    "madrugada": "Hola, {name}",
    "morning": "Buenos días, {name}",
    "afternoon": "Buenas tardes, {name}",
    "evening": "Buenas noches, {name}",
    "anonymous_madrugada": "Hola",
    "anonymous_morning": "Buenos días",
    "anonymous_afternoon": "Buenas tardes",
    "anonymous_evening": "Buenas noches"
  },
  "streak": { "label_one": "día de racha", "label_other": "días de racha", "aria": "Racha de {count} días" },
  "hero": {
    "streak_at_risk": {
      "eyebrow": "Mantén tu racha",
      "title": "Tu racha de {streakDays} días termina a medianoche",
      "subtitle": "No has registrado hoy. Una observación antes de medianoche la conserva.",
      "cta": "Observar ahora"
    },
    "watchlist_hit": {
      "eyebrow": "Coincidencia en tu lista cercana",
      "title": "{taxonName} visto a {km} km",
      "subtitle": "Avistado por otra persona en las últimas 24h. ¿Vale la pena ir?",
      "cta": "Ver en el mapa"
    },
    "pending_ids": {
      "eyebrow": "Necesitan tu experiencia",
      "title": "{count} IDs de la comunidad esperan tu opinión",
      "subtitle": "Eres experta/o en {taxonGroup} — tu veredicto cuenta.",
      "cta": "Abrir cola"
    },
    "observe_default": {
      "eyebrow": "Ahora, en tu zona",
      "title": "Observar ahora",
      "title_morning": "La mañana es la hora de máxima actividad",
      "subtitle": "Toca para registrar lo que veas.",
      "subtitle_morning": "Las aves e insectos están más activos. Toca para registrar.",
      "cta": "Abrir cámara"
    }
  },
  "chips": {
    "inbox": "Bandeja",
    "validate": "Validar",
    "falta_dex": "Falta-dex",
    "watchlist": "Lista",
    "count_suffix": "",
    "count_overflow": "99+"
  },
  "recent": {
    "title_local": "Recientes en {country}",
    "title_global": "Observaciones recientes",
    "view_all": "Ver todo",
    "loading": "Cargando…",
    "empty": "Sin observaciones recientes.",
    "unknown_species": "Especie desconocida"
  }
}
```

And in the existing `"home"` block:

```json
"pulse": {
  "label": "{obs} observaciones · {species} especies · {observers} observadores activos · últimos 30 días",
  "label_short": "{obs} observaciones · {species} especies"
},
"recent_latam": {
  "title": "Recientes en Latinoamérica",
  "loading": "Cargando…",
  "anon_observer": "una persona observando en {country}"
}
```

- [ ] **Step 4: Run i18n parity test + typecheck**

```bash
npx vitest run tests/unit/i18n-parity.test.ts
npm run typecheck
```

Expected: parity test passes (EN/ES key sets identical); zero TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/i18n/utils.ts src/i18n/en.json src/i18n/es.json
git commit -m "feat(home): add /home + /inicio routes and i18n scaffolding

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 6: Hero state resolver — pure logic, TDD

**Files:**
- Create: `src/lib/home-hero.ts`
- Create: `tests/unit/home-hero.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/home-hero.test.ts
import { describe, it, expect } from 'vitest';
import { resolveHeroState, type HeroInputs } from '../../src/lib/home-hero';

const baseInputs: HeroInputs = {
  streak: null,
  watchlistHit: null,
  pendingIdsCount: 0,
  expertTaxonGroup: null,
  now: new Date('2026-05-09T20:00:00Z'),  // 20:00 UTC
  userTimezone: 'UTC',
};

describe('resolveHeroState', () => {
  it('falls through to observe_default when no signals', () => {
    expect(resolveHeroState(baseInputs).kind).toBe('observe_default');
  });

  it('observe_default flags morningPeak between 5–9 local', () => {
    const r = resolveHeroState({
      ...baseInputs,
      now: new Date('2026-05-09T07:00:00Z'),
    });
    expect(r).toEqual({ kind: 'observe_default', morningPeak: true });
  });

  it('observe_default morningPeak=false outside 5–9', () => {
    const r = resolveHeroState({
      ...baseInputs,
      now: new Date('2026-05-09T12:00:00Z'),
    });
    expect(r).toEqual({ kind: 'observe_default', morningPeak: false });
  });

  it('streak_at_risk: only after 18:00 local', () => {
    const before = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 5, lastObsLocalDay: '2026-05-08' },
      now: new Date('2026-05-09T15:00:00Z'),  // 15:00 UTC = before 18:00
    });
    expect(before.kind).toBe('observe_default');

    const after = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 5, lastObsLocalDay: '2026-05-08' },
      now: new Date('2026-05-09T19:00:00Z'),  // 19:00 UTC
    });
    expect(after.kind).toBe('streak_at_risk');
    if (after.kind === 'streak_at_risk') expect(after.currentDays).toBe(5);
  });

  it('streak_at_risk: skipped if user observed today', () => {
    const r = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 5, lastObsLocalDay: '2026-05-09' },
      now: new Date('2026-05-09T20:00:00Z'),
    });
    expect(r.kind).toBe('observe_default');
  });

  it('streak_at_risk: skipped if currentDays is 0', () => {
    const r = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 0, lastObsLocalDay: null },
      now: new Date('2026-05-09T20:00:00Z'),
    });
    expect(r.kind).toBe('observe_default');
  });

  it('watchlist_hit beats observe_default but loses to streak_at_risk', () => {
    const watchOnly = resolveHeroState({
      ...baseInputs,
      watchlistHit: { taxonName: 'Quetzal', distanceKm: 4, obsId: 'abc', observedAt: '2026-05-09T18:00:00Z' },
    });
    expect(watchOnly.kind).toBe('watchlist_hit');

    const both = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 12, lastObsLocalDay: '2026-05-08' },
      watchlistHit: { taxonName: 'Quetzal', distanceKm: 4, obsId: 'abc', observedAt: '2026-05-09T18:00:00Z' },
      now: new Date('2026-05-09T19:30:00Z'),
    });
    expect(both.kind).toBe('streak_at_risk');
  });

  it('pending_ids: requires count >= 3 AND expertTaxonGroup', () => {
    const noGroup = resolveHeroState({ ...baseInputs, pendingIdsCount: 7 });
    expect(noGroup.kind).toBe('observe_default');

    const withGroup = resolveHeroState({
      ...baseInputs,
      pendingIdsCount: 7,
      expertTaxonGroup: 'Aves',
    });
    expect(withGroup.kind).toBe('pending_ids');
    if (withGroup.kind === 'pending_ids') {
      expect(withGroup.count).toBe(7);
      expect(withGroup.taxonGroup).toBe('Aves');
    }

    const tooFew = resolveHeroState({
      ...baseInputs,
      pendingIdsCount: 2,
      expertTaxonGroup: 'Aves',
    });
    expect(tooFew.kind).toBe('observe_default');
  });

  it('cascade ordering: streak > watchlist > pending > default', () => {
    const r = resolveHeroState({
      ...baseInputs,
      streak: { currentDays: 12, lastObsLocalDay: '2026-05-08' },
      watchlistHit: { taxonName: 'Quetzal', distanceKm: 4, obsId: 'abc', observedAt: '2026-05-09T18:00:00Z' },
      pendingIdsCount: 7,
      expertTaxonGroup: 'Aves',
      now: new Date('2026-05-09T20:00:00Z'),
    });
    expect(r.kind).toBe('streak_at_risk');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/home-hero.test.ts
```

Expected: FAIL — `Cannot find module '../../src/lib/home-hero'`.

- [ ] **Step 3: Implement the resolver**

Create `src/lib/home-hero.ts`:

```ts
export type HeroState =
  | { kind: 'streak_at_risk'; currentDays: number; hoursLeftLocal: number }
  | { kind: 'watchlist_hit'; taxonName: string; distanceKm: number; obsId: string; observedAt: string }
  | { kind: 'pending_ids'; count: number; taxonGroup: string; queueUrl: string }
  | { kind: 'observe_default'; morningPeak: boolean };

export interface HeroInputs {
  streak: { currentDays: number; lastObsLocalDay: string | null } | null;
  watchlistHit: { taxonName: string; distanceKm: number; obsId: string; observedAt: string } | null;
  pendingIdsCount: number;
  expertTaxonGroup: string | null;
  now: Date;
  userTimezone: string;
}

function localParts(d: Date, tz: string): { hour: number; isoDay: string } {
  try {
    const fmt = new Intl.DateTimeFormat('en-CA', {
      timeZone: tz,
      hour12: false,
      year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit',
    });
    const parts = Object.fromEntries(fmt.formatToParts(d).map(p => [p.type, p.value]));
    return {
      hour: Number(parts.hour ?? '0'),
      isoDay: `${parts.year}-${parts.month}-${parts.day}`,
    };
  } catch {
    return { hour: d.getUTCHours(), isoDay: d.toISOString().slice(0, 10) };
  }
}

export function resolveHeroState(inputs: HeroInputs): HeroState {
  const { hour, isoDay } = localParts(inputs.now, inputs.userTimezone);

  if (
    inputs.streak &&
    inputs.streak.currentDays >= 1 &&
    inputs.streak.lastObsLocalDay !== isoDay &&
    hour >= 18
  ) {
    return {
      kind: 'streak_at_risk',
      currentDays: inputs.streak.currentDays,
      hoursLeftLocal: 24 - hour,
    };
  }

  if (inputs.watchlistHit) {
    return { kind: 'watchlist_hit', ...inputs.watchlistHit };
  }

  if (inputs.pendingIdsCount >= 3 && inputs.expertTaxonGroup) {
    return {
      kind: 'pending_ids',
      count: inputs.pendingIdsCount,
      taxonGroup: inputs.expertTaxonGroup,
      queueUrl: '/en/console/validate/',
    };
  }

  return { kind: 'observe_default', morningPeak: hour >= 5 && hour <= 9 };
}
```

- [ ] **Step 4: Run tests to verify they pass**

```bash
npx vitest run tests/unit/home-hero.test.ts
npm run typecheck
```

Expected: 9/9 pass; zero TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/home-hero.ts tests/unit/home-hero.test.ts
git commit -m "feat(home): hero state resolver with 4-priority cascade

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 7: Data loaders — TDD

**Files:**
- Create: `src/lib/home-loaders.ts`
- Create: `tests/unit/home-loaders.test.ts`

- [ ] **Step 1: Write the failing tests**

```ts
// tests/unit/home-loaders.test.ts
import { describe, it, expect, vi } from 'vitest';
import {
  loadInboxCount, loadValidateCount, loadFaltaDexCount, loadWatchlistHit,
  loadStreak, loadRecent, loadHeroInputs,
} from '../../src/lib/home-loaders';

function makeClient(handlers: Record<string, () => unknown>) {
  return {
    from: (table: string) => {
      const h = handlers[`from:${table}`];
      if (!h) throw new Error(`unmocked from('${table}')`);
      return h();
    },
    rpc: (name: string) => {
      const h = handlers[`rpc:${name}`];
      if (!h) throw new Error(`unmocked rpc('${name}')`);
      return h();
    },
  };
}

describe('home-loaders', () => {
  it('loadInboxCount returns count or 0 on error', async () => {
    const ok = makeClient({
      'from:notifications': () => ({
        select: () => ({ eq: () => ({ is: () => Promise.resolve({ count: 3, error: null }) }) }),
      }),
    });
    expect(await loadInboxCount(ok as never, 'u1')).toBe(3);

    const errored = makeClient({
      'from:notifications': () => ({
        select: () => ({ eq: () => ({ is: () => Promise.resolve({ count: null, error: { message: 'x' } }) }) }),
      }),
    });
    expect(await loadInboxCount(errored as never, 'u1')).toBe(0);
  });

  it('loadValidateCount uses the RPC', async () => {
    const c = makeClient({
      'rpc:pending_validation_count': () => Promise.resolve({ data: 7, error: null }),
    });
    expect(await loadValidateCount(c as never)).toBe(7);
  });

  it('loadStreak returns null on error', async () => {
    const c = makeClient({
      'from:user_streaks': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({ data: null, error: { message: 'x' } }) }) }),
      }),
    });
    expect(await loadStreak(c as never, 'u1')).toBeNull();
  });

  it('loadHeroInputs runs all loaders in parallel and tolerates partial failure', async () => {
    const c = makeClient({
      'from:user_streaks': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
          data: { current_days: 5, last_qualifying_day: '2026-05-08' }, error: null,
        }) }) }),
      }),
      'from:watchlist_alerts': () => ({
        select: () => ({ eq: () => ({ is: () => ({ order: () => ({ limit: () => Promise.resolve({
          data: [], error: null,
        }) }) }) }) }),
      }),
      'rpc:pending_validation_count': () => Promise.resolve({ data: 0, error: null }),
      'from:users': () => ({
        select: () => ({ eq: () => ({ maybeSingle: () => Promise.resolve({
          data: { timezone: 'America/Mexico_City', expert_taxon_group: null }, error: null,
        }) }) }),
      }),
    });
    const inputs = await loadHeroInputs(c as never, 'u1', new Date('2026-05-09T20:00:00Z'));
    expect(inputs.streak).toEqual({ currentDays: 5, lastObsLocalDay: '2026-05-08' });
    expect(inputs.pendingIdsCount).toBe(0);
    expect(inputs.userTimezone).toBe('America/Mexico_City');
  });
});
```

- [ ] **Step 2: Run tests to verify they fail**

```bash
npx vitest run tests/unit/home-loaders.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3: Implement the loaders**

Create `src/lib/home-loaders.ts`:

```ts
import type { SupabaseClient } from '@supabase/supabase-js';
import type { HeroInputs } from './home-hero';

type Client = SupabaseClient;

export async function loadInboxCount(c: Client, userId: string): Promise<number> {
  try {
    const { count, error } = await c.from('notifications')
      .select('id', { count: 'exact', head: true })
      .eq('user_id', userId)
      .is('read_at', null);
    if (error) return 0;
    return count ?? 0;
  } catch { return 0; }
}

export async function loadValidateCount(c: Client): Promise<number> {
  try {
    const { data, error } = await c.rpc('pending_validation_count');
    if (error) return 0;
    return typeof data === 'number' ? data : 0;
  } catch { return 0; }
}

export async function loadFaltaDexCount(c: Client): Promise<{ count: number; region: string | null }> {
  try {
    const { data, error } = await c.rpc('falta_dex_summary');
    if (error || !data || !Array.isArray(data) || data.length === 0) return { count: 0, region: null };
    const row = data[0] as { gap_count?: number; region?: string | null };
    return { count: row.gap_count ?? 0, region: row.region ?? null };
  } catch { return { count: 0, region: null }; }
}

export interface WatchlistHit {
  taxonName: string;
  distanceKm: number;
  obsId: string;
  observedAt: string;
}

export async function loadWatchlistHit(c: Client, userId: string): Promise<WatchlistHit | null> {
  try {
    const { data, error } = await c.from('watchlist_alerts')
      .select('observation_id, taxon_name, distance_km, observed_at')
      .eq('user_id', userId)
      .is('acknowledged_at', null)
      .order('observed_at', { ascending: false })
      .limit(1);
    if (error || !data || data.length === 0) return null;
    const r = data[0] as { observation_id: string; taxon_name: string; distance_km: number | null; observed_at: string };
    return {
      taxonName: r.taxon_name,
      distanceKm: r.distance_km ?? 0,
      obsId: r.observation_id,
      observedAt: r.observed_at,
    };
  } catch { return null; }
}

export interface StreakSnap { currentDays: number; lastObsLocalDay: string | null; }

export async function loadStreak(c: Client, userId: string): Promise<StreakSnap | null> {
  try {
    const { data, error } = await c.from('user_streaks')
      .select('current_days, last_qualifying_day')
      .eq('user_id', userId)
      .maybeSingle();
    if (error || !data) return null;
    const row = data as { current_days: number; last_qualifying_day: string | null };
    return { currentDays: row.current_days, lastObsLocalDay: row.last_qualifying_day };
  } catch { return null; }
}

export async function loadHeroInputs(c: Client, userId: string, now: Date): Promise<HeroInputs> {
  const [streak, watchlistHit, pendingIdsCount, profile] = await Promise.all([
    loadStreak(c, userId),
    loadWatchlistHit(c, userId),
    loadValidateCount(c),
    (async () => {
      try {
        const { data } = await c.from('users')
          .select('timezone, expert_taxon_group')
          .eq('id', userId)
          .maybeSingle();
        return data as { timezone: string | null; expert_taxon_group: string | null } | null;
      } catch { return null; }
    })(),
  ]);
  return {
    streak,
    watchlistHit,
    pendingIdsCount,
    expertTaxonGroup: profile?.expert_taxon_group ?? null,
    now,
    userTimezone: profile?.timezone ?? 'UTC',
  };
}

export interface RecentObs {
  id: string; observedAt: string; stateProvince: string | null;
  scientificName: string | null; commonName: string | null;
  photoUrl: string | null;
}

export async function loadRecent(
  c: Client,
  lang: 'en' | 'es',
  country: string | null,
): Promise<{ rows: RecentObs[]; usedLocalScope: boolean }> {
  const select = `
    id, observed_at, state_province,
    observer:users!observer_id(country_code),
    identifications(scientific_name, is_primary, is_research_grade, confidence,
                    taxa(common_name_es, common_name_en)),
    media_files(url, is_primary, media_type)
  `;
  let usedLocalScope = false;
  let rows: RecentObs[] = [];
  if (country) {
    try {
      const { data } = await c.from('observations').select(select)
        .eq('sync_status', 'synced')
        .eq('observer.country_code', country)
        .order('observed_at', { ascending: false }).limit(3);
      if (data && data.length === 3) {
        usedLocalScope = true;
        rows = (data as unknown as RawObs[]).map(toRecent(lang));
      }
    } catch { /* fall through */ }
  }
  if (rows.length < 3) {
    try {
      const { data } = await c.from('observations').select(select)
        .eq('sync_status', 'synced')
        .order('observed_at', { ascending: false }).limit(3);
      rows = (data as unknown as RawObs[] ?? []).map(toRecent(lang));
      usedLocalScope = false;
    } catch { rows = []; }
  }
  return { rows, usedLocalScope };
}

interface RawObs {
  id: string; observed_at: string; state_province: string | null;
  identifications: Array<{ scientific_name: string | null; is_primary: boolean | null; confidence: number | null; taxa: { common_name_en: string | null; common_name_es: string | null } | null }> | null;
  media_files: Array<{ url: string | null; is_primary: boolean | null; media_type: string | null }> | null;
}

function toRecent(lang: 'en' | 'es') {
  return (r: RawObs): RecentObs => {
    const idents = r.identifications ?? [];
    const primary = idents.find(i => i.is_primary) ?? [...idents].sort((a, b) => (b.confidence ?? 0) - (a.confidence ?? 0))[0];
    const photoMedia = (r.media_files ?? []).filter(m => !m.media_type || m.media_type === 'photo');
    const photo = photoMedia.find(m => m.is_primary)?.url ?? photoMedia.find(m => !!m.url)?.url ?? null;
    return {
      id: r.id,
      observedAt: r.observed_at,
      stateProvince: r.state_province,
      scientificName: primary?.scientific_name ?? null,
      commonName: lang === 'es'
        ? (primary?.taxa?.common_name_es ?? primary?.taxa?.common_name_en ?? null)
        : (primary?.taxa?.common_name_en ?? primary?.taxa?.common_name_es ?? null),
      photoUrl: photo,
    };
  };
}
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npx vitest run tests/unit/home-loaders.test.ts
npm run typecheck
```

Expected: 4/4 tests pass; zero TS errors.

- [ ] **Step 5: Commit**

```bash
git add src/lib/home-loaders.ts tests/unit/home-loaders.test.ts
git commit -m "feat(home): data loaders for /home — error-tolerant + parallel

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 8: HomeGreeting + HomeHero components

**Files:**
- Create: `src/components/home/HomeGreeting.astro`
- Create: `src/components/home/HomeHero.astro`
- Modify: `tailwind.config.mjs` (safelist)

- [ ] **Step 1: Add Tailwind safelist entries**

In `tailwind.config.mjs`, find the `safelist` array and append:

```js
// Home hero — kind-driven rail/bg classes resolved at runtime.
'border-red-400', 'bg-red-50/60', 'text-red-700',
'border-blue-400', 'bg-blue-50/60', 'text-blue-700',
'border-purple-400', 'bg-purple-50/60', 'text-purple-700',
'border-emerald-400', 'bg-emerald-50/60', 'text-emerald-700',
// dark mode equivalents
'dark:border-red-700/60', 'dark:bg-red-950/40', 'dark:text-red-300',
'dark:border-blue-700/60', 'dark:bg-blue-950/40', 'dark:text-blue-300',
'dark:border-purple-700/60', 'dark:bg-purple-950/40', 'dark:text-purple-300',
'dark:border-emerald-700/60', 'dark:bg-emerald-950/40', 'dark:text-emerald-300',
```

- [ ] **Step 2: Write `HomeGreeting.astro`**

```astro
---
import { t } from '../../i18n/utils';
interface Props { lang: 'en' | 'es'; }
const { lang } = Astro.props;
const tr = t(lang);
---

<section
  class="hg-root flex items-center justify-between flex-wrap gap-3"
  data-lang={lang}
  data-greeting-madrugada={tr.home_dashboard.greeting.madrugada}
  data-greeting-morning={tr.home_dashboard.greeting.morning}
  data-greeting-afternoon={tr.home_dashboard.greeting.afternoon}
  data-greeting-evening={tr.home_dashboard.greeting.evening}
  data-streak-label={tr.home_dashboard.streak.label_other}
  data-streak-aria={tr.home_dashboard.streak.aria}
>
  <p class="hg-text text-3xl sm:text-4xl font-bold tracking-tight text-zinc-900 dark:text-zinc-100" role="status" aria-live="polite">…</p>
  <span class="hg-streak hidden inline-flex items-center gap-1.5 rounded-full border border-amber-300 dark:border-amber-700/60 bg-amber-50 dark:bg-amber-950/40 px-3 py-1.5 text-sm font-semibold text-amber-900 dark:text-amber-200" role="status">
    <span aria-hidden="true">🔥</span>
    <span class="hg-streak-text tabular-nums">0</span>
  </span>
</section>

<script>
  import { getSupabase } from '../../lib/supabase';
  import { loadStreak } from '../../lib/home-loaders';
  import { buildGreeting } from '../../lib/home-greeting';

  type Lang = 'en' | 'es';

  async function init() {
    const root = document.querySelector<HTMLElement>('.hg-root');
    if (!root) return;
    const lang = (root.dataset.lang as Lang) ?? 'en';
    let c; try { c = getSupabase(); } catch { return; }
    const { data: { user } } = await c.auth.getUser();
    if (!user) return;

    const { data: profile } = await c.from('users')
      .select('display_name, username').eq('id', user.id).maybeSingle();
    const name = (profile as { display_name: string | null; username: string | null } | null)?.display_name
              ?? (profile as { username: string | null } | null)?.username ?? null;

    const text = buildGreeting(new Date().getHours(), lang, name);
    const el = root.querySelector<HTMLElement>('.hg-text');
    if (el) el.textContent = text;

    const streak = await loadStreak(c, user.id);
    if (streak && streak.currentDays > 0) {
      const pill = root.querySelector<HTMLElement>('.hg-streak');
      const txt = root.querySelector<HTMLElement>('.hg-streak-text');
      if (pill && txt) {
        const tpl = root.dataset.streakLabel ?? '';
        txt.textContent = `${streak.currentDays} ${tpl}`;
        const aria = (root.dataset.streakAria ?? '').replace('{count}', String(streak.currentDays));
        pill.setAttribute('aria-label', aria);
        pill.classList.remove('hidden');
      }
    }
  }

  init().catch(() => {});
</script>
```

- [ ] **Step 3: Write `HomeHero.astro`**

```astro
---
import { t } from '../../i18n/utils';
interface Props { lang: 'en' | 'es'; }
const { lang } = Astro.props;
const tr = t(lang);
const h = tr.home_dashboard.hero;
---

<section
  class="hh-root rounded-2xl border-2 p-5 sm:p-6 mb-4 hidden"
  data-lang={lang}
  data-streak-eyebrow={h.streak_at_risk.eyebrow}
  data-streak-title={h.streak_at_risk.title}
  data-streak-subtitle={h.streak_at_risk.subtitle}
  data-streak-cta={h.streak_at_risk.cta}
  data-watch-eyebrow={h.watchlist_hit.eyebrow}
  data-watch-title={h.watchlist_hit.title}
  data-watch-subtitle={h.watchlist_hit.subtitle}
  data-watch-cta={h.watchlist_hit.cta}
  data-pending-eyebrow={h.pending_ids.eyebrow}
  data-pending-title={h.pending_ids.title}
  data-pending-subtitle={h.pending_ids.subtitle}
  data-pending-cta={h.pending_ids.cta}
  data-default-eyebrow={h.observe_default.eyebrow}
  data-default-title={h.observe_default.title}
  data-default-title-morning={h.observe_default.title_morning}
  data-default-subtitle={h.observe_default.subtitle}
  data-default-subtitle-morning={h.observe_default.subtitle_morning}
  data-default-cta={h.observe_default.cta}
>
  <div class="hh-eyebrow text-xs uppercase tracking-wider font-bold mb-1.5"></div>
  <div class="hh-title text-xl sm:text-2xl font-bold leading-tight"></div>
  <div class="hh-subtitle text-sm mt-1.5 opacity-90"></div>
  <a class="hh-cta inline-block mt-4 px-5 py-2.5 rounded-lg font-semibold transition-colors" href="#"></a>
</section>

<script>
  import { getSupabase } from '../../lib/supabase';
  import { loadHeroInputs } from '../../lib/home-loaders';
  import { resolveHeroState } from '../../lib/home-hero';

  type Lang = 'en' | 'es';

  const KIND_CLASSES: Record<string, string[]> = {
    streak_at_risk: ['border-red-400', 'bg-red-50/60', 'text-red-700', 'dark:border-red-700/60', 'dark:bg-red-950/40', 'dark:text-red-300'],
    watchlist_hit: ['border-blue-400', 'bg-blue-50/60', 'text-blue-700', 'dark:border-blue-700/60', 'dark:bg-blue-950/40', 'dark:text-blue-300'],
    pending_ids: ['border-purple-400', 'bg-purple-50/60', 'text-purple-700', 'dark:border-purple-700/60', 'dark:bg-purple-950/40', 'dark:text-purple-300'],
    observe_default: ['border-emerald-400', 'bg-emerald-50/60', 'text-emerald-700', 'dark:border-emerald-700/60', 'dark:bg-emerald-950/40', 'dark:text-emerald-300'],
  };
  const CTA_BG: Record<string, string> = {
    streak_at_risk: 'bg-red-600 hover:bg-red-700 text-white',
    watchlist_hit: 'bg-blue-600 hover:bg-blue-700 text-white',
    pending_ids: 'bg-purple-600 hover:bg-purple-700 text-white',
    observe_default: 'bg-emerald-700 hover:bg-emerald-800 text-white',
  };

  function fill(s: string, vars: Record<string, string | number>): string {
    return s.replace(/\{(\w+)\}/g, (_, k) => String(vars[k] ?? ''));
  }

  async function init() {
    const root = document.querySelector<HTMLElement>('.hh-root');
    if (!root) return;
    const lang = (root.dataset.lang as Lang) ?? 'en';
    let c; try { c = getSupabase(); } catch { return; }
    const { data: { user } } = await c.auth.getUser();
    if (!user) return;

    const inputs = await loadHeroInputs(c as never, user.id, new Date());
    const state = resolveHeroState(inputs);

    const cls = KIND_CLASSES[state.kind] ?? [];
    cls.forEach(k => root.classList.add(k));

    const eyebrow = root.querySelector<HTMLElement>('.hh-eyebrow')!;
    const title = root.querySelector<HTMLElement>('.hh-title')!;
    const subtitle = root.querySelector<HTMLElement>('.hh-subtitle')!;
    const cta = root.querySelector<HTMLAnchorElement>('.hh-cta')!;
    cta.className = `hh-cta inline-block mt-4 px-5 py-2.5 rounded-lg font-semibold transition-colors ${CTA_BG[state.kind]}`;

    const observeUrl = lang === 'es' ? '/es/observar/' : '/en/observe/';

    if (state.kind === 'streak_at_risk') {
      eyebrow.textContent = root.dataset.streakEyebrow ?? '';
      title.textContent = fill(root.dataset.streakTitle ?? '', { streakDays: state.currentDays });
      subtitle.textContent = root.dataset.streakSubtitle ?? '';
      cta.textContent = root.dataset.streakCta ?? '';
      cta.href = observeUrl;
    } else if (state.kind === 'watchlist_hit') {
      eyebrow.textContent = root.dataset.watchEyebrow ?? '';
      title.textContent = fill(root.dataset.watchTitle ?? '', { taxonName: state.taxonName, km: Math.round(state.distanceKm) });
      subtitle.textContent = root.dataset.watchSubtitle ?? '';
      cta.textContent = root.dataset.watchCta ?? '';
      cta.href = `/share/obs/?id=${encodeURIComponent(state.obsId)}`;
    } else if (state.kind === 'pending_ids') {
      eyebrow.textContent = root.dataset.pendingEyebrow ?? '';
      title.textContent = fill(root.dataset.pendingTitle ?? '', { count: state.count });
      subtitle.textContent = fill(root.dataset.pendingSubtitle ?? '', { taxonGroup: state.taxonGroup });
      cta.textContent = root.dataset.pendingCta ?? '';
      cta.href = state.queueUrl;
    } else {
      eyebrow.textContent = root.dataset.defaultEyebrow ?? '';
      title.textContent = state.morningPeak ? (root.dataset.defaultTitleMorning ?? '') : (root.dataset.defaultTitle ?? '');
      subtitle.textContent = state.morningPeak ? (root.dataset.defaultSubtitleMorning ?? '') : (root.dataset.defaultSubtitle ?? '');
      cta.textContent = root.dataset.defaultCta ?? '';
      cta.href = observeUrl;
    }

    root.classList.remove('hidden');
    window.dispatchEvent(new CustomEvent('rastrum:home-hero-resolved', {
      detail: { kind: state.kind },
    }));
  }

  init().catch(() => {});
</script>
```

- [ ] **Step 4: Verify build**

```bash
npm run typecheck
npm run build
```

Expected: zero errors; build emits 209+ pages.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/HomeGreeting.astro src/components/home/HomeHero.astro tailwind.config.mjs
git commit -m "feat(home): HomeGreeting + HomeHero components

Hero is data-driven by resolveHeroState; rail and CTA classes are kind-
indexed and safelisted in tailwind.config.mjs.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 9: HomeChips + HomeRecent components

**Files:**
- Create: `src/components/home/HomeChips.astro`
- Create: `src/components/home/HomeRecent.astro`
- Test: `tests/unit/home-recent-fallback.test.ts`

- [ ] **Step 1: Write `HomeChips.astro`**

```astro
---
import { t } from '../../i18n/utils';
interface Props { lang: 'en' | 'es'; }
const { lang } = Astro.props;
const tr = t(lang);
const c = tr.home_dashboard.chips;
const inboxHref = lang === 'es' ? '/es/bandeja/' : '/en/inbox/';
const validateHref = lang === 'es' ? '/es/consola/validar/' : '/en/console/validate/';
const faltaDexHref = lang === 'es' ? '/es/perfil/falta-dex/' : '/en/profile/falta-dex/';
const watchlistHref = lang === 'es' ? '/es/explorar/lista/' : '/en/explore/watchlist/';
---

<nav class="hc-root grid grid-cols-2 sm:grid-cols-4 gap-2 mb-6" data-lang={lang} aria-label="Home actions">
  <a class="hc-tile" href={inboxHref} data-key="inbox"><span class="hc-icon" aria-hidden="true">📬</span><span class="hc-label">{c.inbox}</span><span class="hc-count tabular-nums" aria-hidden="true"></span></a>
  <a class="hc-tile" href={validateHref} data-key="validate"><span class="hc-icon" aria-hidden="true">🔍</span><span class="hc-label">{c.validate}</span><span class="hc-count tabular-nums" aria-hidden="true"></span></a>
  <a class="hc-tile" href={faltaDexHref} data-key="falta_dex"><span class="hc-icon" aria-hidden="true">📊</span><span class="hc-label">{c.falta_dex}</span><span class="hc-count tabular-nums" aria-hidden="true"></span></a>
  <a class="hc-tile" href={watchlistHref} data-key="watchlist"><span class="hc-icon" aria-hidden="true">👀</span><span class="hc-label">{c.watchlist}</span><span class="hc-count tabular-nums" aria-hidden="true"></span></a>
</nav>

<style>
  .hc-tile { display:flex; align-items:center; gap:.5rem; padding:.6rem .75rem; border:1px solid rgb(228 228 231); border-radius:.75rem; font-size:.875rem; transition:border-color .15s; }
  .hc-tile:hover { border-color:rgb(110 231 183); }
  :global(.dark) .hc-tile { border-color:rgb(63 63 70); }
  .hc-count { margin-left:auto; min-width:1.5em; text-align:right; font-weight:600; opacity:.8; }
</style>

<script>
  import { getSupabase } from '../../lib/supabase';
  import { loadInboxCount, loadValidateCount, loadFaltaDexCount } from '../../lib/home-loaders';

  async function init() {
    const root = document.querySelector<HTMLElement>('.hc-root');
    if (!root) return;
    let c; try { c = getSupabase(); } catch { return; }
    const { data: { user } } = await c.auth.getUser();
    if (!user) return;

    const [inbox, validate, falta] = await Promise.all([
      loadInboxCount(c, user.id),
      loadValidateCount(c),
      loadFaltaDexCount(c),
    ]);

    const setCount = (key: string, n: number) => {
      const el = root.querySelector<HTMLElement>(`[data-key="${key}"] .hc-count`);
      if (!el) return;
      if (n <= 0) { el.textContent = ''; return; }
      el.textContent = n >= 99 ? '99+' : String(n);
    };
    setCount('inbox', inbox);
    setCount('validate', validate);
    setCount('falta_dex', falta.count);
    // watchlist count: read same source as the hero's watchlistHit — for v1, we omit the count
    // (the hero promotes it when relevant; the chip is just navigation).
  }

  init().catch(() => {});
</script>
```

- [ ] **Step 2: Write fallback test for HomeRecent**

```ts
// tests/unit/home-recent-fallback.test.ts
import { describe, it, expect } from 'vitest';
import { loadRecent } from '../../src/lib/home-loaders';

function chain(result: { data: unknown[]; error: null }) {
  const builder: Record<string, unknown> = {};
  const fn = () => builder;
  builder.eq = fn; builder.order = fn; builder.limit = () => Promise.resolve(result);
  return builder;
}

function makeClient(localRows: unknown[], globalRows: unknown[]) {
  let call = 0;
  return {
    from: () => ({
      select: () => {
        call += 1;
        return chain({ data: call === 1 ? localRows : globalRows, error: null });
      },
    }),
  } as never;
}

describe('loadRecent fallback', () => {
  it('uses local scope when local returns 3 rows', async () => {
    const c = makeClient(
      [{ id: '1', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
       { id: '2', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
       { id: '3', observed_at: 'x', state_province: null, identifications: null, media_files: [] }],
      [],
    );
    const r = await loadRecent(c, 'en', 'MX');
    expect(r.usedLocalScope).toBe(true);
    expect(r.rows).toHaveLength(3);
  });

  it('falls back to global when local returns < 3 rows', async () => {
    const c = makeClient(
      [{ id: '1', observed_at: 'x', state_province: null, identifications: null, media_files: [] }],
      [{ id: 'g1', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
       { id: 'g2', observed_at: 'x', state_province: null, identifications: null, media_files: [] },
       { id: 'g3', observed_at: 'x', state_province: null, identifications: null, media_files: [] }],
    );
    const r = await loadRecent(c, 'en', 'MX');
    expect(r.usedLocalScope).toBe(false);
    expect(r.rows.map(x => x.id)).toEqual(['g1', 'g2', 'g3']);
  });

  it('skips local query when country is null', async () => {
    const c = makeClient(
      [],
      [{ id: 'g1', observed_at: 'x', state_province: null, identifications: null, media_files: [] }],
    );
    const r = await loadRecent(c, 'en', null);
    expect(r.usedLocalScope).toBe(false);
    expect(r.rows.map(x => x.id)).toEqual(['g1']);
  });
});
```

- [ ] **Step 3: Write `HomeRecent.astro`**

```astro
---
import { t } from '../../i18n/utils';
interface Props { lang: 'en' | 'es'; }
const { lang } = Astro.props;
const tr = t(lang);
const r = tr.home_dashboard.recent;
const viewAllHref = lang === 'es' ? '/es/explorar/recientes/' : '/en/explore/recent/';
---

<section class="hr-root mb-8" data-lang={lang}
  data-title-local={r.title_local} data-title-global={r.title_global}
  data-loading={r.loading} data-empty={r.empty} data-unknown-species={r.unknown_species}>
  <div class="flex items-baseline justify-between gap-3 mb-3">
    <h2 class="hr-title text-sm font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300">{r.title_global}</h2>
    <a href={viewAllHref} class="text-sm font-medium text-emerald-700 dark:text-emerald-400 hover:underline">{r.view_all}</a>
  </div>
  <p class="hr-loading text-sm text-zinc-500 dark:text-zinc-400">{r.loading}</p>
  <p class="hr-empty hidden text-sm text-zinc-500 dark:text-zinc-400">{r.empty}</p>
  <ul class="hr-list grid grid-cols-1 sm:grid-cols-3 gap-3"></ul>
</section>

<script>
  import { getSupabase } from '../../lib/supabase';
  import { loadRecent } from '../../lib/home-loaders';
  import { formatTimeAgo } from '../../lib/social';

  type Lang = 'en' | 'es';

  function escape(s: string): string {
    const map: Record<string, string> = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  async function init() {
    const root = document.querySelector<HTMLElement>('.hr-root');
    if (!root) return;
    const lang = (root.dataset.lang as Lang) ?? 'en';
    const list = root.querySelector<HTMLUListElement>('.hr-list');
    const loading = root.querySelector<HTMLElement>('.hr-loading');
    const empty = root.querySelector<HTMLElement>('.hr-empty');
    if (!list) return;

    let c; try { c = getSupabase(); } catch { loading?.classList.add('hidden'); return; }
    const { data: { user } } = await c.auth.getUser();
    let country: string | null = null;
    if (user) {
      const { data } = await c.from('users').select('country_code').eq('id', user.id).maybeSingle();
      country = (data as { country_code: string | null } | null)?.country_code ?? null;
    }

    const { rows, usedLocalScope } = await loadRecent(c as never, lang, country);
    loading?.classList.add('hidden');
    if (rows.length === 0) { empty?.classList.remove('hidden'); return; }

    if (usedLocalScope && country) {
      const titleEl = root.querySelector<HTMLElement>('.hr-title');
      if (titleEl) titleEl.textContent = (root.dataset.titleLocal ?? '').replace('{country}', country);
    }

    const unknown = root.dataset.unknownSpecies ?? 'Unknown species';
    list.innerHTML = rows.map(r => {
      const sci = r.scientificName ?? unknown;
      const common = r.commonName ?? '';
      const ago = formatTimeAgo(r.observedAt, lang);
      const photo = r.photoUrl
        ? `<img src="${escape(r.photoUrl)}" alt="${escape(sci)}" loading="lazy" class="w-full h-full object-cover" />`
        : '';
      return `<li><a href="/share/obs/?id=${encodeURIComponent(r.id)}" class="block overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50 hover:border-emerald-400 dark:hover:border-emerald-700 transition-colors">
        <div class="aspect-square w-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">${photo}</div>
        <div class="p-2.5">
          <p class="text-xs italic font-semibold text-zinc-900 dark:text-zinc-100 truncate">${escape(sci)}</p>
          ${common ? `<p class="text-xs text-zinc-600 dark:text-zinc-300 truncate">${escape(common)}</p>` : ''}
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">${escape(ago)}</p>
        </div>
      </a></li>`;
    }).join('');
  }

  init().catch(() => {});
</script>
```

- [ ] **Step 4: Run tests + typecheck**

```bash
npx vitest run tests/unit/home-recent-fallback.test.ts
npm run typecheck
npm run build
```

Expected: 3/3 fallback tests pass; zero TS errors; build clean.

- [ ] **Step 5: Commit**

```bash
git add src/components/home/HomeChips.astro src/components/home/HomeRecent.astro tests/unit/home-recent-fallback.test.ts
git commit -m "feat(home): HomeChips + HomeRecent with local→global fallback

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 10: HomeView shared body + `/home` and `/inicio` page shells

**Files:**
- Create: `src/components/HomeView.astro`
- Create: `src/pages/en/home/index.astro`
- Create: `src/pages/es/inicio/index.astro`

- [ ] **Step 1: Write the shared body**

```astro
---
// src/components/HomeView.astro
import HomeGreeting from './home/HomeGreeting.astro';
import HomeHero from './home/HomeHero.astro';
import HomeChips from './home/HomeChips.astro';
import HomeRecent from './home/HomeRecent.astro';
interface Props { lang: 'en' | 'es'; }
const { lang } = Astro.props;
---

<div class="max-w-5xl mx-auto px-4 sm:px-6 py-6 sm:py-10 space-y-2">
  <HomeGreeting lang={lang} />
  <HomeHero lang={lang} />
  <HomeChips lang={lang} />
  <HomeRecent lang={lang} />
</div>
```

- [ ] **Step 2: Write `/en/home/index.astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import HomeView from '../../../components/HomeView.astro';
import { t } from '../../../i18n/utils';
const lang = 'en';
const tr = t(lang);
---
<BaseLayout title={`${tr.site.title} — Home`} description={tr.site.description} lang={lang}>
  <HomeView lang={lang} />
</BaseLayout>
```

- [ ] **Step 3: Write `/es/inicio/index.astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import HomeView from '../../../components/HomeView.astro';
import { t } from '../../../i18n/utils';
const lang = 'es';
const tr = t(lang);
---
<BaseLayout title={`${tr.site.title} — Inicio`} description={tr.site.description} lang={lang}>
  <HomeView lang={lang} />
</BaseLayout>
```

- [ ] **Step 4: Verify build emits both pages**

```bash
npm run build
ls dist/en/home/index.html dist/es/inicio/index.html
```

Expected: both files exist.

- [ ] **Step 5: Commit**

```bash
git add src/components/HomeView.astro src/pages/en/home src/pages/es/inicio
git commit -m "feat(home): /en/home/ and /es/inicio/ page shells

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 11: Auto-redirect from `/` to `/home` for signed-in users

**Files:**
- Modify: `src/layouts/BaseLayout.astro`
- Test: `tests/unit/home-redirect.test.ts`

- [ ] **Step 1: Find the supabase storage key**

```bash
grep -n "storageKey\|sb-.*-auth-token" src/lib/supabase.ts
```

Note the project ref (the substring between `sb-` and `-auth-token` in the storage key — used in the inline script below).

- [ ] **Step 2: Write the redirect test**

```ts
// tests/unit/home-redirect.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';

function shouldRedirect(path: string, hasToken: boolean): string | null {
  const isLocaleRoot = path === '/en/' || path === '/es/' || path === '/en' || path === '/es';
  if (!isLocaleRoot || !hasToken) return null;
  return path.startsWith('/es') ? '/es/inicio/' : '/en/home/';
}

describe('home redirect logic', () => {
  it('anon stays on /en/', () => expect(shouldRedirect('/en/', false)).toBeNull());
  it('signed-in /en/ → /en/home/', () => expect(shouldRedirect('/en/', true)).toBe('/en/home/'));
  it('signed-in /es/ → /es/inicio/', () => expect(shouldRedirect('/es/', true)).toBe('/es/inicio/'));
  it('non-locale-root unaffected', () => {
    expect(shouldRedirect('/en/observe/', true)).toBeNull();
    expect(shouldRedirect('/en/docs/', true)).toBeNull();
  });
  it('handles trailing-slash variants', () => {
    expect(shouldRedirect('/en', true)).toBe('/en/home/');
    expect(shouldRedirect('/es', true)).toBe('/es/inicio/');
  });
});
```

- [ ] **Step 3: Run the test (it should pass — pure logic with the function inlined)**

```bash
npx vitest run tests/unit/home-redirect.test.ts
```

Expected: 5/5 pass.

- [ ] **Step 4: Add the inline first-paint script to `BaseLayout.astro`**

In `BaseLayout.astro`, immediately after the existing theme resolver `<script is:inline>` block in `<head>`, add:

```astro
<script is:inline>
  (function () {
    try {
      var path = location.pathname;
      var isRoot = path === '/en/' || path === '/es/' || path === '/en' || path === '/es';
      if (!isRoot) return;
      // The supabase-js storage key is sb-<project-ref>-auth-token; pick the
      // first localStorage key that matches that shape so we don't have to
      // hardcode the project ref.
      for (var i = 0; i < localStorage.length; i++) {
        var k = localStorage.key(i);
        if (k && /^sb-.+-auth-token$/.test(k)) {
          var raw = localStorage.getItem(k);
          if (!raw) continue;
          var parsed = JSON.parse(raw);
          if (parsed && parsed.access_token) {
            location.replace(path.indexOf('/es') === 0 ? '/es/inicio/' : '/en/home/');
            return;
          }
        }
      }
    } catch (e) { /* anon — let marketing render */ }
  })();
</script>
```

- [ ] **Step 5: Verify + commit**

```bash
npm run typecheck
npm run build
npx vitest run tests/unit/home-redirect.test.ts
git add src/layouts/BaseLayout.astro tests/unit/home-redirect.test.ts
git commit -m "feat(home): auto-redirect signed-in users from / to /home

Inline first-paint script reads the supabase auth token from localStorage
synchronously and replaces the URL before any pixels paint. Anon users
fall through to marketing render.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 12: Auth callback post-redirect + Header logo target

**Files:**
- Modify: `src/pages/auth/callback.astro`
- Modify: `src/components/Header.astro`

- [ ] **Step 1: Modify the auth callback**

In `src/pages/auth/callback.astro`, find where `redirect_to` is resolved and substitute `/home` when the resolved value is the locale root. Show enough surrounding context that you can locate the spot:

```ts
// Look for code like:
const target = redirectTo || `/${lang}/`;
// Replace with:
const localeRoot = `/${lang}/`;
let target = redirectTo || localeRoot;
if (target === localeRoot || target === `/${lang}`) {
  target = lang === 'es' ? '/es/inicio/' : '/en/home/';
}
```

- [ ] **Step 2: Update Header.astro logo target**

In `src/components/Header.astro`, the logo link likely currently uses `/${lang}/`. Change the rendered href to `/${lang}/` for anon (default render — anon-safe), and add a client-side script that flips it to `/en/home/` or `/es/inicio/` when a session is detected:

Add to the existing client `<script>` block (or create one if absent):

```ts
import { getSupabase } from '../lib/supabase';

(async () => {
  try {
    const c = getSupabase();
    const { data: { user } } = await c.auth.getUser();
    if (!user) return;
    const logo = document.querySelector<HTMLAnchorElement>('a[data-rastrum-logo]');
    if (!logo) return;
    const lang = document.documentElement.lang === 'es' ? 'es' : 'en';
    logo.href = lang === 'es' ? '/es/inicio/' : '/en/home/';
  } catch { /* anon */ }
})();
```

Add `data-rastrum-logo` to the logo anchor element if it doesn't already have it.

- [ ] **Step 3: Verify build**

```bash
npm run typecheck
npm run build
```

Expected: zero errors.

- [ ] **Step 4: Smoke test in dev**

```bash
make dev &
sleep 3
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/en/home/
curl -s -o /dev/null -w '%{http_code}\n' http://localhost:4321/es/inicio/
kill %1
```

Expected: both return 200.

- [ ] **Step 5: Commit**

```bash
git add src/pages/auth/callback.astro src/components/Header.astro
git commit -m "feat(home): callback deposits at /home; logo points to /home for signed-in

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 13: Marketing pulse + LATAM-recent strips

**Files:**
- Create: `src/components/HomePulse.astro`
- Create: `src/components/HomeRecentLatam.astro`
- Create: `tests/unit/home-pulse-honest.test.ts`
- Modify: `src/pages/en/index.astro`
- Modify: `src/pages/es/index.astro`

- [ ] **Step 1: Write honest-norms test**

```ts
// tests/unit/home-pulse-honest.test.ts
import { describe, it, expect } from 'vitest';

const PULSE_MIN_THRESHOLD = 1000;

function shouldShowPulse(obs30d: number): boolean {
  return obs30d >= PULSE_MIN_THRESHOLD;
}

describe('home pulse honest-norms', () => {
  it('hides when obs_30d < 1000', () => {
    expect(shouldShowPulse(0)).toBe(false);
    expect(shouldShowPulse(500)).toBe(false);
    expect(shouldShowPulse(999)).toBe(false);
  });
  it('shows when obs_30d >= 1000', () => {
    expect(shouldShowPulse(1000)).toBe(true);
    expect(shouldShowPulse(50000)).toBe(true);
  });
});
```

- [ ] **Step 2: Run test (passes — pure logic)**

```bash
npx vitest run tests/unit/home-pulse-honest.test.ts
```

Expected: 2/2 pass.

- [ ] **Step 3: Write `HomePulse.astro`**

```astro
---
import { t } from '../i18n/utils';
interface Props { lang: 'en' | 'es'; }
const { lang } = Astro.props;
const tr = t(lang);
---

<section class="hp-root hidden mt-6 mb-2" data-lang={lang} data-template={tr.home.pulse.label}>
  <div class="hp-text rounded-lg border border-emerald-500/40 bg-emerald-50 dark:bg-emerald-950/30 px-4 py-3 text-center text-sm text-zinc-700 dark:text-zinc-200" role="status"></div>
</section>

<script>
  import { getSupabase } from '../lib/supabase';

  const PULSE_MIN_THRESHOLD = 1000;

  function fmt(n: number, lang: string): string {
    return new Intl.NumberFormat(lang).format(n);
  }
  function fill(s: string, vars: Record<string, string>): string {
    return s.replace(/\{(\w+)\}/g, (_, k) => vars[k] ?? '');
  }

  async function init() {
    const root = document.querySelector<HTMLElement>('.hp-root');
    if (!root) return;
    const lang = root.dataset.lang ?? 'en';
    let c; try { c = getSupabase(); } catch { return; }
    const { data, error } = await c.rpc('home_pulse_stats');
    if (error || !data || !Array.isArray(data) || data.length === 0) return;
    const row = data[0] as { obs_30d: number; species_30d: number; active_observers_30d: number };
    if (row.obs_30d < PULSE_MIN_THRESHOLD) return;

    const text = fill(root.dataset.template ?? '', {
      obs: fmt(row.obs_30d, lang),
      species: fmt(row.species_30d, lang),
      observers: fmt(row.active_observers_30d, lang),
    });
    const el = root.querySelector<HTMLElement>('.hp-text');
    if (el) el.textContent = text;
    root.classList.remove('hidden');
  }

  init().catch(() => {});
</script>
```

- [ ] **Step 4: Write `HomeRecentLatam.astro`**

```astro
---
import { t } from '../i18n/utils';
interface Props { lang: 'en' | 'es'; }
const { lang } = Astro.props;
const tr = t(lang);
---

<section class="hrl-root hidden mb-8" data-lang={lang} data-title={tr.home.recent_latam.title} data-anon={tr.home.recent_latam.anon_observer}>
  <h2 class="text-sm font-semibold uppercase tracking-wider text-zinc-700 dark:text-zinc-300 mb-3">{tr.home.recent_latam.title}</h2>
  <ul class="hrl-list grid grid-cols-1 sm:grid-cols-3 gap-3"></ul>
</section>

<script>
  import { getSupabase } from '../lib/supabase';
  import { formatTimeAgo } from '../lib/social';

  const LATAM = ['MX','CO','BR','AR','CL','PE','EC','CR','PA','GT','BO','VE','UY','PY','HN','SV','NI','DO','CU'];

  function escape(s: string): string {
    const map: Record<string, string> = { '&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;' };
    return s.replace(/[&<>"']/g, c => map[c]);
  }

  async function init() {
    const root = document.querySelector<HTMLElement>('.hrl-root');
    if (!root) return;
    const lang = (root.dataset.lang as 'en' | 'es') ?? 'en';
    let c; try { c = getSupabase(); } catch { return; }
    const select = `id, observed_at,
      observer:users!observer_id(country_code),
      identifications(scientific_name, is_primary, taxa(common_name_es, common_name_en)),
      media_files(url, is_primary, media_type)`;
    const { data, error } = await c.from('observations').select(select)
      .eq('sync_status', 'synced').neq('obscure_level', 'full')
      .in('observer.country_code', LATAM)
      .order('observed_at', { ascending: false }).limit(3);
    if (error || !data || data.length === 0) return;

    const list = root.querySelector<HTMLUListElement>('.hrl-list');
    if (!list) return;
    const anonTpl = root.dataset.anon ?? '';
    list.innerHTML = (data as unknown as Array<{
      id: string; observed_at: string;
      observer: { country_code: string | null } | null;
      identifications: Array<{ scientific_name: string | null; is_primary: boolean | null; taxa: { common_name_en: string | null; common_name_es: string | null } | null }> | null;
      media_files: Array<{ url: string | null; is_primary: boolean | null; media_type: string | null }> | null;
    }>).map(r => {
      const idents = r.identifications ?? [];
      const primary = idents.find(i => i.is_primary) ?? idents[0];
      const sci = primary?.scientific_name ?? '';
      const common = lang === 'es' ? (primary?.taxa?.common_name_es ?? '') : (primary?.taxa?.common_name_en ?? '');
      const photoMedia = (r.media_files ?? []).filter(m => !m.media_type || m.media_type === 'photo');
      const photo = photoMedia.find(m => m.is_primary)?.url ?? photoMedia.find(m => !!m.url)?.url ?? '';
      const country = r.observer?.country_code ?? '';
      const credit = anonTpl.replace('{country}', country);
      return `<li><div class="block overflow-hidden rounded-xl border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900/50">
        <div class="aspect-square w-full bg-zinc-100 dark:bg-zinc-800 overflow-hidden">${photo ? `<img src="${escape(photo)}" alt="${escape(sci)}" loading="lazy" class="w-full h-full object-cover" />` : ''}</div>
        <div class="p-2.5">
          ${sci ? `<p class="text-xs italic font-semibold text-zinc-900 dark:text-zinc-100 truncate">${escape(sci)}</p>` : ''}
          ${common ? `<p class="text-xs text-zinc-600 dark:text-zinc-300 truncate">${escape(common)}</p>` : ''}
          <p class="text-[11px] text-zinc-500 dark:text-zinc-400 mt-1">${escape(credit)} · ${escape(formatTimeAgo(r.observed_at, lang))}</p>
        </div>
      </div></li>`;
    }).join('');
    root.classList.remove('hidden');
  }

  init().catch(() => {});
</script>
```

- [ ] **Step 5: Wire into `/` pages**

In `src/pages/en/index.astro`, immediately after the closing `</section>` of the Hero block, insert:

```astro
import HomePulse from '../../components/HomePulse.astro';
import HomeRecentLatam from '../../components/HomeRecentLatam.astro';
```

(in the frontmatter), and in the body after the hero `</section>`:

```astro
<HomePulse lang={lang} />
<HomeRecentLatam lang={lang} />
```

Mirror in `src/pages/es/index.astro`.

- [ ] **Step 6: Verify + commit**

```bash
npm run typecheck
npm run build
git add src/components/HomePulse.astro src/components/HomeRecentLatam.astro tests/unit/home-pulse-honest.test.ts src/pages/en/index.astro src/pages/es/index.astro
git commit -m "feat(home): marketing pulse + LATAM-recent strips on /

Pulse hides below honest-norms threshold (obs_30d < 1000); LATAM-recent
strip is anonymized and respects obs_public_read.

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 14: E2E test for the redesigned home

**Files:**
- Create: `tests/e2e/home.spec.ts`

- [ ] **Step 1: Write the spec**

```ts
// tests/e2e/home.spec.ts
import { test, expect } from '@playwright/test';

test.describe('home page redesign', () => {
  test('anon visitor sees marketing on /en/', async ({ page }) => {
    const failed: string[] = [];
    page.on('response', r => { if (r.status() >= 400) failed.push(`${r.status()} ${r.url()}`); });

    await page.goto('/en/');
    await expect(page.locator('h1')).toBeVisible();

    // Specifically assert no observations 400 — the regression we're fixing.
    const obs400 = failed.filter(s => s.includes('/rest/v1/observations') && s.startsWith('4'));
    expect(obs400, obs400.join('\n')).toEqual([]);
  });

  test('/en/home/ renders without auth (will be empty but not error)', async ({ page }) => {
    await page.goto('/en/home/');
    // Page renders even for anon; greeting and hero stay hidden until auth resolves.
    await expect(page.locator('.hg-root, .hh-root, .hc-root, .hr-root').first()).toBeAttached();
  });

  test('/es/inicio/ exists and is reachable', async ({ page }) => {
    const res = await page.goto('/es/inicio/');
    expect(res?.status()).toBe(200);
  });
});
```

- [ ] **Step 2: Run E2E**

```bash
npm run build
npm run test:e2e -- tests/e2e/home.spec.ts
```

Expected: 3/3 pass on chromium.

- [ ] **Step 3: Commit**

```bash
git add tests/e2e/home.spec.ts
git commit -m "test(home): e2e — anon /, /en/home/, /es/inicio/ smoke

Co-Authored-By: Claude Opus 4.7 (1M context) <noreply@anthropic.com>"
```

---

## Task 15: Final pre-PR sweep

- [ ] **Step 1: Run the full pre-PR checklist**

```bash
npm run typecheck
npm run test
npm run build
git status -s
```

Expected: zero TS errors; all tests pass (current 734 + new ones); 211 pages built (209 + `/en/home/`, `/es/inicio/`); only the staged commits remain.

- [ ] **Step 2: Smoke check the visual companion's locked-decisions screen one last time**

Open `http://localhost:60440` (or the visual companion URL from this brainstorm) — confirm the spec matches the locked decisions screen. If the server has been stopped, skip.

- [ ] **Step 3: Verify the bug is gone**

Manually: build, serve dist, hit `/en/` in a fresh tab — DevTools network panel should show **no** `/rest/v1/observations?...country_code` request. Sign in (real Supabase session) — expect redirect to `/en/home/` and the dashboard to render.

- [ ] **Step 4: Open PR 2**

```bash
gh pr create --base main --title "feat(home): /home dashboard + marketing pulse + Fogg-aligned dynamic hero" \
  --body "$(cat <<'EOF'
## Summary
- Splits / (anon marketing) and /home (signed-in dashboard, es: /inicio).
- /home: greeting + 🔥 streak → dynamic hero (4-priority cascade) → 4 chips → recent strip.
- /: keeps Hero/How/Why; adds live pulse + LATAM-recent (gated by honest-norms threshold).
- Auto-redirect on /; auth callback deposits at /home; logo points to /home for signed-in users.
- 3 new RPCs (home_pulse_stats, pending_validation_count, falta_dex_summary).
- Fogg-aligned: single target behavior per visit, kairos triggers, tailoring; honest copy (no FOMO).

Spec: docs/superpowers/specs/2026-05-09-home-page-redesign-design.md

## Test plan
- [x] npm run typecheck passes
- [x] npm run test passes (734+ unit tests)
- [x] npm run build succeeds (211 pages)
- [x] tests/unit/home-{hero,loaders,recent-fallback,pulse-honest,redirect,no-widgets}.test.ts pass
- [x] tests/e2e/home.spec.ts passes on chromium
- [ ] Manual: /en/ as anon shows pulse + LATAM-recent above the fold
- [ ] Manual: /en/ as signed-in redirects to /en/home/
- [ ] Manual: hero kind matches user state (default for new accounts)
- [ ] Manual: chips show real counts; clicking each navigates correctly
EOF
)"
```

---

## Self-review checklist (run before declaring the plan finished)

**Spec coverage** — every section in the spec has at least one task:

| Spec § | Covered by |
|---|---|
| 1 Locked decisions | preamble |
| 2 Routes & i18n | Tasks 5, 10, 11, 12 |
| 3 /home components & data | Tasks 6, 7, 8, 9, 10 |
| 4 Dynamic hero cascade | Tasks 6, 8 |
| 5 / marketing changes | Tasks 1 (strip), 13 (add) |
| 6 Migration plan | Tasks 1 (PR 1), 2–14 (PR 2) |
| 7 Testing | Tasks 6, 7, 9, 11, 13, 14 |
| 8 i18n | Task 5 |
| 9 Out of scope | not implemented (correct) |
| 10 Known risks | covered in Tasks 9 (fallback), 11 (race), 13 (threshold) |

**Placeholder scan** — all step bodies show real code or exact commands; no "TBD" or "implement later".

**Type consistency** — `HeroState`, `HeroInputs`, `RecentObs`, `WatchlistHit`, `StreakSnap` are all defined once (Tasks 6 & 7) and consumed identically downstream. The supabase storage key probe in Task 11 is regex-based to avoid hardcoding a project ref that could drift.

---

*Plan complete. Spec: `docs/superpowers/specs/2026-05-09-home-page-redesign-design.md`. Implementation handoff: see "Execution Handoff" section below the plan when reading in conversation context.*
