# UX Revamp PR 1 — IA + chrome rebuild — Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Rewrite the site chrome around a verb-first IA (Observe / Explore ▾ / Chat on the left, About / Docs ▾ on the right), introduce a mobile bottom-bar with a center camera FAB, add three new `/explore/*` placeholder routes, and 301 the legacy `/profile/watchlist` route to `/explore/watchlist` — without breaking any existing URL or losing EN/ES parity.

**Architecture:** Three new components (`MegaMenu`, `MobileBottomBar`, `MobileDrawer`) compose with a fully rewritten `Header.astro`. Pure helpers (`chrome-mode.ts`, `chrome-helpers.ts`, plus a `routeTree` in `i18n/utils.ts`) hold all path-and-state logic so the components stay declarative and the logic is unit-testable in isolation. Redirects are configured in `astro.config.mjs` as a static-build redirects map.

**Tech Stack:** Astro 4 (static output), Tailwind CSS, TypeScript strict, Vitest + happy-dom for unit tests, Playwright for e2e. No new runtime dependencies in PR 1.

**Out of scope (later PRs):** Account hub + Settings shell (PR 2), real footer + breadcrumbs (PR 3), command palette (PR 4), onboarding tour + polish (PR 5). Per-section accent rails are wired in this PR; section accents for Profile/Settings inherit emerald until PR 2 lands.

**Spec:** `docs/superpowers/specs/2026-04-26-ux-revamp-design.md`

---

## File map

### Files created

| Path | Responsibility |
|---|---|
| `src/lib/chrome-mode.ts` | Resolve `'app' \| 'read'` from a pathname; single source of truth for context-aware chrome decisions |
| `src/lib/chrome-mode.test.ts` | Unit tests for the resolver |
| `src/lib/chrome-helpers.ts` | Pure helpers — `getFabTarget(path, lang)`, `isActiveSection(currentPath, sectionKey, lang)` |
| `src/lib/chrome-helpers.test.ts` | Unit tests for those helpers |
| `src/i18n/route-tree.test.ts` | Unit tests for the `routeTree` lookup + label retrieval |
| `src/components/MegaMenu.astro` | Reusable 3-column mega-menu (used by Docs ▾ on desktop) |
| `src/components/MobileBottomBar.astro` | Bottom 5-slot tab bar with center camera FAB (signed-in) / 4-tab no-FAB layout (signed-out) |
| `src/components/MobileDrawer.astro` | Right-side hamburger drawer overlay with About, Docs accordion, Settings, Sign in/out, EN/ES + theme switches |
| `src/pages/en/explore/recent.astro` | Recent observations placeholder page |
| `src/pages/en/explore/watchlist.astro` | Watchlist placeholder page |
| `src/pages/en/explore/species.astro` | Species placeholder page |
| `src/pages/es/explorar/recientes.astro` | ES mirror |
| `src/pages/es/explorar/seguimiento.astro` | ES mirror |
| `src/pages/es/explorar/especies.astro` | ES mirror |

### Files modified

| Path | What changes |
|---|---|
| `src/i18n/en.json` | Add `nav.tagline`, `nav.explore_*`, `nav.docs_groups.*`, `nav.drawer.*`, `nav.bottom.*`, placeholder page strings |
| `src/i18n/es.json` | ES mirrors of the above |
| `src/i18n/utils.ts` | Add `exploreRecent`, `exploreWatchlist`, `exploreSpecies` to `routes`; add `routeTree` map and `getRouteLabel(slug, lang)` helper |
| `src/components/Header.astro` | Full rewrite — verb-first split, active-section rail, tagline lockup (md+), MegaMenu for Docs, mobile branch importing MobileBottomBar + MobileDrawer |
| `src/layouts/BaseLayout.astro` | Render `<MobileBottomBar />` as a sibling of `<main>`; add `pb-20 sm:pb-0` to the body so the bar doesn't occlude content |
| `astro.config.mjs` | Add `redirects` map for `/{en,es}/profile/watchlist[/]` → `/{en,es}/explore/watchlist/` |
| `tests/e2e/nav.spec.ts` | Update `ROUTES` to include `/explore/recent`, `/explore/watchlist`, `/explore/species`; add tests for active-state rail, mega-menu mounts, mobile FAB target shifting on `/observe`, drawer open/close, watchlist 301 |

### Boundary rules

- **`src/lib/chrome-mode.ts`** owns the prefix table for `'app' \| 'read'` mode. The footer (PR 3) and command palette (PR 4) will read from it. Adding a route is a one-line edit.
- **`src/lib/chrome-helpers.ts`** is pure-function-only. No DOM, no Astro imports. This makes it trivially testable and keeps the component files declarative.
- **`routeTree`** in `i18n/utils.ts` is the single source for route labels and parent relationships. Breadcrumbs (PR 3) and the search index (PR 4) will reuse it.
- **No DOM logic** in the helpers — components own DOM events; helpers own pure transforms.

---

## Task 1 — `chrome-mode` helper (TDD)

**Files:**
- Create: `src/lib/chrome-mode.ts`
- Test: `src/lib/chrome-mode.test.ts`

- [ ] **Step 1.1 — Write the failing test**

Create `src/lib/chrome-mode.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { resolveChromeMode } from './chrome-mode';

describe('resolveChromeMode', () => {
  it('home is read-mode', () => {
    expect(resolveChromeMode('/en/')).toBe('read');
    expect(resolveChromeMode('/es/')).toBe('read');
  });

  it('observe is app-mode (en + es)', () => {
    expect(resolveChromeMode('/en/observe/')).toBe('app');
    expect(resolveChromeMode('/es/observar/')).toBe('app');
  });

  it('explore and its subroutes are app-mode', () => {
    expect(resolveChromeMode('/en/explore/')).toBe('app');
    expect(resolveChromeMode('/en/explore/map/')).toBe('app');
    expect(resolveChromeMode('/en/explore/recent/')).toBe('app');
    expect(resolveChromeMode('/es/explorar/')).toBe('app');
    expect(resolveChromeMode('/es/explorar/seguimiento/')).toBe('app');
  });

  it('chat is app-mode', () => {
    expect(resolveChromeMode('/en/chat/')).toBe('app');
    expect(resolveChromeMode('/es/chat/')).toBe('app');
  });

  it('profile and its subroutes are app-mode', () => {
    expect(resolveChromeMode('/en/profile/')).toBe('app');
    expect(resolveChromeMode('/en/profile/observations/')).toBe('app');
    expect(resolveChromeMode('/en/profile/settings/profile/')).toBe('app');
    expect(resolveChromeMode('/es/perfil/')).toBe('app');
    expect(resolveChromeMode('/es/perfil/exportar/')).toBe('app');
  });

  it('auth callback is app-mode (no chrome distractions)', () => {
    expect(resolveChromeMode('/auth/callback/')).toBe('app');
  });

  it('identify, about, docs, share are read-mode', () => {
    expect(resolveChromeMode('/en/identify/')).toBe('read');
    expect(resolveChromeMode('/es/identificar/')).toBe('read');
    expect(resolveChromeMode('/en/about/')).toBe('read');
    expect(resolveChromeMode('/es/acerca/')).toBe('read');
    expect(resolveChromeMode('/en/docs/')).toBe('read');
    expect(resolveChromeMode('/en/docs/architecture/')).toBe('read');
    expect(resolveChromeMode('/share/obs/abc123/')).toBe('read');
  });

  it('unknown paths default to read', () => {
    expect(resolveChromeMode('/something/totally/new/')).toBe('read');
    expect(resolveChromeMode('')).toBe('read');
  });

  it('handles missing trailing slash', () => {
    expect(resolveChromeMode('/en/observe')).toBe('app');
    expect(resolveChromeMode('/en/about')).toBe('read');
  });
});
```

- [ ] **Step 1.2 — Run the test to confirm it fails**

```bash
npm run test -- src/lib/chrome-mode.test.ts
```

Expected: FAIL — `Cannot find module './chrome-mode'`

- [ ] **Step 1.3 — Implement the minimal helper**

Create `src/lib/chrome-mode.ts`:

```ts
export type ChromeMode = 'app' | 'read';

// Path prefixes that should render the app-mode chrome (no footer, bottom
// bar dominant on mobile). Order doesn't matter; matched by `startsWith`
// after the locale prefix is stripped, plus the auth callback path.
//
// Read PR 3 to see how the footer reads from this; PR 4 for search.
const APP_PREFIXES = [
  '/observe',
  '/observar',
  '/explore',
  '/explorar',
  '/chat',
  '/profile',
  '/perfil',
] as const;

const AUTH_PREFIXES = ['/auth/'] as const;

export function resolveChromeMode(pathname: string): ChromeMode {
  if (!pathname) return 'read';
  // Locale-neutral check for /auth/* first
  for (const p of AUTH_PREFIXES) {
    if (pathname.startsWith(p)) return 'app';
  }
  // Strip the leading locale (e.g. "/en", "/es"); handle missing trailing slash.
  // Pathnames look like "/en/observe/" or "/es/perfil/exportar/" or "/en".
  const stripped = pathname.replace(/^\/(en|es)(?=\/|$)/, '') || '/';
  for (const p of APP_PREFIXES) {
    if (stripped === p || stripped.startsWith(p + '/') || stripped.startsWith(p + '?')) {
      return 'app';
    }
  }
  return 'read';
}
```

- [ ] **Step 1.4 — Run the test to confirm it passes**

```bash
npm run test -- src/lib/chrome-mode.test.ts
```

Expected: PASS — all 8 cases green.

- [ ] **Step 1.5 — Run the full suite to make sure nothing else broke**

```bash
npm run test
```

Expected: PASS — total count goes from 225 to 233 (8 new cases). If anything that passed before now fails, stop and investigate.

- [ ] **Step 1.6 — Commit**

```bash
git add src/lib/chrome-mode.ts src/lib/chrome-mode.test.ts
git commit -m "feat(chrome): add chrome-mode helper (app vs read)"
```

---

## Task 2 — `routeTree` lookup in `i18n/utils.ts` (TDD)

**Files:**
- Modify: `src/i18n/utils.ts`
- Test: `src/i18n/route-tree.test.ts`

- [ ] **Step 2.1 — Write the failing test**

Create `src/i18n/route-tree.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { routeTree, getRouteLabel, getRouteParent } from './utils';

describe('routeTree', () => {
  it('contains every route key in `routes`', async () => {
    const { routes } = await import('./utils');
    for (const key of Object.keys(routes)) {
      expect(routeTree[key], `missing routeTree entry for ${key}`).toBeDefined();
    }
  });

  it('maps explore subroutes to the explore parent', () => {
    expect(getRouteParent('exploreMap')).toBe('explore');
    expect(getRouteParent('exploreRecent')).toBe('explore');
    expect(getRouteParent('exploreWatchlist')).toBe('explore');
    expect(getRouteParent('exploreSpecies')).toBe('explore');
  });

  it('returns localized labels for known routes', () => {
    expect(getRouteLabel('observe', 'en')).toBe('Observe');
    expect(getRouteLabel('observe', 'es')).toBe('Observar');
    expect(getRouteLabel('exploreMap', 'en')).toBe('Map');
    expect(getRouteLabel('exploreMap', 'es')).toBe('Mapa');
  });

  it('falls back to the route key when no label is registered', () => {
    expect(getRouteLabel('definitely-not-a-route', 'en')).toBe('definitely-not-a-route');
  });

  it('top-level routes have no parent', () => {
    expect(getRouteParent('observe')).toBeUndefined();
    expect(getRouteParent('chat')).toBeUndefined();
  });
});
```

- [ ] **Step 2.2 — Run the test to confirm it fails**

```bash
npm run test -- src/i18n/route-tree.test.ts
```

Expected: FAIL — `routeTree`, `getRouteLabel`, `getRouteParent` are not exported.

- [ ] **Step 2.3 — Update `src/i18n/utils.ts`**

Replace the file contents with:

```ts
import en from './en.json';
import es from './es.json';

const translations: Record<string, typeof en> = { en, es };

export function getLangFromUrl(url: URL) {
  const [, base, lang] = url.pathname.split('/');
  if (lang && lang in translations) return lang;
  if (base && base in translations) return base;
  return 'en';
}

export function t(lang: string) {
  return translations[lang] || translations['en'];
}

export function getLocalizedPath(lang: string, path: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${base}/${lang}${path}`;
}

export const locales = ['en', 'es'] as const;
export type Locale = (typeof locales)[number];

export const routes: Record<string, Record<Locale, string>> = {
  home: { en: '', es: '' },
  identify: { en: '/identify', es: '/identificar' },
  explore: { en: '/explore', es: '/explorar' },
  exploreMap: { en: '/explore/map', es: '/explorar/mapa' },
  exploreRecent: { en: '/explore/recent', es: '/explorar/recientes' },
  exploreWatchlist: { en: '/explore/watchlist', es: '/explorar/seguimiento' },
  exploreSpecies: { en: '/explore/species', es: '/explorar/especies' },
  observe: { en: '/observe', es: '/observar' },
  about: { en: '/about', es: '/acerca' },
  docs: { en: '/docs', es: '/docs' },
  signIn: { en: '/sign-in', es: '/ingresar' },
  profile: { en: '/profile', es: '/perfil' },
  profileEdit: { en: '/profile/edit', es: '/perfil/editar' },
  profileExport: { en: '/profile/export', es: '/perfil/exportar' },
  profileObservations: { en: '/profile/observations', es: '/perfil/observaciones' },
  profileExpertApply: { en: '/profile/expert-apply', es: '/perfil/aplicar-experto' },
  profileUser: { en: '/profile/u', es: '/perfil/u' },
  profileImport: { en: '/profile/import', es: '/perfil/importar' },
  profileImportCameraTrap: {
    en: '/profile/import/camera-trap',
    es: '/perfil/importar/camara-trampa',
  },
  chat: { en: '/chat', es: '/chat' },
};

export const docPages = [
  'vision', 'features', 'roadmap', 'tasks', 'market',
  'architecture', 'indigenous', 'funding', 'contribute',
] as const;

export type DocPage = (typeof docPages)[number];

export function getDocPath(lang: string, page?: string) {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return page ? `${base}/${lang}/docs/${page}/` : `${base}/${lang}/docs/`;
}

export function getAlternateLocale(lang: string): Locale {
  return lang === 'es' ? 'en' : 'es';
}

// ---------------------------------------------------------------------------
// Route tree — single source for nav labels + parent relationships.
// Consumed by the chrome (mega-menu, mobile drawer), and from PR 3 onward by
// breadcrumbs and (PR 4) the search index.
// ---------------------------------------------------------------------------

export interface RouteNode {
  /** Human-readable labels per locale. Falls back to the route key. */
  labels: Record<Locale, string>;
  /** Optional parent route key — used by breadcrumbs (PR 3) and IA grouping. */
  parent?: string;
}

export const routeTree: Record<string, RouteNode> = {
  home:        { labels: { en: 'Home',         es: 'Inicio' } },
  identify:    { labels: { en: 'Identify',     es: 'Identificar' } },
  observe:     { labels: { en: 'Observe',      es: 'Observar' } },
  explore:     { labels: { en: 'Explore',      es: 'Explorar' } },
  exploreMap:        { labels: { en: 'Map',       es: 'Mapa' },         parent: 'explore' },
  exploreRecent:     { labels: { en: 'Recent',    es: 'Recientes' },    parent: 'explore' },
  exploreWatchlist:  { labels: { en: 'Watchlist', es: 'Seguimiento' },  parent: 'explore' },
  exploreSpecies:    { labels: { en: 'Species',   es: 'Especies' },     parent: 'explore' },
  chat:        { labels: { en: 'Chat',          es: 'Chat' } },
  about:       { labels: { en: 'About',         es: 'Acerca' } },
  docs:        { labels: { en: 'Docs',          es: 'Docs' } },
  signIn:      { labels: { en: 'Sign in',       es: 'Ingresar' } },
  profile:     { labels: { en: 'Profile',       es: 'Perfil' } },
  profileEdit:               { labels: { en: 'Edit profile',     es: 'Editar perfil' },     parent: 'profile' },
  profileExport:             { labels: { en: 'Export',           es: 'Exportar' },          parent: 'profile' },
  profileObservations:       { labels: { en: 'My observations',  es: 'Mis observaciones' }, parent: 'profile' },
  profileExpertApply:        { labels: { en: 'Apply expert',     es: 'Aplicar experto' },   parent: 'profile' },
  profileUser:               { labels: { en: 'Public profile',   es: 'Perfil público' },    parent: 'profile' },
  profileImport:             { labels: { en: 'Import',           es: 'Importar' },          parent: 'profile' },
  profileImportCameraTrap:   { labels: { en: 'Camera trap',      es: 'Cámara trampa' },     parent: 'profileImport' },
};

export function getRouteLabel(key: string, lang: string): string {
  const node = routeTree[key];
  if (!node) return key;
  const locale: Locale = lang === 'es' ? 'es' : 'en';
  return node.labels[locale];
}

export function getRouteParent(key: string): string | undefined {
  return routeTree[key]?.parent;
}
```

- [ ] **Step 2.4 — Run the test to confirm it passes**

```bash
npm run test -- src/i18n/route-tree.test.ts
```

Expected: PASS.

- [ ] **Step 2.5 — Run the full suite + typecheck**

```bash
npm run test && npm run typecheck
```

Expected: both green. Existing usages of `routes`, `getDocPath`, `t`, etc. are untouched, so no regressions.

- [ ] **Step 2.6 — Commit**

```bash
git add src/i18n/utils.ts src/i18n/route-tree.test.ts
git commit -m "feat(i18n): add explore subroutes + routeTree label/parent map"
```

---

## Task 3 — chrome helpers `getFabTarget`, `isActiveSection` (TDD)

**Files:**
- Create: `src/lib/chrome-helpers.ts`
- Test: `src/lib/chrome-helpers.test.ts`

- [ ] **Step 3.1 — Write the failing test**

Create `src/lib/chrome-helpers.test.ts`:

```ts
import { describe, it, expect } from 'vitest';
import { getFabTarget, isActiveSection } from './chrome-helpers';

describe('getFabTarget', () => {
  it('default: any non-observe page → /observe (auth-respecting)', () => {
    expect(getFabTarget('/en/explore/map/', 'en')).toEqual({
      href: '/en/observe/', mode: 'observe',
    });
    expect(getFabTarget('/en/profile/', 'en')).toEqual({
      href: '/en/observe/', mode: 'observe',
    });
    expect(getFabTarget('/es/explorar/', 'es')).toEqual({
      href: '/es/observar/', mode: 'observe',
    });
  });

  it('on /observe (en) → /identify in quick mode', () => {
    expect(getFabTarget('/en/observe/', 'en')).toEqual({
      href: '/en/identify/', mode: 'quick-id',
    });
  });

  it('on /observar (es) → /identificar in quick mode', () => {
    expect(getFabTarget('/es/observar/', 'es')).toEqual({
      href: '/es/identificar/', mode: 'quick-id',
    });
  });

  it('handles missing trailing slash on observe', () => {
    expect(getFabTarget('/en/observe', 'en').mode).toBe('quick-id');
  });
});

describe('isActiveSection', () => {
  it('observe matches /observe and /observar', () => {
    expect(isActiveSection('/en/observe/', 'observe', 'en')).toBe(true);
    expect(isActiveSection('/es/observar/', 'observe', 'es')).toBe(true);
    expect(isActiveSection('/en/observe', 'observe', 'en')).toBe(true);
  });

  it('explore is active on any /explore subroute', () => {
    expect(isActiveSection('/en/explore/', 'explore', 'en')).toBe(true);
    expect(isActiveSection('/en/explore/map/', 'explore', 'en')).toBe(true);
    expect(isActiveSection('/es/explorar/seguimiento/', 'explore', 'es')).toBe(true);
  });

  it('docs is active on any /docs subroute (both locales share /docs)', () => {
    expect(isActiveSection('/en/docs/', 'docs', 'en')).toBe(true);
    expect(isActiveSection('/en/docs/architecture/', 'docs', 'en')).toBe(true);
    expect(isActiveSection('/es/docs/vision/', 'docs', 'es')).toBe(true);
  });

  it('does not cross-contaminate sections', () => {
    expect(isActiveSection('/en/observe/', 'explore', 'en')).toBe(false);
    expect(isActiveSection('/en/about/', 'docs', 'en')).toBe(false);
  });

  it('home only matches the bare locale path', () => {
    expect(isActiveSection('/en/', 'home', 'en')).toBe(true);
    expect(isActiveSection('/es/', 'home', 'es')).toBe(true);
    expect(isActiveSection('/en/about/', 'home', 'en')).toBe(false);
  });
});
```

- [ ] **Step 3.2 — Run the test to confirm it fails**

```bash
npm run test -- src/lib/chrome-helpers.test.ts
```

Expected: FAIL — module not found.

- [ ] **Step 3.3 — Implement the helpers**

Create `src/lib/chrome-helpers.ts`:

```ts
import { routes, type Locale } from '../i18n/utils';

export interface FabTarget {
  href: string;
  /** 'observe' = full save flow; 'quick-id' = lightweight photo lookup. */
  mode: 'observe' | 'quick-id';
}

/**
 * Default = /observe. On /observe itself the FAB shifts to /identify (quick
 * lookup, no save) so the camera button is never a no-op while still
 * meaning "photo → identification."
 */
export function getFabTarget(pathname: string, lang: string): FabTarget {
  const locale: Locale = lang === 'es' ? 'es' : 'en';
  const base = import.meta.env?.BASE_URL?.replace(/\/$/, '') ?? '';
  const observeSlug = routes.observe[locale];
  const identifySlug = routes.identify[locale];

  // Match /en/observe, /en/observe/, /es/observar, /es/observar/
  const onObserve = pathname.replace(/\/$/, '') === `${base}/${locale}${observeSlug}`;

  if (onObserve) {
    return { href: `${base}/${locale}${identifySlug}/`, mode: 'quick-id' };
  }
  return { href: `${base}/${locale}${observeSlug}/`, mode: 'observe' };
}

/**
 * Returns true when `currentPath` is inside the section identified by
 * `sectionKey`. Used by Header.astro / MobileBottomBar.astro to render the
 * active rail / active tab.
 *
 * Section keys mirror the top-level entries in `routes`/`routeTree`:
 *   'home', 'observe', 'explore', 'chat', 'about', 'docs', 'profile'
 */
export function isActiveSection(currentPath: string, sectionKey: string, lang: string): boolean {
  const locale: Locale = lang === 'es' ? 'es' : 'en';
  const base = import.meta.env?.BASE_URL?.replace(/\/$/, '') ?? '';
  const norm = currentPath.replace(/\/$/, '');
  const localeRoot = `${base}/${locale}`;

  if (sectionKey === 'home') {
    return norm === localeRoot || norm === '';
  }
  const slug = routes[sectionKey]?.[locale];
  if (slug === undefined) return false;
  const sectionRoot = `${localeRoot}${slug}`;
  return norm === sectionRoot || norm.startsWith(sectionRoot + '/');
}
```

- [ ] **Step 3.4 — Run the test to confirm it passes**

```bash
npm run test -- src/lib/chrome-helpers.test.ts
```

Expected: PASS — all cases green.

- [ ] **Step 3.5 — Run the full suite + typecheck**

```bash
npm run test && npm run typecheck
```

Expected: both green.

- [ ] **Step 3.6 — Commit**

```bash
git add src/lib/chrome-helpers.ts src/lib/chrome-helpers.test.ts
git commit -m "feat(chrome): add getFabTarget + isActiveSection helpers"
```

---

## Task 4 — i18n strings for the new chrome

**Files:**
- Modify: `src/i18n/en.json`
- Modify: `src/i18n/es.json`

- [ ] **Step 4.1 — Open `src/i18n/en.json` and add new sections**

Find the existing top-level `"nav": { ... }` block and replace it with:

```json
"nav": {
  "home": "Home",
  "identify": "Identify",
  "observe": "Observe",
  "explore": "Explore",
  "map": "Map",
  "about": "About",
  "docs": "Docs",
  "chat": "Chat",
  "tagline": "Biodiversity, observed in your language.",
  "explore_dropdown": {
    "map": "Map",
    "recent": "Recent",
    "watchlist": "Watchlist",
    "species": "Species"
  },
  "docs_groups": {
    "product": "Product",
    "progress": "Progress",
    "community": "Community",
    "product_items": {
      "vision":       "Vision",
      "features":     "Features",
      "architecture": "Architecture"
    },
    "progress_items": {
      "roadmap": "Roadmap",
      "tasks":   "Tasks",
      "market":  "Market"
    },
    "community_items": {
      "indigenous": "Indigenous",
      "funding":    "Funding",
      "contribute": "Contribute"
    }
  },
  "drawer": {
    "reference":    "Reference",
    "account":      "Account",
    "preferences":  "Preferences",
    "language":     "Language",
    "theme":        "Theme",
    "open_menu":    "Open menu",
    "close_menu":   "Close menu"
  },
  "bottom": {
    "explore":  "Explore",
    "chat":     "Chat",
    "observe":  "Observe",
    "quick_id": "Quick ID",
    "recent":   "Recent",
    "profile":  "Profile",
    "home":     "Home",
    "identify": "Identify",
    "sign_in":  "Sign in",
    "fab_observe_label":  "Start observation",
    "fab_quick_id_label": "Quick identify"
  }
},
"explore_pages": {
  "recent": {
    "title":       "Recent observations",
    "subtitle":    "What's been spotted around you, lately.",
    "empty":       "No recent public observations yet — be the first."
  },
  "watchlist": {
    "title":       "Watchlist",
    "subtitle":    "Species and places you're following.",
    "empty":       "Add a species or place to follow it here.",
    "moved_note":  "Watchlist moved here from your profile — same data, public-facing home."
  },
  "species": {
    "title":       "Species",
    "subtitle":    "Per-species pages are on the way.",
    "coming_soon": "Coming in a future release. In the meantime, browse the map or your watchlist."
  }
}
```

> **Note:** keep all other top-level keys (`site`, `auth`, `home`, `identify`, `observe`, `docs`, `profile`, `footer`, etc.) unchanged.

- [ ] **Step 4.2 — Mirror in `src/i18n/es.json`**

Replace the `"nav"` block with:

```json
"nav": {
  "home": "Inicio",
  "identify": "Identificar",
  "observe": "Observar",
  "explore": "Explorar",
  "map": "Mapa",
  "about": "Acerca",
  "docs": "Docs",
  "chat": "Chat",
  "tagline": "Biodiversidad, observada en tu idioma.",
  "explore_dropdown": {
    "map":       "Mapa",
    "recent":    "Recientes",
    "watchlist": "Seguimiento",
    "species":   "Especies"
  },
  "docs_groups": {
    "product":   "Producto",
    "progress":  "Progreso",
    "community": "Comunidad",
    "product_items": {
      "vision":       "Visión",
      "features":     "Funcionalidades",
      "architecture": "Arquitectura"
    },
    "progress_items": {
      "roadmap": "Hoja de ruta",
      "tasks":   "Tareas",
      "market":  "Mercado"
    },
    "community_items": {
      "indigenous": "Lenguas indígenas",
      "funding":    "Financiamiento",
      "contribute": "Contribuir"
    }
  },
  "drawer": {
    "reference":   "Referencia",
    "account":     "Cuenta",
    "preferences": "Preferencias",
    "language":    "Idioma",
    "theme":       "Tema",
    "open_menu":   "Abrir menú",
    "close_menu":  "Cerrar menú"
  },
  "bottom": {
    "explore":  "Explorar",
    "chat":     "Chat",
    "observe":  "Observar",
    "quick_id": "ID rápida",
    "recent":   "Recientes",
    "profile":  "Perfil",
    "home":     "Inicio",
    "identify": "Identificar",
    "sign_in":  "Ingresar",
    "fab_observe_label":  "Iniciar observación",
    "fab_quick_id_label": "Identificación rápida"
  }
},
"explore_pages": {
  "recent": {
    "title":       "Observaciones recientes",
    "subtitle":    "Lo que se ha visto cerca de ti, recientemente.",
    "empty":       "Aún no hay observaciones públicas recientes — sé el primero."
  },
  "watchlist": {
    "title":       "Seguimiento",
    "subtitle":    "Especies y lugares que estás siguiendo.",
    "empty":       "Agrega una especie o lugar para seguirlo aquí.",
    "moved_note":  "El seguimiento se movió aquí desde tu perfil — mismos datos, ahora público."
  },
  "species": {
    "title":       "Especies",
    "subtitle":    "Las páginas por especie están en camino.",
    "coming_soon": "Llegará en una versión futura. Mientras tanto, explora el mapa o tu lista de seguimiento."
  }
}
```

- [ ] **Step 4.3 — Verify EN and ES have the same key shape**

Run a small ad-hoc structure diff:

```bash
node -e "
  const en = require('./src/i18n/en.json');
  const es = require('./src/i18n/es.json');
  const keys = (o, p='') => Object.keys(o).flatMap(k => {
    const v = o[k], np = p ? p+'.'+k : k;
    return typeof v === 'object' && !Array.isArray(v) ? keys(v, np) : [np];
  });
  const a = new Set(keys(en)), b = new Set(keys(es));
  const onlyEn = [...a].filter(x => !b.has(x));
  const onlyEs = [...b].filter(x => !a.has(x));
  if (onlyEn.length || onlyEs.length) {
    console.log('PARITY MISMATCH'); console.log('en only:', onlyEn); console.log('es only:', onlyEs);
    process.exit(1);
  }
  console.log('OK — EN/ES key parity holds (' + a.size + ' keys).');
"
```

Expected: `OK — EN/ES key parity holds (...).` Iterate on the JSON until the parity check passes.

- [ ] **Step 4.4 — Run typecheck**

```bash
npm run typecheck
```

Expected: PASS. Existing `tr.nav.home` etc. usages still resolve.

- [ ] **Step 4.5 — Commit**

```bash
git add src/i18n/en.json src/i18n/es.json
git commit -m "feat(i18n): add chrome strings — tagline, explore dropdown, docs groups, drawer, bottom bar"
```

---

## Task 5 — Placeholder explore pages

**Files:**
- Create: `src/pages/en/explore/recent.astro`
- Create: `src/pages/en/explore/watchlist.astro`
- Create: `src/pages/en/explore/species.astro`
- Create: `src/pages/es/explorar/recientes.astro`
- Create: `src/pages/es/explorar/seguimiento.astro`
- Create: `src/pages/es/explorar/especies.astro`

- [ ] **Step 5.1 — Create `src/pages/en/explore/recent.astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import { t } from '../../../i18n/utils';

const lang = 'en';
const tr = t(lang);
const page = tr.explore_pages.recent;
---

<BaseLayout title={`${page.title} — Rastrum`} description={page.subtitle} lang={lang}>
  <section class="space-y-3 py-6">
    <h1 class="text-3xl font-bold tracking-tight">{page.title}</h1>
    <p class="text-zinc-600 dark:text-zinc-400">{page.subtitle}</p>
  </section>

  <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500 dark:text-zinc-400">
    {page.empty}
  </section>
</BaseLayout>
```

- [ ] **Step 5.2 — Create `src/pages/en/explore/watchlist.astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import { t } from '../../../i18n/utils';

const lang = 'en';
const tr = t(lang);
const page = tr.explore_pages.watchlist;
---

<BaseLayout title={`${page.title} — Rastrum`} description={page.subtitle} lang={lang}>
  <section class="space-y-3 py-6">
    <h1 class="text-3xl font-bold tracking-tight">{page.title}</h1>
    <p class="text-zinc-600 dark:text-zinc-400">{page.subtitle}</p>
    <p class="text-xs text-zinc-500 dark:text-zinc-500">{page.moved_note}</p>
  </section>

  <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500 dark:text-zinc-400">
    {page.empty}
  </section>
</BaseLayout>
```

- [ ] **Step 5.3 — Create `src/pages/en/explore/species.astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import { t } from '../../../i18n/utils';

const lang = 'en';
const tr = t(lang);
const page = tr.explore_pages.species;
---

<BaseLayout title={`${page.title} — Rastrum`} description={page.subtitle} lang={lang}>
  <section class="space-y-3 py-6">
    <h1 class="text-3xl font-bold tracking-tight">{page.title}</h1>
    <p class="text-zinc-600 dark:text-zinc-400">{page.subtitle}</p>
  </section>

  <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500 dark:text-zinc-400">
    {page.coming_soon}
  </section>
</BaseLayout>
```

- [ ] **Step 5.4 — Create `src/pages/es/explorar/recientes.astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import { t } from '../../../i18n/utils';

const lang = 'es';
const tr = t(lang);
const page = tr.explore_pages.recent;
---

<BaseLayout title={`${page.title} — Rastrum`} description={page.subtitle} lang={lang}>
  <section class="space-y-3 py-6">
    <h1 class="text-3xl font-bold tracking-tight">{page.title}</h1>
    <p class="text-zinc-600 dark:text-zinc-400">{page.subtitle}</p>
  </section>

  <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500 dark:text-zinc-400">
    {page.empty}
  </section>
</BaseLayout>
```

- [ ] **Step 5.5 — Create `src/pages/es/explorar/seguimiento.astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import { t } from '../../../i18n/utils';

const lang = 'es';
const tr = t(lang);
const page = tr.explore_pages.watchlist;
---

<BaseLayout title={`${page.title} — Rastrum`} description={page.subtitle} lang={lang}>
  <section class="space-y-3 py-6">
    <h1 class="text-3xl font-bold tracking-tight">{page.title}</h1>
    <p class="text-zinc-600 dark:text-zinc-400">{page.subtitle}</p>
    <p class="text-xs text-zinc-500 dark:text-zinc-500">{page.moved_note}</p>
  </section>

  <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500 dark:text-zinc-400">
    {page.empty}
  </section>
</BaseLayout>
```

- [ ] **Step 5.6 — Create `src/pages/es/explorar/especies.astro`**

```astro
---
import BaseLayout from '../../../layouts/BaseLayout.astro';
import { t } from '../../../i18n/utils';

const lang = 'es';
const tr = t(lang);
const page = tr.explore_pages.species;
---

<BaseLayout title={`${page.title} — Rastrum`} description={page.subtitle} lang={lang}>
  <section class="space-y-3 py-6">
    <h1 class="text-3xl font-bold tracking-tight">{page.title}</h1>
    <p class="text-zinc-600 dark:text-zinc-400">{page.subtitle}</p>
  </section>

  <section class="rounded-xl border border-zinc-200 dark:border-zinc-800 p-8 text-center text-zinc-500 dark:text-zinc-400">
    {page.coming_soon}
  </section>
</BaseLayout>
```

- [ ] **Step 5.7 — Build to verify each page renders without errors**

```bash
npm run build
```

Expected: build succeeds. The page count goes from 57 to 63 (+6). If the build fails, the most common cause is a JSON typo — re-run the parity check from Task 4.3.

- [ ] **Step 5.8 — Commit**

```bash
git add src/pages/en/explore/ src/pages/es/explorar/
git commit -m "feat(routes): add /explore/{recent,watchlist,species} placeholder pages (en+es)"
```

---

## Task 6 — Configure 301 redirect for `/profile/watchlist` → `/explore/watchlist`

**Files:**
- Modify: `astro.config.mjs`

- [ ] **Step 6.1 — Replace `astro.config.mjs` contents**

```js
// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://rastrum.org',
  base: '/',
  output: 'static',
  integrations: [tailwind(), sitemap()],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: {
      prefixDefaultLocale: true,
    },
  },
  // PR-1 (UX revamp) IA reshuffle: watchlist is public-data exploration,
  // not personal admin, so it lives under /explore now. Old URL keeps
  // working via 301 so existing bookmarks survive.
  redirects: {
    '/en/profile/watchlist':    { status: 301, destination: '/en/explore/watchlist/' },
    '/en/profile/watchlist/':   { status: 301, destination: '/en/explore/watchlist/' },
    '/es/perfil/seguimiento':   { status: 301, destination: '/es/explorar/seguimiento/' },
    '/es/perfil/seguimiento/':  { status: 301, destination: '/es/explorar/seguimiento/' },
  },
});
```

- [ ] **Step 6.2 — Build and inspect the redirect HTML**

```bash
npm run build
ls dist/en/profile/watchlist/ dist/es/perfil/seguimiento/ 2>/dev/null || true
cat dist/en/profile/watchlist/index.html | head -20
```

Expected: each old path emits a small HTML stub with a `<meta http-equiv="refresh">` redirect (Astro's static-site redirect implementation). Confirm the `Location`/`url` value points at the new path.

- [ ] **Step 6.3 — Run the existing tests + typecheck**

```bash
npm run test && npm run typecheck
```

Expected: green. (No code-shape change.)

- [ ] **Step 6.4 — Commit**

```bash
git add astro.config.mjs
git commit -m "feat(routes): 301 /profile/watchlist → /explore/watchlist (en+es)"
```

---

## Task 7 — `MegaMenu.astro` component

**Files:**
- Create: `src/components/MegaMenu.astro`

- [ ] **Step 7.1 — Create the component**

```astro
---
import { getDocPath } from '../i18n/utils';

interface Item { key: string; label: string; desc?: string; }
interface Column { heading: string; items: Item[]; }
interface Props {
  lang: 'en' | 'es';
  trigger: string;          // visible button label, e.g. "Docs"
  columns: Column[];        // 3 columns by convention
  align?: 'left' | 'right'; // dropdown anchor; defaults to right
}
const { lang, trigger, columns, align = 'right' } = Astro.props;
const id = `megamenu-${trigger.toLowerCase()}`;
---

<div class="relative" data-megamenu-root>
  <button
    id={`${id}-btn`}
    type="button"
    class="flex items-center gap-1 hover:text-emerald-600 dark:hover:text-emerald-400 transition-colors"
    aria-haspopup="true"
    aria-expanded="false"
    aria-controls={`${id}-menu`}
  >
    {trigger}
    <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2">
      <path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7" />
    </svg>
  </button>

  <div
    id={`${id}-menu`}
    class:list={[
      'hidden absolute top-full mt-2 z-50',
      align === 'right' ? 'right-0' : 'left-0',
      'min-w-[640px] grid grid-cols-3 gap-6',
      'rounded-lg border border-zinc-200 dark:border-zinc-800',
      'bg-white dark:bg-zinc-900 shadow-lg p-4',
    ]}
    role="menu"
  >
    {columns.map(col => (
      <div>
        <p class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">
          {col.heading}
        </p>
        <ul class="space-y-1">
          {col.items.map(item => (
            <li>
              <a
                href={getDocPath(lang, item.key)}
                class="block px-2 py-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800 text-sm text-zinc-700 dark:text-zinc-300"
                role="menuitem"
              >
                <span class="block font-medium">{item.label}</span>
                {item.desc && (
                  <span class="block text-xs text-zinc-500 dark:text-zinc-500">{item.desc}</span>
                )}
              </a>
            </li>
          ))}
        </ul>
      </div>
    ))}
  </div>
</div>

<script is:inline define:vars={{ id }}>
  (function() {
    const btn  = document.getElementById(id + '-btn');
    const menu = document.getElementById(id + '-menu');
    if (!btn || !menu) return;

    function open()  { menu.classList.remove('hidden'); btn.setAttribute('aria-expanded', 'true');  }
    function close() { menu.classList.add('hidden');    btn.setAttribute('aria-expanded', 'false'); }
    function toggle() { menu.classList.contains('hidden') ? open() : close(); }

    btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== btn) close();
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });
  })();
</script>
```

> **Note:** PR 1 keeps `MegaMenu` Docs-specific (it uses `getDocPath`). PR 2/3 may generalize it if the Settings or footer need similar shells.

- [ ] **Step 7.2 — Build to verify it parses**

```bash
npm run build
```

Expected: PASS. `MegaMenu.astro` is not yet imported anywhere, so its bare existence is the only check.

- [ ] **Step 7.3 — Commit**

```bash
git add src/components/MegaMenu.astro
git commit -m "feat(chrome): add MegaMenu component (3-col docs dropdown)"
```

---

## Task 8 — `MobileBottomBar.astro` component

**Files:**
- Create: `src/components/MobileBottomBar.astro`

- [ ] **Step 8.1 — Create the component**

```astro
---
import { t, getLocalizedPath, routes, type Locale } from '../i18n/utils';
import { getFabTarget, isActiveSection } from '../lib/chrome-helpers';

interface Props {
  lang: 'en' | 'es';
  currentPath: string;
}
const { lang, currentPath } = Astro.props;
const tr = t(lang);
const locale = lang as Locale;

const fab = getFabTarget(currentPath, lang);

// Build href helpers — these read from `routes` so they stay symmetric across locales.
const explorePath = getLocalizedPath(lang, routes.explore[locale] + '/');
const exploreRecentPath = getLocalizedPath(lang, routes.exploreRecent[locale] + '/');
const chatPath    = getLocalizedPath(lang, routes.chat[locale] + '/');
const profilePath = getLocalizedPath(lang, routes.profile[locale] + '/');
const homePath    = getLocalizedPath(lang, '/');
const identifyPath = getLocalizedPath(lang, routes.identify[locale] + '/');
const exploreMapPath = getLocalizedPath(lang, routes.exploreMap[locale] + '/');
const signInPath  = getLocalizedPath(lang, routes.signIn[locale] + '/');

// Active-state precomputes (so the markup stays tidy)
const obsActive  = isActiveSection(currentPath, 'observe',  lang);
const expActive  = isActiveSection(currentPath, 'explore',  lang);
const chatActive = isActiveSection(currentPath, 'chat',     lang);
const profActive = isActiveSection(currentPath, 'profile',  lang);
const homeActive = isActiveSection(currentPath, 'home',     lang);
const idActive   = isActiveSection(currentPath, 'identify', lang);
---

<!--
  Mobile bottom bar. Two layouts driven by auth state, swapped by the
  inline script below: the signed-in 5-slot version (Explore · Chat ·
  [FAB] · Recent · Profile) and the signed-out 4-slot version (Home ·
  Identify · Map · Sign in) — sacred geometry: the FAB only appears
  when it means "observe."
-->
<nav
  id="mobile-bottom-bar"
  class="sm:hidden fixed inset-x-0 bottom-0 z-40 border-t border-zinc-200 dark:border-zinc-800 bg-white/90 dark:bg-zinc-950/90 backdrop-blur"
  style="padding-bottom: max(env(safe-area-inset-bottom), 0px);"
  aria-label={tr.nav.bottom.observe}
>
  <!-- Signed-in: 5 slots, center FAB -->
  <div id="mbb-authed" class="hidden grid grid-cols-5 items-end h-16 relative">
    <a href={explorePath} class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      expActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]} data-tour="explore-tab">
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9"/></svg>
      <span>{tr.nav.bottom.explore}</span>
    </a>
    <a href={chatPath} class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      chatActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]}>
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M8 12h.01M12 12h.01M16 12h.01M21 12c0 4.418-4.03 8-9 8a9.86 9.86 0 01-4-.83L3 20l1.41-3.18A8 8 0 0121 12z"/></svg>
      <span>{tr.nav.bottom.chat}</span>
    </a>

    <!-- FAB slot -->
    <div class="relative">
      <a
        href={fab.href}
        data-tour="fab"
        aria-label={fab.mode === 'quick-id' ? tr.nav.bottom.fab_quick_id_label : tr.nav.bottom.fab_observe_label}
        class="absolute left-1/2 -translate-x-1/2 -top-7 w-14 h-14 rounded-full bg-emerald-600 hover:bg-emerald-700 text-white flex items-center justify-center shadow-lg ring-4 ring-white dark:ring-zinc-950 motion-reduce:transition-none transition-transform active:scale-95"
      >
        <svg class="w-6 h-6" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 0 1 2-2h2l1.5-2h7L17 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
        {fab.mode === 'quick-id' && (
          <span aria-hidden="true" class="absolute -top-1 -right-1 w-5 h-5 bg-yellow-400 text-zinc-900 rounded-full flex items-center justify-center text-[10px] font-bold border-2 border-white dark:border-zinc-950">⚡</span>
        )}
      </a>
      <span class="absolute left-1/2 -translate-x-1/2 top-9 text-[9px] text-zinc-500 dark:text-zinc-400 whitespace-nowrap">
        {fab.mode === 'quick-id' ? tr.nav.bottom.quick_id : tr.nav.bottom.observe}
      </span>
    </div>

    <a href={exploreRecentPath} class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      currentPath.includes('/explore/recent') || currentPath.includes('/explorar/recientes')
        ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]}>
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 8v4l3 3m6-3a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <span>{tr.nav.bottom.recent}</span>
    </a>
    <a href={profilePath} class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      profActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]}>
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M5.121 17.804A13.937 13.937 0 0112 16c2.5 0 4.847.655 6.879 1.804M15 10a3 3 0 11-6 0 3 3 0 016 0zm6 2a9 9 0 11-18 0 9 9 0 0118 0z"/></svg>
      <span>{tr.nav.bottom.profile}</span>
    </a>
  </div>

  <!-- Signed-out: 4-tab no-FAB layout -->
  <div id="mbb-anon" class="grid grid-cols-4 items-end h-16">
    <a href={homePath} class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      homeActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]}>
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 12l9-9 9 9M5 10v10a1 1 0 001 1h3v-7h6v7h3a1 1 0 001-1V10"/></svg>
      <span>{tr.nav.bottom.home}</span>
    </a>
    <a href={identifyPath} class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      idActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]}>
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M3 9a2 2 0 0 1 2-2h2l1.5-2h7L17 7h2a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/><circle cx="12" cy="13" r="3.5" fill="none" stroke="currentColor" stroke-width="2"/></svg>
      <span>{tr.nav.bottom.identify}</span>
    </a>
    <a href={exploreMapPath} class:list={[
      'flex flex-col items-center justify-center gap-0.5 py-1 text-[10px]',
      expActive ? 'text-emerald-600 dark:text-emerald-400' : 'text-zinc-500 dark:text-zinc-400'
    ]}>
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 20l-5.447-2.724A1 1 0 013 16.382V5.618a1 1 0 011.447-.894L9 7m0 13l6-3m-6 3V7m6 10l5.553 2.276A1 1 0 0021 18.382V7.618a1 1 0 00-1.447-.894L15 9m0 8V9"/></svg>
      <span>{tr.nav.bottom.explore}</span>
    </a>
    <a href={signInPath} class="flex flex-col items-center justify-center gap-0.5 py-1 text-[10px] text-emerald-600 dark:text-emerald-400">
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M17 16l4-4m0 0l-4-4m4 4H9m-4 8H4a1 1 0 01-1-1V5a1 1 0 011-1h1"/></svg>
      <span>{tr.nav.bottom.sign_in}</span>
    </a>
  </div>
</nav>

<!--
  Auth-state swap. Mirrors the existing pattern in Header.astro: read the
  Supabase session, toggle visibility for the signed-in vs signed-out
  layout. The `mbb-anon` block is shown by default so the layout never
  flashes empty.
-->
<script>
  import { getSupabase } from '../lib/supabase';

  const authed = document.getElementById('mbb-authed');
  const anon   = document.getElementById('mbb-anon');

  function paint(hasSession: boolean) {
    if (!authed || !anon) return;
    authed.classList.toggle('hidden', !hasSession);
    anon.classList.toggle('hidden',   hasSession);
  }

  (async () => {
    try {
      const { data: { session } } = await getSupabase().auth.getSession();
      paint(!!session);
      getSupabase().auth.onAuthStateChange((_e, s) => paint(!!s));
    } catch { /* env not set; leave anon visible */ }
  })();
</script>
```

- [ ] **Step 8.2 — Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 8.3 — Commit**

```bash
git add src/components/MobileBottomBar.astro
git commit -m "feat(chrome): add MobileBottomBar with center camera FAB + auth swap"
```

---

## Task 9 — `MobileDrawer.astro` component

**Files:**
- Create: `src/components/MobileDrawer.astro`

- [ ] **Step 9.1 — Create the component**

```astro
---
import { t, getLocalizedPath, getDocPath, getAlternateLocale, routes, docPages, type Locale } from '../i18n/utils';

interface Props {
  lang: 'en' | 'es';
  currentPath: string;
}
const { lang, currentPath } = Astro.props;
const tr = t(lang);
const alt = getAlternateLocale(lang);
const locale = lang as Locale;

// alt-language href for the segmented switch
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const pathWithoutBase = currentPath.replace(base, '') || '/';
const segments = pathWithoutBase.split('/').filter(Boolean);
const currentLang = segments[0] || lang;
const currentSlug = '/' + (segments.slice(1).join('/') || '');
const matchedKey = Object.keys(routes).find(key => {
  const slug = routes[key][currentLang as Locale] || '';
  return slug === currentSlug || (currentSlug === '/' && slug === '');
});
const altSlug = matchedKey ? (routes[matchedKey][alt] || '') : currentSlug;
const altHref = `${base}/${alt}${altSlug}/`;

const aboutPath = getLocalizedPath(lang, routes.about[locale] + '/');
const signInPath = getLocalizedPath(lang, routes.signIn[locale] + '/');
const profilePath = getLocalizedPath(lang, routes.profile[locale] + '/');

const getDocLabel = (key: string) => (tr.docs.sections as Record<string, string>)[key] || key;
---

<!-- Off-canvas drawer for mobile (<sm). Hidden until ≡ in the header is tapped. -->
<div
  id="mobile-drawer-backdrop"
  class="hidden fixed inset-0 z-50 sm:hidden bg-black/60"
  aria-hidden="true"
></div>
<aside
  id="mobile-drawer"
  class="hidden fixed top-0 right-0 bottom-0 z-50 sm:hidden w-[260px] bg-white dark:bg-zinc-950 border-l border-zinc-200 dark:border-zinc-800 overflow-y-auto"
  role="dialog"
  aria-modal="true"
  aria-label={tr.nav.drawer.open_menu}
>
  <div class="flex items-center justify-between p-3 border-b border-zinc-200 dark:border-zinc-800">
    <span class="text-emerald-600 dark:text-emerald-400 font-bold flex items-center gap-2">
      <img src="/rastrum-logo.svg" alt="" class="w-6 h-6" />
      Rastrum
    </span>
    <button
      id="mobile-drawer-close"
      class="p-2 -mr-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800"
      aria-label={tr.nav.drawer.close_menu}
    >
      <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M6 18L18 6M6 6l12 12"/></svg>
    </button>
  </div>

  <div class="p-4 space-y-5 text-sm">
    <!-- Reference -->
    <section>
      <p class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">{tr.nav.drawer.reference}</p>
      <a href={aboutPath} class="block py-1.5 hover:text-emerald-600 dark:hover:text-emerald-400">{tr.nav.about}</a>
      <details class="group">
        <summary class="flex items-center justify-between py-1.5 cursor-pointer list-none">
          <span>{tr.nav.docs}</span>
          <svg class="w-3 h-3 transition-transform group-open:rotate-90" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M9 5l7 7-7 7"/></svg>
        </summary>
        <div class="mt-1 ml-2 space-y-1 border-l border-zinc-200 dark:border-zinc-800 pl-3">
          <a href={getDocPath(lang)} class="block py-1 text-zinc-700 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400">
            {tr.docs.back_to_docs}
          </a>
          {docPages.map(page => (
            <a
              href={getDocPath(lang, page)}
              class="block py-1 text-zinc-600 dark:text-zinc-400 hover:text-emerald-600 dark:hover:text-emerald-400"
            >
              {getDocLabel(page)}
            </a>
          ))}
        </div>
      </details>
    </section>

    <!-- Account: signed-in branch -->
    <section id="drawer-authed" class="hidden">
      <p class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">{tr.nav.drawer.account}</p>
      <a href={profilePath} class="block py-1.5 hover:text-emerald-600 dark:hover:text-emerald-400">{tr.profile.view_profile}</a>
      <button id="drawer-sign-out" class="block w-full text-left py-1.5 text-red-600 dark:text-red-400 hover:text-red-700">{tr.auth.sign_out}</button>
    </section>

    <!-- Account: signed-out branch -->
    <section id="drawer-anon">
      <p class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">{tr.nav.drawer.account}</p>
      <a href={signInPath} class="block py-1.5 text-emerald-700 dark:text-emerald-400">{tr.auth.sign_in}</a>
    </section>

    <!-- Preferences (lang + theme shortcuts) -->
    <section>
      <p class="text-xs font-semibold text-emerald-600 dark:text-emerald-400 uppercase tracking-wider mb-2">{tr.nav.drawer.preferences}</p>
      <div class="flex items-center justify-between py-1.5">
        <span>{tr.nav.drawer.language}</span>
        <a
          href={altHref}
          data-target-lang={alt}
          id="drawer-lang-toggle"
          class="text-xs px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700"
        >
          {alt.toUpperCase()}
        </a>
      </div>
      <div class="flex items-center justify-between py-1.5">
        <span>{tr.nav.drawer.theme}</span>
        <button id="drawer-theme-toggle" class="p-1.5 rounded hover:bg-zinc-100 dark:hover:bg-zinc-800" aria-label="Toggle theme">
          <svg class="w-5 h-5 hidden dark:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
          <svg class="w-5 h-5 block dark:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
        </button>
      </div>
    </section>
  </div>
</aside>

<script>
  import { getSupabase } from '../lib/supabase';
  import { signOut } from '../lib/auth';

  const drawer   = document.getElementById('mobile-drawer');
  const backdrop = document.getElementById('mobile-drawer-backdrop');
  const closeBtn = document.getElementById('mobile-drawer-close');
  const authed   = document.getElementById('drawer-authed');
  const anon     = document.getElementById('drawer-anon');
  const signOutBtn = document.getElementById('drawer-sign-out');
  const themeBtn = document.getElementById('drawer-theme-toggle');
  const langTog  = document.getElementById('drawer-lang-toggle') as HTMLAnchorElement | null;

  function open() {
    drawer?.classList.remove('hidden');
    backdrop?.classList.remove('hidden');
    document.documentElement.style.overflow = 'hidden';
  }
  function close() {
    drawer?.classList.add('hidden');
    backdrop?.classList.add('hidden');
    document.documentElement.style.overflow = '';
  }

  // Public hook for Header.astro's hamburger button.
  (window as Window & { __rastrumOpenDrawer?: () => void }).__rastrumOpenDrawer = open;

  closeBtn?.addEventListener('click', close);
  backdrop?.addEventListener('click', close);
  document.addEventListener('keydown', (e) => { if (e.key === 'Escape') close(); });

  // Auth-state swap, same shape as MobileBottomBar
  function paintAuth(has: boolean) {
    authed?.classList.toggle('hidden', !has);
    anon?.classList.toggle('hidden',  has);
  }
  (async () => {
    try {
      const { data: { session } } = await getSupabase().auth.getSession();
      paintAuth(!!session);
      getSupabase().auth.onAuthStateChange((_e, s) => paintAuth(!!s));
    } catch { /* env not set */ }
  })();

  signOutBtn?.addEventListener('click', async () => { await signOut(); window.location.reload(); });

  themeBtn?.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  });

  langTog?.addEventListener('click', () => {
    const target = langTog.dataset.targetLang;
    if (target) localStorage.setItem('rastrum.lang', target);
  });
</script>
```

- [ ] **Step 9.2 — Build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 9.3 — Commit**

```bash
git add src/components/MobileDrawer.astro
git commit -m "feat(chrome): add MobileDrawer overlay with reference/account/preferences"
```

---

## Task 10 — Rewrite `Header.astro`

**Files:**
- Modify: `src/components/Header.astro`

- [ ] **Step 10.1 — Replace `src/components/Header.astro` with the new implementation**

```astro
---
import { t, getLocalizedPath, getAlternateLocale, routes, type Locale } from '../i18n/utils';
import { isActiveSection } from '../lib/chrome-helpers';
import BellIcon from './BellIcon.astro';
import MegaMenu from './MegaMenu.astro';
import MobileBottomBar from './MobileBottomBar.astro';
import MobileDrawer from './MobileDrawer.astro';

interface Props {
  lang: string;
  currentPath?: string;
}

const { lang, currentPath = '/' } = Astro.props;
const tr = t(lang);
const alt = getAlternateLocale(lang);
const locale = (lang === 'es' ? 'es' : 'en') as Locale;

// alt-language href (preserves the existing route-key swap behavior)
const base = import.meta.env.BASE_URL.replace(/\/$/, '');
const pathWithoutBase = currentPath.replace(base, '') || '/';
const segments = pathWithoutBase.split('/').filter(Boolean);
const currentLang = segments[0] || lang;
const currentSlug = '/' + (segments.slice(1).join('/') || '');
const matchedKey = Object.keys(routes).find(key => {
  const slug = routes[key][currentLang as Locale] || '';
  return slug === currentSlug || (currentSlug === '/' && slug === '');
});
const altSlug = matchedKey ? (routes[matchedKey][alt] || '') : currentSlug;
const altHref = `${base}/${alt}${altSlug}/`;

// Active-state precomputes for the verbs
const obsActive  = isActiveSection(currentPath, 'observe',  lang);
const expActive  = isActiveSection(currentPath, 'explore',  lang);
const chatActive = isActiveSection(currentPath, 'chat',     lang);
const docsActive = isActiveSection(currentPath, 'docs',     lang);
const aboutActive = isActiveSection(currentPath, 'about',   lang);

// Section accent — emerald is the default (the brand). Per spec §7,
// Explore = teal-500, Chat = sky-500, Docs/About = stone-500. The active
// rail picks the right token. PR 1 wires the rail; refinement is in PR 5.
const railClass = (active: boolean, accent: 'emerald' | 'teal' | 'sky' | 'stone') => active
  ? `text-${accent}-600 dark:text-${accent}-400 after:bg-${accent}-500 after:scale-x-100`
  : 'text-zinc-700 dark:text-zinc-300 hover:text-emerald-600 dark:hover:text-emerald-400 after:scale-x-0';

// Safelist note: the dynamic section-accent class strings (`text-teal-600`,
// `after:bg-sky-500`, etc.) must be kept reachable for Tailwind. The
// safelist is wired in `tailwind.config.cjs`; if a build emits unstyled
// rails, check that file.

const explorePath = getLocalizedPath(lang, routes.explore[locale] + '/');
const exploreMapPath = getLocalizedPath(lang, routes.exploreMap[locale] + '/');
const exploreRecentPath = getLocalizedPath(lang, routes.exploreRecent[locale] + '/');
const exploreWatchlistPath = getLocalizedPath(lang, routes.exploreWatchlist[locale] + '/');
const exploreSpeciesPath = getLocalizedPath(lang, routes.exploreSpecies[locale] + '/');

const docColumns = [
  {
    heading: tr.nav.docs_groups.product,
    items: [
      { key: 'vision',       label: tr.nav.docs_groups.product_items.vision },
      { key: 'features',     label: tr.nav.docs_groups.product_items.features },
      { key: 'architecture', label: tr.nav.docs_groups.product_items.architecture },
    ],
  },
  {
    heading: tr.nav.docs_groups.progress,
    items: [
      { key: 'roadmap', label: tr.nav.docs_groups.progress_items.roadmap },
      { key: 'tasks',   label: tr.nav.docs_groups.progress_items.tasks },
      { key: 'market',  label: tr.nav.docs_groups.progress_items.market },
    ],
  },
  {
    heading: tr.nav.docs_groups.community,
    items: [
      { key: 'indigenous', label: tr.nav.docs_groups.community_items.indigenous },
      { key: 'funding',    label: tr.nav.docs_groups.community_items.funding },
      { key: 'contribute', label: tr.nav.docs_groups.community_items.contribute },
    ],
  },
];
---

<header class="border-b border-zinc-200 dark:border-zinc-800">
  <div class="max-w-5xl mx-auto px-4 py-3 flex items-center gap-4">
    <!-- Lockup -->
    <a href={getLocalizedPath(lang, '/')} class="flex flex-col leading-tight">
      <span class="flex items-center gap-2 text-lg font-bold text-emerald-600 dark:text-emerald-400">
        <img src="/rastrum-logo.svg" alt="Rastrum" class="w-7 h-7" />
        Rastrum
      </span>
      <span class="hidden md:block text-[11px] text-zinc-500 dark:text-zinc-500 -mt-0.5 ml-9">
        {tr.nav.tagline}
      </span>
    </a>

    <span class="hidden sm:block w-px h-6 bg-zinc-200 dark:bg-zinc-800"></span>

    <!-- Verbs (left) -->
    <nav class="hidden sm:flex items-center gap-5 text-sm">
      <a href={getLocalizedPath(lang, routes.observe[locale] + '/')}
         class:list={[
           'relative pb-1 transition-colors after:content-[""] after:absolute after:left-0 after:right-0 after:-bottom-3 after:h-[2px] after:rounded after:transition-transform after:origin-left',
           railClass(obsActive, 'emerald'),
         ]}>
        {tr.nav.observe}
      </a>

      <!-- Explore dropdown (small list, not mega) -->
      <div class="relative" id="hdr-explore">
        <button
          id="hdr-explore-btn"
          type="button"
          class:list={[
            'flex items-center gap-1 pb-1 transition-colors after:content-[""] after:absolute after:left-0 after:right-0 after:-bottom-3 after:h-[2px] after:rounded after:transition-transform after:origin-left',
            railClass(expActive, 'teal'),
          ]}
          aria-haspopup="true" aria-expanded="false" aria-controls="hdr-explore-menu"
        >
          {tr.nav.explore}
          <svg class="w-3.5 h-3.5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M19 9l-7 7-7-7"/></svg>
        </button>
        <div id="hdr-explore-menu" class="hidden absolute left-0 top-full mt-2 w-56 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg py-1 z-50">
          <a href={exploreMapPath}        class="block px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">{tr.nav.explore_dropdown.map}</a>
          <a href={exploreRecentPath}     class="block px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">{tr.nav.explore_dropdown.recent}</a>
          <a href={exploreWatchlistPath}  class="block px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">{tr.nav.explore_dropdown.watchlist}</a>
          <a href={exploreSpeciesPath}    class="block px-4 py-2 text-sm hover:bg-zinc-100 dark:hover:bg-zinc-800">{tr.nav.explore_dropdown.species}</a>
        </div>
      </div>

      <a href={getLocalizedPath(lang, routes.chat[locale] + '/')}
         class:list={[
           'relative pb-1 transition-colors after:content-[""] after:absolute after:left-0 after:right-0 after:-bottom-3 after:h-[2px] after:rounded after:transition-transform after:origin-left',
           railClass(chatActive, 'sky'),
         ]}>
        {tr.nav.chat}
      </a>
    </nav>

    <!-- Reference (right of verbs, before auth) -->
    <nav class="hidden sm:flex items-center gap-5 text-sm ml-auto">
      <a href={getLocalizedPath(lang, routes.about[locale] + '/')}
         class:list={[
           'relative pb-1 transition-colors after:content-[""] after:absolute after:left-0 after:right-0 after:-bottom-3 after:h-[2px] after:rounded after:transition-transform after:origin-left',
           railClass(aboutActive, 'stone'),
         ]}>
        {tr.nav.about}
      </a>
      <MegaMenu lang={locale} trigger={tr.nav.docs} columns={docColumns} align="right" />
    </nav>

    <!-- Auth + utilities -->
    <div class="flex items-center gap-2 sm:ml-2">
      <a
        href={getLocalizedPath(lang, routes.signIn[locale] + '/')}
        id="sign-in-link"
        class="hidden text-xs font-medium px-2.5 py-1 rounded border border-emerald-600/60 text-emerald-700 dark:text-emerald-400 hover:bg-emerald-50 dark:hover:bg-emerald-900/20 transition-colors"
      >
        {tr.auth.sign_in}
      </a>
      <BellIcon lang={locale} />
      <div id="avatar-wrap" class="hidden relative">
        <button id="avatar-btn" aria-label="Account menu" class="block rounded-full focus:outline-none focus:ring-2 focus:ring-emerald-500">
          <img id="header-avatar" src="" alt="" class="w-8 h-8 rounded-full bg-emerald-600 object-cover" />
        </button>
        <div id="avatar-menu" class="hidden absolute right-0 top-full mt-2 w-48 rounded-lg border border-zinc-200 dark:border-zinc-800 bg-white dark:bg-zinc-900 shadow-lg py-1 z-50">
          <a id="menu-profile" href={getLocalizedPath(lang, routes.profile[locale] + '/')} class="block px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">{tr.profile.view_profile}</a>
          <a id="menu-edit"    href={getLocalizedPath(lang, routes.profileEdit[locale] + '/')} class="block px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">{tr.profile.edit}</a>
          <div class="border-t border-zinc-200 dark:border-zinc-800 my-1"></div>
          <button id="sign-out-btn" class="block w-full text-left px-4 py-2 text-sm text-zinc-700 dark:text-zinc-300 hover:bg-zinc-100 dark:hover:bg-zinc-800">{tr.auth.sign_out}</button>
        </div>
      </div>

      <a
        href={altHref}
        id="lang-toggle"
        data-target-lang={alt}
        class="hidden md:block text-xs font-medium px-2 py-1 rounded border border-zinc-300 dark:border-zinc-700 hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        {alt.toUpperCase()}
      </a>
      <button
        id="theme-toggle"
        aria-label="Toggle dark mode"
        class="hidden md:block p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
      >
        <svg class="w-5 h-5 hidden dark:block" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M12 3v1m0 16v1m9-9h-1M4 12H3m15.364 6.364l-.707-.707M6.343 6.343l-.707-.707m12.728 0l-.707.707M6.343 17.657l-.707.707M16 12a4 4 0 11-8 0 4 4 0 018 0z"/></svg>
        <svg class="w-5 h-5 block dark:hidden" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M20.354 15.354A9 9 0 018.646 3.646 9.003 9.003 0 0012 21a9.003 9.003 0 008.354-5.646z"/></svg>
      </button>

      <!-- Hamburger (mobile only) — opens MobileDrawer via window hook -->
      <button
        id="mobile-menu-toggle"
        type="button"
        class="sm:hidden p-2 rounded-lg hover:bg-zinc-100 dark:hover:bg-zinc-800 transition-colors"
        aria-label={tr.nav.drawer.open_menu}
      >
        <svg class="w-5 h-5" fill="none" viewBox="0 0 24 24" stroke="currentColor" stroke-width="2"><path stroke-linecap="round" stroke-linejoin="round" d="M4 6h16M4 12h16M4 18h16"/></svg>
      </button>
    </div>
  </div>
</header>

<MobileDrawer lang={locale} currentPath={currentPath} />
<MobileBottomBar lang={locale} currentPath={currentPath} />

<script is:inline>
  // Theme + lang toggles (desktop chrome — kept until PR 3 moves them into the footer/Preferences)
  document.getElementById('theme-toggle')?.addEventListener('click', () => {
    const dark = document.documentElement.classList.toggle('dark');
    localStorage.setItem('theme', dark ? 'dark' : 'light');
  });
  document.getElementById('lang-toggle')?.addEventListener('click', function() {
    const target = this.dataset.targetLang;
    if (target) localStorage.setItem('rastrum.lang', target);
  });

  // Hamburger → drawer (handler exposed by MobileDrawer)
  document.getElementById('mobile-menu-toggle')?.addEventListener('click', () => {
    if (typeof window.__rastrumOpenDrawer === 'function') window.__rastrumOpenDrawer();
  });

  // Explore dropdown
  (function() {
    const btn  = document.getElementById('hdr-explore-btn');
    const menu = document.getElementById('hdr-explore-menu');
    if (!btn || !menu) return;
    btn.addEventListener('click', (e) => { e.stopPropagation(); menu.classList.toggle('hidden'); btn.setAttribute('aria-expanded', menu.classList.contains('hidden') ? 'false' : 'true'); });
    document.addEventListener('click', (e) => {
      if (!menu.classList.contains('hidden') && !menu.contains(e.target) && e.target !== btn) {
        menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false');
      }
    });
    document.addEventListener('keydown', (e) => { if (e.key === 'Escape') { menu.classList.add('hidden'); btn.setAttribute('aria-expanded', 'false'); } });
  })();
</script>

<!-- Auth status: keeps the existing avatar-swap behavior -->
<script>
  import { getSupabase } from '../lib/supabase';
  import { signOut } from '../lib/auth';
  import type { UserProfile } from '../lib/types';

  const signInLink = document.getElementById('sign-in-link');
  const avatarWrap = document.getElementById('avatar-wrap');
  const avatarBtn  = document.getElementById('avatar-btn');
  const avatarMenu = document.getElementById('avatar-menu');
  const avatarImg  = document.getElementById('header-avatar') as HTMLImageElement | null;
  const signOutBtn = document.getElementById('sign-out-btn');

  function initialsAvatar(name: string): string {
    const clean = (name || '?').trim().slice(0, 2).toUpperCase();
    const svg = `<svg xmlns='http://www.w3.org/2000/svg' width='32' height='32' viewBox='0 0 32 32'><rect width='32' height='32' fill='#10b981'/><text x='50%' y='58%' text-anchor='middle' fill='white' font-family='system-ui,sans-serif' font-size='14' font-weight='700'>${clean}</text></svg>`;
    return 'data:image/svg+xml;utf8,' + encodeURIComponent(svg);
  }

  const AVATAR_CACHE_KEY = 'rastrum.headerAvatar';
  const AVATAR_NAME_KEY  = 'rastrum.headerName';
  function paintCachedAvatar() {
    if (!avatarImg) return;
    try {
      const cachedSrc = localStorage.getItem(AVATAR_CACHE_KEY);
      const cachedAlt = localStorage.getItem(AVATAR_NAME_KEY);
      if (cachedSrc) {
        avatarImg.src = cachedSrc;
        if (cachedAlt) avatarImg.alt = cachedAlt;
        avatarWrap?.classList.remove('hidden');
        signInLink?.classList.add('hidden');
      }
    } catch { /* localStorage unavailable */ }
  }
  paintCachedAvatar();

  async function paint(hasSession: boolean, sessionUser?: { id: string; email?: string; user_metadata?: Record<string, unknown> }) {
    if (signInLink) signInLink.classList.toggle('hidden', hasSession);
    if (avatarWrap) avatarWrap.classList.toggle('hidden', !hasSession);
    if (!hasSession) {
      try { localStorage.removeItem(AVATAR_CACHE_KEY); localStorage.removeItem(AVATAR_NAME_KEY); } catch { /* ignore */ }
      return;
    }
    if (!avatarImg) return;
    if (sessionUser) {
      const meta = (sessionUser.user_metadata ?? {}) as Record<string, string | undefined>;
      const fastSrc = meta.picture || meta.avatar_url;
      const fastName = meta.full_name || meta.name || meta.user_name || sessionUser.email?.split('@')[0] || '?';
      if (fastSrc) {
        avatarImg.src = fastSrc;
        avatarImg.alt = fastName;
      } else if (!avatarImg.src) {
        avatarImg.src = initialsAvatar(fastName);
        avatarImg.alt = fastName;
      }
    }
    try {
      const supabase = getSupabase();
      const userId = sessionUser?.id;
      if (!userId) return;
      const { data: profile } = await supabase
        .from('users')
        .select('username,display_name,avatar_url')
        .eq('id', userId)
        .maybeSingle<Pick<UserProfile,'username'|'display_name'|'avatar_url'>>();
      const name = profile?.display_name || profile?.username || sessionUser?.email?.split('@')[0] || '?';
      const finalSrc = profile?.avatar_url || avatarImg.src || initialsAvatar(name);
      avatarImg.src = finalSrc;
      avatarImg.alt = name;
      try { localStorage.setItem(AVATAR_CACHE_KEY, finalSrc); localStorage.setItem(AVATAR_NAME_KEY, name); } catch { /* ignore */ }
    } catch { /* env not set */ }
  }

  (async () => {
    try {
      const { data: { session } } = await getSupabase().auth.getSession();
      await paint(!!session, session?.user as Parameters<typeof paint>[1]);
      getSupabase().auth.onAuthStateChange((_evt, s) => paint(!!s, s?.user as Parameters<typeof paint>[1]));
    } catch { /* env not set */ }
  })();

  avatarBtn?.addEventListener('click', (e) => { e.stopPropagation(); avatarMenu?.classList.toggle('hidden'); });
  document.addEventListener('click', () => avatarMenu?.classList.add('hidden'));
  signOutBtn?.addEventListener('click', async () => { await signOut(); window.location.reload(); });
</script>
```

- [ ] **Step 10.2 — Add Tailwind safelist for the dynamic accent classes**

Open `tailwind.config.cjs` (or `.mjs`/`.ts` — whichever exists at the repo root) and add to its `safelist` array (create the array if it doesn't exist):

```js
safelist: [
  'text-emerald-600', 'dark:text-emerald-400', 'after:bg-emerald-500',
  'text-teal-600',    'dark:text-teal-400',    'after:bg-teal-500',
  'text-sky-600',     'dark:text-sky-400',     'after:bg-sky-500',
  'text-stone-600',   'dark:text-stone-400',   'after:bg-stone-500',
  'after:scale-x-0', 'after:scale-x-100',
],
```

If no Tailwind config file exists yet, the project is using Astro's `@astrojs/tailwind` defaults. In that case, generate one:

```bash
npx tailwindcss init
```

…and add the `safelist` block above.

- [ ] **Step 10.3 — Build to verify the new chrome compiles**

```bash
npm run build
```

Expected: PASS. If you see "Cannot find module './MegaMenu.astro'" or similar, ensure tasks 7–9 were committed and the components exist on disk.

- [ ] **Step 10.4 — Run typecheck + unit tests**

```bash
npm run typecheck && npm run test
```

Expected: green.

- [ ] **Step 10.5 — Manual smoke**

```bash
npm run dev
```

Open `http://localhost:4321/en/observe/` in a desktop browser. Confirm:
- Lockup shows wordmark + tagline (md+)
- "Observe" nav item shows the emerald rail underline
- Hovering "Docs" opens a 3-column mega-menu
- Clicking "Explore" opens a 4-item dropdown

Open the same URL in DevTools mobile emulation (≤sm). Confirm:
- Slim top header with logo + bell + ≡
- Bottom bar at the bottom with FAB visible
- Tapping ≡ opens the right-side drawer
- The FAB has a yellow ⚡ badge and "Quick ID" caption (because we're on /observe)

Stop the dev server.

- [ ] **Step 10.6 — Commit**

```bash
git add src/components/Header.astro tailwind.config.cjs
git commit -m "feat(chrome): rewrite Header with verb-first split, active rail, mega-menu, mobile branch"
```

---

## Task 11 — Wire `MobileBottomBar` into `BaseLayout`

**Files:**
- Modify: `src/layouts/BaseLayout.astro`

> The bottom bar is rendered _by the Header component_ in this PR (Task 10
> already imports both). `BaseLayout` only needs the body padding fix so
> page content isn't occluded under the bar on mobile.

- [ ] **Step 11.1 — Update `src/layouts/BaseLayout.astro`**

Replace the file with:

```astro
---
import Header from '../components/Header.astro';
import Footer from '../components/Footer.astro';
import InstallPwaButton from '../components/InstallPwaButton.astro';
import ReportIssueButton from '../components/ReportIssueButton.astro';

interface Props {
  title: string;
  description?: string;
  lang?: string;
}

const { title, description = 'Species identification platform', lang = 'en' } = Astro.props;
const currentPath = Astro.url.pathname;
const installLang: 'en' | 'es' = lang === 'es' ? 'es' : 'en';
---

<!doctype html>
<html lang={lang} class="dark">
  <head>
    <meta charset="UTF-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1.0" />
    <meta name="description" content={description} />
    <link rel="icon" type="image/svg+xml" href={`${import.meta.env.BASE_URL}favicon.svg`} />
    <link rel="manifest" href={`${import.meta.env.BASE_URL}manifest.webmanifest`} />
    <meta name="theme-color" content="#10b981" />
    <meta name="apple-mobile-web-app-capable" content="yes" />
    <meta name="apple-mobile-web-app-status-bar-style" content="black-translucent" />
    <title>{title}</title>
    <script is:inline>
      (function() {
        const theme = localStorage.getItem('theme');
        if (theme === 'light') {
          document.documentElement.classList.remove('dark');
        } else {
          document.documentElement.classList.add('dark');
        }
      })();
    </script>
    <script is:inline>
      if ('serviceWorker' in navigator && location.hostname !== 'localhost' && location.hostname !== '127.0.0.1') {
        window.addEventListener('load', () => {
          navigator.serviceWorker.register('/sw.js').catch(() => {});
        });
      }
    </script>
  </head>
  <body class="min-h-screen bg-white text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100 transition-colors pb-20 sm:pb-0">
    <Header lang={lang} currentPath={currentPath} />
    <main class="max-w-5xl mx-auto px-4 py-8">
      <slot />
    </main>
    <Footer lang={lang} />
    <InstallPwaButton lang={installLang} />
    <ReportIssueButton lang={lang} />
  </body>
</html>
```

> The only line that changed: `class="..."` on `<body>` now ends with `pb-20 sm:pb-0` to reserve space for the bottom bar on mobile while keeping desktop unchanged.

- [ ] **Step 11.2 — Run build**

```bash
npm run build
```

Expected: PASS.

- [ ] **Step 11.3 — Commit**

```bash
git add src/layouts/BaseLayout.astro
git commit -m "feat(layout): reserve mobile bottom-bar space (pb-20 sm:pb-0)"
```

---

## Task 12 — Update e2e suite

**Files:**
- Modify: `tests/e2e/nav.spec.ts`

- [ ] **Step 12.1 — Update the `ROUTES` table to include the new explore subroutes**

Replace the `ROUTES` constant near the top of `tests/e2e/nav.spec.ts` with:

```ts
const ROUTES: Record<'en' | 'es', string[]> = {
  en: [
    '/en/',
    '/en/identify/',
    '/en/observe/',
    '/en/explore/',
    '/en/explore/map/',
    '/en/explore/recent/',
    '/en/explore/watchlist/',
    '/en/explore/species/',
    '/en/about/',
    '/en/docs/',
    '/en/sign-in/',
    '/en/profile/',
  ],
  es: [
    '/es/',
    '/es/identificar/',
    '/es/observar/',
    '/es/explorar/',
    '/es/explorar/mapa/',
    '/es/explorar/recientes/',
    '/es/explorar/seguimiento/',
    '/es/explorar/especies/',
    '/es/acerca/',
    '/es/docs/',
    '/es/ingresar/',
    '/es/perfil/',
  ],
};
```

- [ ] **Step 12.2 — Append new test cases at the end of the `test.describe('navigation', ...)` block**

Add these tests (immediately before the closing `});` of the existing `test.describe`):

```ts
test('active section rail highlights Observe on /observe', async ({ page }) => {
  await page.goto('/en/observe/');
  // The link gets the emerald color class when active.
  const link = page.locator('header nav a[href="/en/observe/"]').first();
  await expect(link).toHaveClass(/text-emerald-600/);
});

test('docs mega-menu mounts on click', async ({ page }) => {
  await page.goto('/en/');
  const docsBtn = page.locator('#megamenu-docs-btn');
  await docsBtn.click();
  // The mega-menu uses 3 columns; just assert one known item is visible.
  await expect(page.locator('#megamenu-docs-menu a[href="/en/docs/architecture/"]')).toBeVisible();
});

test('explore dropdown reveals 4 sub-items', async ({ page }) => {
  await page.goto('/en/');
  const expBtn = page.locator('#hdr-explore-btn');
  await expBtn.click();
  await expect(page.locator('#hdr-explore-menu a[href="/en/explore/recent/"]')).toBeVisible();
  await expect(page.locator('#hdr-explore-menu a[href="/en/explore/watchlist/"]')).toBeVisible();
  await expect(page.locator('#hdr-explore-menu a[href="/en/explore/species/"]')).toBeVisible();
});

test('legacy /profile/watchlist redirects to /explore/watchlist', async ({ page }) => {
  // Astro emits a meta-refresh redirect for static-build redirects; following
  // it should land us on the new path.
  await page.goto('/en/profile/watchlist');
  await page.waitForURL(/\/en\/explore\/watchlist\/?$/, { timeout: 5000 });
});
```

And, in `tests/e2e/mobile.spec.ts`, add these mobile-specific tests inside the existing `test.describe`:

```ts
test('mobile bottom bar is visible and FAB targets observe by default', async ({ page }) => {
  await page.goto('/en/explore/map/');
  const fab = page.locator('#mobile-bottom-bar a[data-tour="fab"]');
  await expect(fab).toBeVisible();
  await expect(fab).toHaveAttribute('href', '/en/observe/');
});

test('FAB on /observe targets /identify (quick id) with badge', async ({ page }) => {
  await page.goto('/en/observe/');
  const fab = page.locator('#mobile-bottom-bar a[data-tour="fab"]');
  await expect(fab).toHaveAttribute('href', '/en/identify/');
  await expect(fab.locator('span:has-text("⚡")')).toBeVisible();
});

test('hamburger opens the mobile drawer', async ({ page }) => {
  await page.goto('/en/');
  await page.locator('#mobile-menu-toggle').click();
  await expect(page.locator('#mobile-drawer')).toBeVisible();
  await page.locator('#mobile-drawer-close').click();
  await expect(page.locator('#mobile-drawer')).toBeHidden();
});
```

> Open `tests/e2e/mobile.spec.ts` to confirm the existing `test.describe(...)` pattern; insert the three tests inside the same block so they inherit the `mobile-chrome` project's viewport.

- [ ] **Step 12.3 — Run the e2e suite locally**

```bash
npm run build && npm run test:e2e
```

Expected: PASS — all existing tests still green, the 4 new desktop tests pass, the 3 new mobile tests pass.

If a test fails:
- Active-state test: most often the safelist in `tailwind.config.cjs` is missing — see Task 10.2.
- Redirect test: confirm Astro emitted a redirect HTML at `dist/en/profile/watchlist/index.html`.
- Drawer test: confirm `MobileDrawer.astro` registers the `__rastrumOpenDrawer` window hook and `Header.astro`'s hamburger button calls it.

- [ ] **Step 12.4 — Commit**

```bash
git add tests/e2e/nav.spec.ts tests/e2e/mobile.spec.ts
git commit -m "test(e2e): cover new chrome — active rail, mega-menu, FAB target shift, drawer, watchlist 301"
```

---

## Task 13 — Final verification + roadmap entry

**Files:**
- Modify: `docs/progress.json`
- Modify: `docs/tasks.json`

- [ ] **Step 13.1 — Run the full pre-PR check**

```bash
npm run typecheck
npm run test
npm run build
```

Expected: all three green. Page count should now be 63 (was 57: +3 EN explore + +3 ES explorar).

- [ ] **Step 13.2 — Add a roadmap entry**

Open `docs/progress.json` and add a new item under the appropriate phase (look for the section that matches "v1.x — quality of life" or whichever phase is ongoing; replicate the shape of an existing entry):

```json
{
  "id": "ux-revamp-pr1-ia-chrome",
  "title":     "UX revamp PR 1: IA + chrome rebuild",
  "title_es":  "Renovación UX PR 1: arquitectura + chrome",
  "status":    "shipped",
  "summary":     "Verb-first header, mobile bottom-bar with camera FAB, /explore/{recent,watchlist,species} placeholders, watchlist 301.",
  "summary_es":  "Encabezado por verbos, barra inferior móvil con FAB de cámara, placeholders /explorar/{recientes,seguimiento,especies}, redirección 301 de seguimiento."
}
```

- [ ] **Step 13.3 — Add the corresponding tasks.json entry**

Open `docs/tasks.json` and append a matching breakdown:

```json
{
  "id": "ux-revamp-pr1-ia-chrome",
  "subtasks": [
    { "title": "chrome-mode + chrome-helpers + routeTree (TDD)" },
    { "title": "i18n strings for tagline, explore dropdown, docs groups, drawer, bottom bar" },
    { "title": "Explore subroute placeholder pages (en+es)" },
    { "title": "301 redirect for /profile/watchlist" },
    { "title": "MegaMenu, MobileBottomBar, MobileDrawer components" },
    { "title": "Header.astro rewrite + Tailwind safelist for accent classes" },
    { "title": "BaseLayout pb-20 sm:pb-0 for mobile bottom-bar clearance" },
    { "title": "e2e coverage: active rail, mega-menu, FAB target, drawer, watchlist 301" }
  ]
}
```

- [ ] **Step 13.4 — Commit**

```bash
git add docs/progress.json docs/tasks.json
git commit -m "docs(progress): note UX revamp PR 1 — IA + chrome rebuild"
```

- [ ] **Step 13.5 — Open the PR**

```bash
git push -u origin HEAD
gh pr create --title "feat(chrome): UX revamp PR 1 — IA + chrome rebuild" --body "$(cat <<'EOF'
## Summary
- Verb-first desktop header (Observe / Explore ▾ / Chat | About / Docs ▾) with active-section rail and tagline lockup
- Mobile bottom bar with center camera FAB; FAB shifts to ⚡ Quick ID on /observe
- New `/explore/{recent,watchlist,species}` placeholder pages (EN + ES)
- 301 redirect for `/profile/watchlist` → `/explore/watchlist`
- New helpers: `chrome-mode`, `chrome-helpers`, `routeTree`

Spec: `docs/superpowers/specs/2026-04-26-ux-revamp-design.md` (PR 1 of 5).

## Test plan
- [x] `npm run typecheck`
- [x] `npm run test` (all unit tests pass; +28 new cases)
- [x] `npm run build` (page count 57 → 63, EN/ES paired)
- [x] `npm run test:e2e` (chromium + mobile-chrome)
- [ ] Manual smoke: desktop active rail, mega-menu hover, mobile drawer + FAB ⚡ on /observe

🤖 Generated with [Claude Code](https://claude.com/claude-code)
EOF
)"
```

> **Don't push to `main` directly.** This repo is solo-developed but the
> spec calls for each PR to ship as a discrete review, so let CI run on
> the branch first.

---

## Spec coverage check

| Spec section | Tasks |
|---|---|
| §1 IA — new explore routes | Tasks 4, 5 |
| §1 IA — watchlist 301 | Task 6 |
| §1 IA — `routeTree` foundation | Task 2 |
| §2 Desktop chrome — verb-first split | Task 10 |
| §2 Desktop chrome — active rail | Tasks 3, 10 |
| §2 Desktop chrome — tagline lockup | Tasks 4, 10 |
| §2 Desktop chrome — Docs mega-menu | Tasks 4, 7, 10 |
| §2 Desktop chrome — Explore dropdown | Tasks 4, 10 |
| §2 Per-section accent rail (initial wiring) | Task 10 |
| §3 Mobile — bottom bar 5/4-slot | Task 8 |
| §3 Mobile — FAB rule + ⚡ badge | Tasks 3, 8 |
| §3 Mobile — drawer | Task 9 |
| §3 Mobile — `pb-20 sm:pb-0` clearance | Task 11 |
| §3 Mobile — `chromeMode` foundation | Task 1 |
| Acceptance — no broken URLs | Task 6 (redirect) + Tasks 5, 12 (e2e ROUTES) |
| Acceptance — EN/ES parity | Task 4 (parity check) |
| Acceptance — Playwright e2e | Task 12 |

The Account hub, real footer, breadcrumbs, command palette, and
onboarding tour are explicitly **out of scope** for PR 1 per the spec's
phasing section, and will be addressed in PRs 2–5.
