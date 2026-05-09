# Home page redesign — `/home` (signed-in) + `/` (marketing)

**Status:** design · 2026-05-09
**Owner:** Artemio
**Triggers:**
- Production bug: `/` issues a `GET /rest/v1/observations?select=…,country_code,…` that 400s because `country_code` lives on `users`, not `observations` (PR #704/#844 regression).
- Strategic: a single `/` route is trying to serve two audiences (anonymous evaluators and signed-in observers) and doing both jobs poorly.

**Outcome:** split the route, fix the 400, build a Fogg-aligned dashboard for signed-in users, and add light social-proof to marketing for anon visitors.

---

## 1. Locked decisions (recap)

| # | Decision | Rationale |
|---|---|---|
| 1 | **Split routes** — `/` stays anon-only marketing; `/home` is the signed-in dashboard | Each page does one job; avoids the "every visitor downloads dashboard logic" tax |
| 2 | **Auto-redirect** — signed-in users hitting `/` bounce to `/home` via first-paint script | Fogg one-target-per-audience principle; transparent if read is synchronous |
| 3 | **Post-sign-in callback deposits at `/home`** — when the original return target is the locale root | Continuity from sign-in completion |
| 4 | **`/home` flavor: dynamic-hero hybrid** — single CTA whose label/target resolves at load time from a 4-priority cascade | Fogg's *single target behavior* + *kairos* + *tailoring* in one surface |
| 5 | **Marketing `/` scope: minimal + live pulse** — strip `HomeWidgets`, add live counter strip + 3-card LATAM-recent peek | High-leverage middle option; respects v1.1.5 honest-norms invariant |

---

## 2. Routes & i18n

| EN | ES | Audience | Behavior |
|---|---|---|---|
| `/en/` | `/es/` | anon | marketing renders |
| `/en/` | `/es/` | signed-in | first-paint script redirects to `/en/home/` or `/es/inicio/` |
| `/en/home/` | `/es/inicio/` | signed-in | dashboard renders |
| `/en/home/` | `/es/inicio/` | anon | redirect to sign-in (`/en/sign-in?redirect_to=/en/home/`) |

`/inicio` follows the existing translated-slug convention in `src/i18n/utils.ts` (cf. `/observe` → `/observar`, `/explore` → `/explorar`). Add `routes.home = { en: '/home', es: '/inicio' }`.

**Auto-redirect implementation** (in `BaseLayout.astro` first-paint script — same pattern as the theme resolver):
```js
const path = location.pathname;
const isLocaleRoot = path === '/en/' || path === '/es/' || path === '/en' || path === '/es';
if (isLocaleRoot) {
  try {
    const raw = localStorage.getItem('sb-<project-ref>-auth-token');
    if (raw && JSON.parse(raw)?.access_token) {
      const target = path.startsWith('/es') ? '/es/inicio/' : '/en/home/';
      location.replace(target);
    }
  } catch { /* anon — let marketing render */ }
}
```
Synchronous read avoids a flash of marketing. Errors silently fall through to the marketing render.

**Header logo target** (`Header.astro`): `/en/` for anon, `/en/home/` for signed-in. Locale-aware. Resolution happens client-side after auth state is known; default render is the locale root (anon-safe), client script swaps the `href` if a session exists.

**Post-sign-in callback** (`src/pages/auth/callback.astro`): if the resolved `redirect_to` is the locale root, substitute the home route. Other targets (e.g. magic link from `/observe`) are preserved.

---

## 3. `/home` — components & data

### File layout

```
src/pages/en/home/index.astro       — page shell (lang='en')
src/pages/es/inicio/index.astro     — page shell (lang='es')
src/components/HomeView.astro       — shared body (per the EN/ES parity rule)
src/components/home/
  ├── HomeGreeting.astro            — "Buenos días, X" + 🔥 streak pill
  ├── HomeHero.astro                — dynamic hero (§4)
  ├── HomeChips.astro               — Inbox / Validate / Falta-dex / Watchlist
  └── HomeRecent.astro              — 3-card recent-nearby strip
src/lib/home-loaders.ts             — async data loaders (one per chip)
src/lib/home-hero.ts                — pure hero-state resolver (§4)
```

The four child components are pure renderers; data fetching lives in `src/lib/home-loaders.ts` and is invoked from `HomeView.astro`'s `<script>` block via `Promise.all` for parallelism.

### Data contracts

| Component | Source | Query / RPC | Auth |
|---|---|---|---|
| Greeting + streak | `users`, `user_streaks` | self-row, `current_days` | RLS self-read |
| Hero state | composed (§4) | `loadHeroState(userId, lang, now)` | RLS self-read |
| Inbox count | `notifications` | `select count(*) where user_id = auth.uid() and read_at is null` | RLS self-read |
| Validate count | RPC `pending_validation_count()` | sum across user's expert taxa, capped at 99+ | SECURITY INVOKER, scoped via `has_role('expert')` |
| Falta-dex count | RPC `falta_dex_summary()` | returns `{ gap_count, region }` | self only |
| Watchlist | `watchlist_alerts` | unread alert count + most-recent obs | RLS self-read |
| Recent nearby | `observations` join `users!observer_id(country_code)` | embedded-resource filter (below) | `obs_public_read` |

### Recent-nearby query (also fixes the 400)

```ts
const country = profile?.country_code ?? null;

let query = supabase.from('observations').select(`
  id, observed_at, state_province,
  observer:users!observer_id(country_code),
  identifications(scientific_name, is_primary, is_research_grade, confidence,
                  taxa(common_name_es, common_name_en)),
  media_files(url, is_primary, media_type)
`)
.eq('sync_status', 'synced')
.order('observed_at', { ascending: false })
.limit(3);

if (country) query = query.eq('observer.country_code', country);
```

Fallback chain:
1. If `country` present and result `.length === 3` → render local (title: "Recent in MX").
2. If `country` present and result `.length < 3` → refetch global (title: "Recent observations").
3. If `country` null → fetch global directly.

PostgREST embedded-resource filtering (`.eq('observer.country_code', country)`) is supported since v10; verified working against the project's PostgREST version.

### States

- **Loading**: each chip + the recent strip render skeleton on first paint, real data on resolve.
- **Empty**: chips with `count === 0` collapse to a muted "no items" state but stay visible (so the layout doesn't reflow). Recent strip hides entirely if zero results after fallback.
- **Error**: each query is independently swallowed — a chip that errors silently hides; hero defaults to `observe_default`. The page never blocks render on a failed query.

### Mobile reflow

| Breakpoint | Greeting | Hero | Chips | Recent |
|---|---|---|---|---|
| `< sm` (< 640px) | streak wraps below | full width | horizontal scroll row | 1 col |
| `sm`–`lg` | inline | full width | 2×2 grid | 3 col |
| `≥ lg` | inline | full width | 4×1 row | 3 col |

### Performance budget

- 4 chip queries + 1 hero compose + 1 recent query = 6 round-trips, parallelized → expected ≈ one P95 RTT (~250ms on 4G).
- Skeleton paint < 100ms (no JS for skeleton).
- Total bundle delta from new components: < 5 KB gzipped (mostly i18n strings).

---

## 4. Dynamic hero · priority cascade

### Resolver (`src/lib/home-hero.ts`)

Pure function; no I/O of its own — accepts pre-loaded inputs and returns a `HeroState` discriminated union.

```ts
type HeroState =
  | { kind: 'streak_at_risk', currentDays: number, hoursLeftLocal: number }
  | { kind: 'watchlist_hit', taxonName: string, distanceKm: number, obsId: string, observedAt: string }
  | { kind: 'pending_ids', count: number, taxonGroup: string, queueUrl: string }
  | { kind: 'observe_default', morningPeak: boolean };

interface HeroInputs {
  streak: { currentDays: number; lastObsLocalDay: string | null } | null;
  watchlistHit: { taxonName: string; distanceKm: number; obsId: string; observedAt: string } | null;
  pendingIdsCount: number;
  expertTaxonGroup: string | null;
  now: Date;
  userTimezone: string;
}

export function resolveHeroState(inputs: HeroInputs, lang: 'en' | 'es'): HeroState;
```

### Cascade (first match wins)

1. **`streak_at_risk`** —
   - `streak.currentDays >= 1` AND
   - `streak.lastObsLocalDay !== today (in user's timezone, fall back to UTC)` AND
   - local hour `≥ 18`
   - **Why the 18:00 gate:** loss-framing only triggers in the evening so it doesn't shout at users who haven't had time yet. Threshold `≥ 1` ensures we never invent a streak.

2. **`watchlist_hit`** —
   - any `watchlist_alerts` row in the last 24h AND
   - observation within 50 km of `users.centroid_geog` AND
   - `acknowledged_at IS NULL`
   - Pick closest if multiple. Skipped silently if `centroid_geog` is null (M28 opt-in).

3. **`pending_ids`** —
   - `pending_validation_count() ≥ 3` for taxa where the user `has_role('expert')`.
   - Threshold `≥ 3` keeps the trigger meaningful (1–2 is too noisy).

4. **`observe_default`** —
   - Always falls through. `morningPeak = true` if local hour 5–9 (changes copy: "It's peak bird activity" / "es la hora de máxima actividad").

### Fallback chain

If any input loader errors, that rule is skipped and the cascade continues. If all error, `observe_default` always renders. The hero never blanks.

### Copy

`src/i18n/{en,es}.json` → `home.hero.<kind>.{title, subtitle, cta}`. Subtitles take template params: `{count}`, `{km}`, `{hoursLeft}`, `{streakDays}`, `{taxonName}`.

**Honest-framing rules** (per v1.1.5 persuasive-tech invariants):
- "Streak at risk" must read factually: "You haven't logged today. One observation by midnight keeps your N-day streak." Not "Hurry!" / "Don't lose it!"
- No fabricated counts. If a value is uncertain, the whole rule skips rather than rounding up.
- No countdown timers (engagement-bait pattern).

### Visual

Each kind has a distinct rail color (already-locked v1.1.5 accent-rail pattern):
- `streak_at_risk`: red rail + amber accent
- `watchlist_hit`: blue rail
- `pending_ids`: purple rail
- `observe_default`: emerald (brand)

All four use one component shell (`HomeHero.astro`) with a `kind`-driven Tailwind class set. Classes are **safelisted in `tailwind.config.mjs`** (matches the existing `railClass()` pattern in `Header.astro` — required because the class names are computed dynamically).

### Analytics

Emits `rastrum:home-hero-resolved` DOM event with `{ kind, fallback_path: string[] }`. No-op stub by default — operators attach a listener in `BaseLayout.astro` if they want to count cascade firings.

---

## 5. `/` marketing changes

### Removed

- `<HomeWidgets />` from `src/pages/{en,es}/index.astro`.
- `src/components/HomeWidgets.astro` itself stays in the tree for one release, then gets deleted in a follow-up cleanup PR. The dashboard's greeting + streak + recent code is a partial fork — patterns translate, but the file is not 1:1 reusable.

### Added · live pulse strip (`src/components/HomePulse.astro`)

```
📍 12,847 observations · 1,392 species · 184 active observers · last 30 days
```

- Backed by RPC `home_pulse_stats()` returning `{ obs_30d, species_30d, active_observers_30d }`.
- **Honest-norms gate**: hide the entire strip if `obs_30d < 1000`. (Threshold lives in `src/lib/honest-norms.ts` next to `MIN_N_THRESHOLD`.) Below the threshold the marketing page just doesn't have this section — same v1.1.5 rule as peer-norms.
- Edge Function caches the result for 5 minutes (`Cache-Control: max-age=300`) — no per-pageview DB load.
- Copy in `i18n/{en,es}.json` → `home.pulse.*`.

### Added · recent in LATAM (`src/components/HomeRecentLatam.astro`)

- 3 cards, same shape as the dashboard's recent strip, but anonymized: hides observer name (shows e.g. "an observer in MX"), uses `obs_public_read`-respecting query (sensitive species already coarsened by RLS).
- Query:
  ```sql
  observations
  WHERE sync_status = 'synced'
    AND obscure_level != 'full'
    AND observer.country_code IN ('MX','CO','BR','AR','CL','PE','EC','CR','PA',
                                  'GT','BO','VE','UY','PY','HN','SV','NI','DO','CU')
  ORDER BY observed_at DESC LIMIT 3
  ```
  via embedded `users!observer_id(country_code)`.
- Falls back to global if < 3 LATAM results. Strip hides entirely if 0 results overall.

### Page render order (anon visitor, top → bottom)

1. SeasonalAccent + Hero + 3 CTAs (current, unchanged)
2. **HomePulse** — live counters strip (new)
3. **HomeRecentLatam** — 3 cards (new)
4. How It Works (current, unchanged)
5. Why Rastrum (current, unchanged)

The pulse + recent strips are the only above-the-fold additions; below-the-fold content is unchanged.

---

## 6. Migration plan

### PR 1 · Hotfix `/` 400 (ships first, same day)

- Strip `<HomeWidgets />` from `src/pages/{en,es}/index.astro`.
- One unit test asserting `index.astro` doesn't import `HomeWidgets`.
- Closes the production 400.
- ~10 LOC change. No SQL, no i18n, no new components.

### PR 2 · `/home` + marketing pulse (ships after, ~1 week)

- All new components, routes, RPCs, i18n.
- Auto-redirect logic in `BaseLayout.astro`.
- New SQL: 3 RPCs — `home_pulse_stats`, `pending_validation_count`, `falta_dex_summary`. Verified absent in current schema (2026-05-09).
- Header logo target update (`Header.astro`).
- E2E test: `/en/` → cookie-fixture sign-in → expect redirect to `/en/home/`; assert hero, chips, recent rendered.

### SQL additions (`docs/specs/infra/supabase-schema.sql`, idempotent)

```sql
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

Same `SET search_path` invariant as every other `pl*` function (per CLAUDE.md schema security rules). `pending_validation_count()` and `falta_dex_summary()` follow the same template, scoped per-user by `auth.uid()`.

---

## 7. Testing

### Unit (vitest)

- `home-hero.test.ts` — table-driven tests for the cascade with fixtures for each kind + every fallback path (10–15 cases).
- `home-loaders.test.ts` — each chip loader returns the expected shape; errors are swallowed (no throws).
- `home-pulse-honest.test.ts` — pulse strip hides when `obs_30d < 1000`.
- `home-redirect.test.ts` — anon stays on `/`; signed-in stub triggers redirect to `/home`.
- `home-recent-fallback.test.ts` — local query with < 3 results triggers global fallback; query string never contains `country_code` as an observation column.

### E2E (Playwright, `tests/e2e/home.spec.ts`)

One spec covering:
- Anon hits `/en/` → marketing page renders, no console errors, no 4xx requests.
- Signed-in (cookie fixture) hits `/en/` → redirected to `/en/home/`; greeting visible; at least one chip renders.
- Mobile viewport: chips horizontal scroll renders correctly.
- `/es/` → `/es/inicio/` redirect parity.

---

## 8. i18n

- Every new string in `en.json` AND `es.json`.
- Existing parity test (`tests/unit/i18n-parity.test.ts`) catches drift.
- New keys: `home.pulse.*`, `home.recent_latam.*`, `home.hero.streak_at_risk.*`, `home.hero.watchlist_hit.*`, `home.hero.pending_ids.*`, `home.hero.observe_default.*`, `home.greeting.*`, `home.chips.*`, `home.recent.*`.

---

## 9. Out of scope (explicitly v1.1)

- Personalized "for you" feed below the fold (separate design).
- Push notifications for hero triggers.
- A/B test of dynamic hero vs static (not enough traffic for honest stats yet).
- Dashboard widgets for projects / camera stations (project-specific, not `/home`-relevant).
- Replacing the current `HomeWidgets.astro` file (kept until PR 2 is merged + verified, then deleted in a follow-up).
- Personalized counter for the marketing live-pulse (e.g., "12,847 observations *near you*") — would require client-side IP geolocation, not in scope.
- Trust signals strip on marketing (open-source, no tracking, privacy) — separate marketing-page redesign work.

---

## 10. Known risks

| Risk | Mitigation |
|---|---|
| Auto-redirect race — synchronous localStorage read may miss a session that's still being persisted | First-paint script runs *before* `getSupabase()` initializes; if read returns null we fall through to marketing. Worst case: signed-in user briefly sees marketing then gets redirected on a real auth event. Mark the body `data-pending-auth` so consumers don't render greeting prematurely. |
| Hero cascade thrashing — input loader latencies vary; the cascade may "promote" a lower-priority state mid-paint | Resolver runs once after `Promise.all` of all inputs settles. No re-resolution unless the page is reloaded. |
| `home_pulse_stats()` becomes expensive at scale | Cached at the Edge Function layer for 5 minutes; the underlying query plan uses partial indexes already shipped (`idx_observations_sync_status_observed_at`). Re-evaluate if `obs_30d > 10M`. |
| `country_code` filter via embedded-resource breaks on PostgREST upgrade | Pin behavior in an integration test that asserts the URL serializer matches expected form. |
| The "streak at risk" trigger feels manipulative to some users | Profile preference `disable_kairos_nudges` (boolean) — when true, the hero always renders `observe_default`. v1.1 follow-up if user feedback warrants. Not shipped in v1. |

---

*Design saved as `docs/superpowers/specs/2026-05-09-home-page-redesign-design.md`. Implementation plan to be drafted next via the writing-plans skill, after user review.*
