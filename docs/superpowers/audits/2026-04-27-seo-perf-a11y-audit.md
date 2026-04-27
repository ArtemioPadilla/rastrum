# Rastrum SEO + Performance + A11y Audit & Optimization Plan

**Audit date:** 2026-04-27
**Branch / tip:** `main` @ `3ae9532` ("feat(ux): sync visibility + form forgiveness + try-again + GPS recovery")
**Build:** 78 pages built in 5.65s
**Tools run:** `npm run typecheck`, `npm run build`, `npm run test:lhci` (5 URLs), `npm run test:e2e` (chromium + mobile-chrome)

---

## Executive summary

Rastrum's runtime performance and Core Web Vitals are **excellent** — Lighthouse scores all 5 audited URLs at perf 98–100, LCP 0.4–0.6s, CLS ≤ 0.083, TBT 0ms. The recently-shipped SEO root page has complete metadata (hreflang, OG, Twitter, robots, canonical). E2E suite is green (79 passed, 10 intentionally skipped, 0 failed).

The **biggest gaps** are below the surface of Lighthouse's SEO category — Lighthouse-SEO scores 100 on every URL, but it only checks shallow signals (has title, has description, mobile viewport, no `noindex`). Real-world SEO has 4 measurable problems:

1. **Locale homepages and deep pages are missing canonical, hreflang, Open Graph, Twitter cards, and JSON-LD structured data.** Only the root has the full kit. /en/ and /es/ — the actual indexable canonical pages — render with title + description only.
2. **The auto-generated sitemap has zero hreflang annotations** despite the bilingual structure. `@astrojs/sitemap` does not emit i18n alternates by default; needs `i18n` config block.
3. **No `robots.txt` exists** anywhere. Search engines can't discover the sitemap location.
4. **Deep pages (observe, identify, about, docs) share the same generic 31-character description** ("Species identification platform"). Each page should have a unique, keyword-rich, 120–160-char description for SERP CTR.

Non-SEO findings worth noting:

- **Typecheck currently fails** on `main` — `camera_trap.id_pipeline_generic` is in one of `i18n/{en,es}.json` and not the other. EN/ES parity break introduced in commit `3ae9532`.
- **One JS bundle is ~6 MB** (`dist/_astro/index.DFLBea7M.js`). Almost certainly includes the WebLLM/Phi-vision runtime; should be lazy-loaded only when the user opts in to local AI.
- **Color-contrast a11y violation on every audited page** — zinc-400/500 text on the very dark background fails WCAG AA.
- **No `apple-touch-icon` link** on any page. iOS Add-to-Home will use a default icon.
- **No JSON-LD on any of 80 pages.** Missed opportunity for Organization, WebSite (sitelinks search box), and BreadcrumbList rich results.

---

## Lighthouse scores

| URL | Perf | A11y | Best | SEO | LCP | CLS | TBT |
|---|---:|---:|---:|---:|---:|---:|---:|
| `/en/` | 100 | **95** | 100 | 100 | 0.5s | 0.005 | 0ms |
| `/es/` | 100 | **95** | 100 | 100 | 0.5s | 0.005 | 0ms |
| `/en/docs/vision/` | 100 | **90** | 100 | 100 | 0.5s | 0 | 0ms |
| `/en/identify/` | 98 | **95** | 100 | 100 | 0.6s | 0.083 | 0ms |
| `/en/observe/` | 100 | **91** | **96** | 100 | 0.6s | 0.045 | 0ms |

(Bold = sub-100. All Core Web Vitals well under thresholds.)

---

## Playwright e2e

- **79 passed**, **10 skipped** (intentional — PWA SW + offline tests), **0 failed**
- Runtime: **8.5s**
- No flakes, no retries

---

## SEO findings

### Critical (will hurt rankings, social shares, or both)

#### C1. Locale homepages have no `<link rel="canonical">`, no `hreflang`, no Open Graph, no Twitter cards, no JSON-LD
**Files:** `src/layouts/BaseLayout.astro` (the layout used by every locale-prefixed page)

`dist/en/index.html` `<head>` only contains:
```html
<title>Rastrum — Identify any living thing — anywhere</title>
<meta name="description" content="Open-source biodiversity identification platform for Latin America">
```

That's it. No `<link rel="canonical" href="https://rastrum.org/en/">`, no `<link rel="alternate" hreflang="es" href="...">`, no `<meta property="og:image">`. Same for `/es/` and every deeper page.

When a crawler indexes `https://rastrum.org/en/`, it has no signal that `https://rastrum.org/es/` is the Spanish alternate, so:
- Searches in Spanish may surface `/en/` instead of `/es/`
- The ES page may be deduplicated or treated as low-quality
- Any social link to /en/ renders as a thin bookmark with no preview image (no OG)

#### C2. Sitemap emits 78 URLs but zero `hreflang` annotations
**File:** `astro.config.mjs` line 11 (`integrations: [tailwind(), sitemap()]`)

`dist/sitemap-0.xml`:
```xml
<url><loc>https://rastrum.org/en/</loc></url>
<url><loc>https://rastrum.org/es/</loc></url>
```

Should be:
```xml
<url>
  <loc>https://rastrum.org/en/</loc>
  <xhtml:link rel="alternate" hreflang="en" href="https://rastrum.org/en/" />
  <xhtml:link rel="alternate" hreflang="es" href="https://rastrum.org/es/" />
  <xhtml:link rel="alternate" hreflang="x-default" href="https://rastrum.org/en/" />
</url>
```

`@astrojs/sitemap` supports this via the `i18n` integration option, but the project passes `sitemap()` with no args. The generated sitemap is a flat URL list with no language relationships.

#### C3. No `robots.txt` exists at all
**Path expected:** `public/robots.txt` or `dist/robots.txt`

Result: search engines crawl `rastrum.org/robots.txt` → 404. They proceed to crawl everything (default behavior, which is fine), but they don't know the sitemap location. They'll eventually find it via Search Console submission, but `robots.txt` should bridge the gap for crawlers that haven't been told.

Recommended:
```
User-agent: *
Allow: /

Sitemap: https://rastrum.org/sitemap-index.xml
```

#### C4. Deep pages share a single generic description
**Files:** Every `src/pages/{en,es}/**/*.astro` that doesn't override `description`

Per-page description coverage:
- `/en/observe/`: `"Species identification platform"` (31 chars)
- `/en/identify/`: `"Species identification platform"` (31 chars)
- `/en/about/`: `"Species identification platform"` (31 chars)
- `/en/docs/architecture/`: `"Species identification platform"` (31 chars)
- `/en/docs/vision/`: `"Species identification platform"` (31 chars)

Default description is set in `BaseLayout.astro:13` — every page that doesn't override it gets this generic stub. Optimal length is 120–160 characters with primary keywords. Currently:
- Too short to fill the SERP snippet (which is ~155 chars wide)
- Identical descriptions on multiple pages = duplicate content signals
- "Species identification platform" doesn't tell a searcher what the page is *about*

### Important (best-practice gaps with measurable upside)

#### I1. No JSON-LD structured data on any of 80 pages
**Coverage:** `0/80`

Recommended additions:
- `Organization` on all pages (or at minimum the locale homepages) — gets the brand into Google's Knowledge Graph
- `WebSite` with `potentialAction: SearchAction` on the locale homepages — enables sitelinks search box for branded queries
- `Article` or `TechArticle` on each `/docs/*` page — enables rich result eligibility
- `BreadcrumbList` on deep pages — builds the breadcrumb trail in SERP snippets

#### I2. No `apple-touch-icon` link on any page
**Files:** `src/layouts/BaseLayout.astro` (where `<link rel="icon">` is declared)

iOS Add-to-Home reads `<link rel="apple-touch-icon">` (typically 180×180 PNG). The project has `public/rastrum-logo-240.png` and `-120.png` — easy fix:
```html
<link rel="apple-touch-icon" sizes="180x180" href="/rastrum-logo-240.png">
```

#### I3. Locale pages have title-length but description-length issues
| Page | Title len | Desc len | Optimal title 30–60 / desc 120–160 |
|---|---:|---:|---|
| `/` | 45 | 145 | ✅ ✅ |
| `/en/` | 46 | **66** | ✅ ⚠ short |
| `/es/` | 51 | **83** | ✅ ⚠ short |
| `/en/observe/` | 25 | **31** | ⚠ short ❌ generic |
| `/en/about/` | 23 | **31** | ⚠ short ❌ generic |
| `/en/identify/` | 28 | **31** | ✅ ❌ generic |
| `/en/docs/architecture/` | 27 | **31** | ✅ ❌ generic |

Most deep-page titles are under 30 chars (room for keywords + brand suffix) and descriptions are all 31 chars (the default).

### Minor

#### M1. Root index has `noindex,follow` — by design, but verify Search Console accepts it
The root SEO landing was deliberately set to `noindex,follow` so crawlers don't index the transit page itself but follow the alternate links to locale pages. That's the right call. Just verify in Google Search Console that `/` doesn't show up in the Pages → Excluded report as a problem; the "Excluded by 'noindex' tag" reason is normal here.

#### M2. Links in `/en/docs/vision/` rely on color alone (Lighthouse `link-in-text-block`)
Inline links inside paragraphs use the same emerald color but no underline. Users with color blindness can't distinguish them from regular text without hovering.

Fix: either add `text-decoration: underline` to inline links inside content, or `text-decoration: underline` only on hover plus a stronger weight on default (e.g. `font-medium`).

#### M3. `/en/observe/` has a `<select>` without an associated `<label>` (Lighthouse `select-name`)
The new identification-block dropdown introduced by the parallel-cascade work likely. Either wrap it in a `<label>` or use `aria-label`.

#### M4. No on-page indication of language alternates for users
While search engines find the alt-locale via hreflang (when we add it), users on `/en/` have no link to `/es/` other than the chrome's EN/ES toggle. That toggle does exist on every page and works correctly — so this is more of an "assist" than a problem. Worth verifying the toggle is also picked up by translators and language-specific SERPs.

---

## Performance findings

### Critical

#### P1. `dist/_astro/index.DFLBea7M.js` is ~6 MB
**File:** Identified by name; suspect WebLLM Phi-vision runtime + ONNX Runtime Web bundle

```
6013529  dist/_astro/index.DFLBea7M.js   (~5.8 MB)
1053501  dist/_astro/maplibre-gl.DSJDBgxe.js   (~1.0 MB)
 401083  dist/_astro/ort.bundle.min.Bdz_tMam.js   (~390 KB)
 194860  dist/_astro/supabase.Bb4SuA5l.js   (~190 KB)
  97087  dist/_astro/db.COX24XGQ.js   (~95 KB)
```

Total JS shipped to clients: **~8 MB** (uncompressed).

Why Lighthouse still scores perf=100: the LCP is text/CSS-driven and the JS is `<script type="module">` (deferred). It doesn't block first paint. But the JS DOES download for every page that imports it, eating mobile data and battery, even if the user doesn't trigger Phi-vision.

**Mitigation:** WebLLM should be dynamic-imported only when the user clicks "Download AI model". The other agent's identify-overhaul work routed Phi-vision through `lib/identify-runners.ts`. Verify the runner is dynamic-imported and not statically linked from `IdentifyView.astro` or `ObservationForm.astro`. If currently static, switching to `await import('./phi-vision-runner.ts')` removes 6 MB from the initial bundle.

### Important

#### P2. CLS on `/en/identify/` (0.083) approaches the 0.1 threshold
**File:** `src/components/IdentifyView.astro` (likely)

Cause is probably the cascade results panel that grows as identifiers stream in. Each identifier result inserts a row that shifts subsequent content down.

Fix: reserve vertical space with `min-height` on the results container, OR have a skeleton state with the same dimensions as the eventual loaded state.

#### P3. CLS on `/en/observe/` (0.045)
Smaller but visible. Likely the GPS status badge (green dot + text) appearing after the geolocation prompt resolves. Reserve space for it.

#### P4. No `loading="lazy"` on images
Only 2 `<img>` tags on the home page (logo + lockup), so impact is minimal — but the convention should propagate. Specifically `RoadmapView`, `ArchitectureView`, and any future doc pages with embedded screenshots will benefit.

### Minor

#### P5. Total CSS is small (58 KB) and fine
Single `callback.BD8PWiOZ.css` at 59 KB covers the whole site (Tailwind's PurgeCSS works). Nothing to optimize here.

#### P6. The `manifest.webmanifest` declares `lang: "es"` while the site's defaultLocale is `"en"`
Consistency: either change manifest to `"en"`, OR change `astro.config.mjs` `defaultLocale` to `"es"`. Probably the latter (most users are LATAM Spanish speakers per the spec), but that's a bigger behavioral change. For now, just align the manifest with the actual default (currently `"en"` per `astro.config.mjs`).

---

## Accessibility findings

### Important

#### A1. Color-contrast violations on every audited page
**Recurring on:** all 5 audited URLs

Likely culprit: `text-zinc-400` (#a1a1aa) or `text-zinc-500` (#71717a) on `bg-zinc-950` (#09090b) or `bg-white` for muted text. The contrast ratio on the dark theme is around 3.5:1 for zinc-500 on zinc-950 — fails WCAG AA (minimum 4.5:1).

Fix: bump muted text color to `text-zinc-300` (lighter, 7:1 ratio) for body text. For headings/labels at AAA, use `text-zinc-200`. For the truly secondary "fine print," `text-zinc-400` is OK on a `bg-zinc-900` backdrop (lighter background) — verify case-by-case.

#### A2. `link-in-text-block` on docs/vision (and likely other prose docs)
Inline links use color alone to distinguish from text. Add `underline` or `font-medium` to inline links.

#### A3. `select-name` on `/en/observe/`
A `<select>` lacks an associated `<label>`. Either wrap it or add `aria-label`.

---

## Bundle / size analysis

| | Size |
|---|---:|
| Total `dist/` | 38 MB |
| `dist/_astro/` (bundled JS+CSS) | 32 MB |
| Total JS bytes | ~8 MB |
| Total CSS bytes | 58 KB |
| Largest single JS chunk (`index.DFLBea7M.js`) | 5.8 MB |

The 5.8 MB chunk is the dominant cost. Everything else is reasonable for an Astro+Supabase+MapLibre PWA.

---

## What's already good

- **Excellent Core Web Vitals on every audited URL** — LCP <0.6s, CLS ≤0.083, TBT 0ms
- **Root `/` SEO landing** has the full SEO kit (hreflang, OG, Twitter, robots, canonical, JSON-LD-ready)
- **Astro static output + sitemap auto-generation** — 78 URLs in sitemap-0.xml, all valid
- **Manifest is complete** — name, description, scope, start_url, theme/background colors, full icon set with `purpose: "any"` and `purpose: "maskable"`, categories
- **PWA registration** — service worker registered, installable
- **EN/ES route parity** — all 35-ish content paths have both locales
- **Mobile chrome** — bottom bar, FAB, drawer; respects safe-area-inset
- **Playwright e2e green** including PWA, mobile, a11y smoke
- **TypeScript strict mode** — when typecheck passes (currently failing on the camera_trap parity issue)
- **Rebuild time** under 6 seconds; e2e under 9 seconds

---

# Optimization plan

A staged plan, ordered by impact-per-effort. Each phase is independently shippable. Total estimate: **~1.5–2 days** of work spread across phases.

## Phase 0 — Critical hygiene (~30 min)

These are bugs / regressions that block other work.

### 0.1 Fix the typecheck failure
**Effort:** 5 min
`camera_trap.id_pipeline_generic` exists in one of `src/i18n/{en,es}.json` and not the other. Inspect both, add the missing key, run `npm run typecheck` until green.

### 0.2 Add `robots.txt`
**Effort:** 5 min
Create `public/robots.txt`:
```
User-agent: *
Allow: /

Sitemap: https://rastrum.org/sitemap-index.xml
```
Astro copies `public/` to `dist/` at build time — no further config needed.

### 0.3 Add `apple-touch-icon` link to BaseLayout
**Effort:** 5 min
In `src/layouts/BaseLayout.astro:24` (where `<link rel="icon">` lives), add:
```astro
<link rel="apple-touch-icon" sizes="180x180" href={`${import.meta.env.BASE_URL}rastrum-logo-240.png`} />
```

### 0.4 Align manifest `lang` with actual default
**Effort:** 2 min
Change `public/manifest.webmanifest` from `"lang": "es"` to `"lang": "en"` (matches `astro.config.mjs` `defaultLocale: 'en'`).

---

## Phase 1 — On-page SEO metadata for every page (~3–4 hours)

This is the biggest single SEO investment. Every locale-prefixed page needs canonical, hreflang, OG, Twitter, and a unique description.

### 1.1 Extend `BaseLayout.astro` props and head
**Effort:** 1 hour
Modify `src/layouts/BaseLayout.astro` Props:
```ts
interface Props {
  title: string;
  description?: string;
  lang?: string;
  /** Path of this page WITHOUT the locale prefix. Used to compute hreflang alternates. E.g. '/observe/' for /en/observe/. */
  pathKey?: string;
  /** OG image override; defaults to /rastrum-logo-512.png */
  ogImage?: string;
  /** Article-specific Open Graph type override; defaults to 'website' */
  ogType?: 'website' | 'article';
}
```

In the `<head>`, add (computed from `Astro.url.pathname` and the `routes` map from `i18n/utils.ts`):
- `<link rel="canonical" href="https://rastrum.org{pathname}">`
- `<link rel="alternate" hreflang="en" href="...">` for the EN twin
- `<link rel="alternate" hreflang="es" href="...">` for the ES twin
- `<link rel="alternate" hreflang="x-default" href="https://rastrum.org/en{pathkey}">`
- `<meta property="og:type" content={ogType}>`
- `<meta property="og:url" content="https://rastrum.org{pathname}">`
- `<meta property="og:title" content={title}>`
- `<meta property="og:description" content={description}>`
- `<meta property="og:image" content={ogImage}>`
- `<meta property="og:locale" content={lang === 'es' ? 'es_MX' : 'en_US'}>`
- `<meta property="og:locale:alternate" content={lang === 'es' ? 'en_US' : 'es_MX'}>`
- `<meta name="twitter:card" content="summary_large_image">`
- `<meta name="twitter:title" content={title}>`
- `<meta name="twitter:description" content={description}>`
- `<meta name="twitter:image" content={ogImage}>`

The hreflang alternate logic uses the existing route-key swap pattern from `Header.astro` (which already computes `altHref` for the language toggle). Extract that into `i18n/utils.ts` as `getAlternateUrl(currentPath, targetLang)` so both Header and BaseLayout share it.

### 1.2 Per-page descriptions
**Effort:** 1.5 hours
For each page that uses BaseLayout, supply a unique `description` prop. Most live in `src/pages/{en,es}/*.astro`. ~25 pages × 2 locales = ~50 descriptions to write. Examples (EN):
- `/en/observe/`: "Capture biodiversity observations with photos, audio, GPS, and Darwin Core fields. Offline-first, syncs to GBIF and CONABIO when you're back online."
- `/en/identify/`: "Identify any species from a photo using parallel AI cascade — PlantNet, Claude vision, and on-device Phi-vision. No account required."
- `/en/about/`: "Rastrum is an open-source biodiversity observation platform built for Latin America. Multi-modal AI, indigenous-language support, CARE-principles-aligned."
- `/en/docs/architecture/`: "How Rastrum's AI identification pipeline, offline outbox, and Darwin Core export fit together. Block diagram, data flows, and decision rationale."

ES translations follow each EN. Pull primary keywords from `progress.json`'s phase descriptions for consistency.

### 1.3 Update doc pages to pass `description` per-page
**Effort:** 30 min
Doc pages currently use `DocLayout` which wraps `BaseLayout`. Either:
- Add `description` prop to DocLayout, forward to BaseLayout, set per-page in `pages/{en,es}/docs/*.astro`
- Or extract a `docPageMeta` table in `i18n/utils.ts` keyed by docPage slug, look it up in DocLayout

### 1.4 Acceptance check
```bash
npm run build
grep -h '<link rel="canonical"\|hreflang' dist/en/index.html dist/en/observe/index.html dist/en/docs/architecture/index.html
```
Each should now show canonical + at least 3 hreflang alternates.

---

## Phase 2 — Sitemap with hreflang + structured data (~2 hours)

### 2.1 Configure `@astrojs/sitemap` with i18n awareness
**Effort:** 30 min
In `astro.config.mjs`:
```js
import sitemap from '@astrojs/sitemap';

integrations: [
  tailwind(),
  sitemap({
    i18n: {
      defaultLocale: 'en',
      locales: { en: 'en-US', es: 'es-MX' },
    },
    // Optional: filter out auth-only paths
    filter: (page) => !page.includes('/auth/callback'),
  }),
],
```
Result: each `<url>` entry in `dist/sitemap-0.xml` gets `<xhtml:link rel="alternate" hreflang>` annotations automatically.

### 2.2 Add JSON-LD on locale homepages
**Effort:** 45 min
Create `src/components/StructuredData.astro` that emits JSON-LD scripts based on a `type` prop. Three schemas to ship initially:

**Organization** (on every page; could go in BaseLayout):
```json
{
  "@context": "https://schema.org",
  "@type": "Organization",
  "name": "Rastrum",
  "url": "https://rastrum.org",
  "logo": "https://rastrum.org/rastrum-logo-512.png",
  "sameAs": ["https://github.com/ArtemioPadilla/rastrum"]
}
```

**WebSite** with sitelinks-search-box (locale homepages only — `/en/` and `/es/`):
```json
{
  "@context": "https://schema.org",
  "@type": "WebSite",
  "url": "https://rastrum.org/en/",
  "name": "Rastrum",
  "description": "...",
  "inLanguage": "en"
}
```
(Sitelinks-search-box requires a `potentialAction: SearchAction` — defer until command palette ⌘K is shipped, since SearchAction needs a real search URL.)

**BreadcrumbList** on `/docs/*` pages and `/profile/settings/*` (when those land):
```json
{
  "@context": "https://schema.org",
  "@type": "BreadcrumbList",
  "itemListElement": [
    { "@type": "ListItem", "position": 1, "name": "Docs", "item": "https://rastrum.org/en/docs/" },
    { "@type": "ListItem", "position": 2, "name": "Architecture" }
  ]
}
```

### 2.3 Acceptance check
```bash
grep -c 'xhtml:link rel="alternate"' dist/sitemap-0.xml   # should be >= 78
grep -l 'application/ld+json' dist/en/index.html dist/es/index.html dist/en/docs/architecture/index.html
```

---

## Phase 3 — Bundle slimming (~1 hour)

### 3.1 Verify Phi-vision is dynamic-imported
**Effort:** 30 min
Inspect:
```bash
grep -rn "import.*phi-vision\|import.*webllm\|import.*MLCEngine" src/
```
Anywhere these are imported via `import { ... } from '...'` (static), change to `const m = await import('...')` (dynamic). This pulls the 5.8 MB chunk out of the initial bundle so it only downloads when a user actually triggers Phi-vision.

### 3.2 Verify MapLibre lazy-loads
**Effort:** 15 min
The 1 MB `maplibre-gl.DSJDBgxe.js` chunk should only be imported by `ExploreMap.astro`. Verify the import is inside `<script>`-block scope (so it only runs on /explore/map) and not from a top-level shared file.

### 3.3 Acceptance check
```bash
ls -la dist/_astro/*.js | sort -k5 -n | tail -3
```
Largest non-lazy chunk should drop from 5.8 MB to under 1 MB.

---

## Phase 4 — Accessibility fixes (~45 min)

### 4.1 Bump muted text color to meet WCAG AA
**Effort:** 30 min
Audit Tailwind classes used for muted text. Likely candidates to change:
- `text-zinc-400` on dark bg → `text-zinc-300`
- `text-zinc-500` on dark bg → `text-zinc-400` (only when on `bg-zinc-900` lighter wrapper, not `bg-zinc-950`)

Files most likely affected: `Header.astro`, `MobileBottomBar.astro`, `MobileDrawer.astro`, `Footer.astro`, `*View.astro`. Test by re-running Lighthouse on `/en/`, `/es/`, `/en/docs/vision/`, `/en/identify/`, `/en/observe/` — all should reach a11y=100.

### 4.2 Underline inline links inside prose docs
**Effort:** 5 min
In `DocLayout.astro` content slot, add a Tailwind `prose-a:underline` modifier OR a CSS rule scoped to `<main> p a, <main> li a { text-decoration: underline; }`.

### 4.3 Add `aria-label` to the unlabeled `<select>` on `/observe`
**Effort:** 5 min
Find the dropdown introduced by the parallel-cascade work in `ObservationForm.astro`. Add `aria-label={tr.observe.identification_select_label}` (with new i18n key in both en+es).

### 4.4 Reduce CLS on `/identify` (and `/observe`)
**Effort:** 5 min
Add `min-height` to the cascade results panel and the GPS status row so they don't shift content when populated. Lighthouse CLS should drop from 0.083 → <0.02 on `/identify`.

---

## Phase 5 — Cumulative polish (~30 min)

### 5.1 Set explicit `width`/`height` on logo `<img>`
**Effort:** 5 min
In `Header.astro`, `MobileDrawer.astro`, the lockup img already has `class="w-7 h-7"` Tailwind sizing. Add explicit HTML `width="28" height="28"` attrs so browsers reserve space before CSS loads.

### 5.2 Add `loading="lazy"` to below-fold images
**Effort:** 10 min
Currently only 2 `<img>` per page. Future doc-page screenshots / observation thumbnails should default to `loading="lazy"`. Add a comment in `AGENTS.md` "How to add new work" noting the convention.

### 5.3 Add `<meta name="theme-color">` per locale (for Safari iOS)
**Effort:** 3 min
Already has `<meta name="theme-color" content="#10b981">` from BaseLayout. Verify it's emitted on every page (it should be).

### 5.4 Add `<meta name="application-name">` and `<meta name="apple-mobile-web-app-title">`
**Effort:** 5 min
For PWA install discoverability:
```html
<meta name="application-name" content="Rastrum">
<meta name="apple-mobile-web-app-title" content="Rastrum">
```

### 5.5 Submit sitemap to Google Search Console
**Effort:** 5 min (operator task)
Once Phase 2.1 ships, manually submit `https://rastrum.org/sitemap-index.xml` in GSC. Verify it indexes 78 URLs over the following ~7 days.

---

## Phasing summary

| Phase | Theme | Effort | Impact |
|---|---|---:|---|
| 0 | Critical hygiene (typecheck, robots.txt, apple-touch-icon, manifest lang) | 30 min | High (unblocks CI + iOS install) |
| 1 | Per-page metadata (canonical, hreflang, OG, Twitter, descriptions) | 3–4 h | Very high (foundational SEO) |
| 2 | Sitemap hreflang + JSON-LD | 2 h | High (SERP rich results, dedup) |
| 3 | Bundle slimming (Phi-vision lazy import) | 1 h | Medium-high (mobile data, battery) |
| 4 | A11y violations (contrast, links, select, CLS) | 45 min | Medium (Lighthouse → 100, real users) |
| 5 | Polish (img dims, lazy loading, PWA meta) | 30 min | Low-medium |
| | **Total** | **~7–9 h** | |

Recommended PR shape:
- **PR A** — Phase 0 + Phase 4 (small, urgent fixes)
- **PR B** — Phase 1 (metadata) — the big SEO PR
- **PR C** — Phase 2 + Phase 5 (sitemap, JSON-LD, polish)
- **PR D** — Phase 3 (bundle audit) — coordinate with the parallel-cascade agent who owns identify-runners.ts

Or, if you want maximum SEO bang for minimum surface change, do **PR B alone** first and ship — that closes the biggest gap; everything else is incremental.

---

## Raw data appendix

**Build:**
- Pages: 78
- Build time: 5.65s
- Sitemap: `dist/sitemap-index.xml` + `dist/sitemap-0.xml` (78 URLs, 0 hreflang annotations)

**Typecheck:** ❌ FAILING — `camera_trap.id_pipeline_generic` parity break in `i18n/{en,es}.json`

**Lighthouse (5 URLs, score format perf/a11y/best/seo):**
- /en/: 100/95/100/100 — LCP 0.5s, CLS 0.005, TBT 0ms
- /es/: 100/95/100/100 — LCP 0.5s, CLS 0.005, TBT 0ms
- /en/docs/vision/: 100/90/100/100 — LCP 0.5s, CLS 0, TBT 0ms
- /en/identify/: 98/95/100/100 — LCP 0.6s, CLS 0.083, TBT 0ms
- /en/observe/: 100/91/96/100 — LCP 0.6s, CLS 0.045, TBT 0ms

**Lighthouse a11y violations (recurring):**
- `color-contrast` (5/5 pages)
- `link-in-text-block` (1/5: /en/docs/vision/)
- `select-name` (1/5: /en/observe/)

**E2E:** 79 passed, 10 skipped, 0 failed in 8.5s (chromium + mobile-chrome)

**Bundle (largest 5 JS chunks):**
- `index.DFLBea7M.js` 5882 KB — likely WebLLM / Phi-vision runtime
- `maplibre-gl.DSJDBgxe.js` 1029 KB
- `ort.bundle.min.Bdz_tMam.js` 392 KB
- `supabase.Bb4SuA5l.js` 190 KB
- `db.COX24XGQ.js` 95 KB

Total: dist 38 MB, _astro 32 MB, JS 8 MB, CSS 58 KB.

**SEO surface coverage matrix:**
| Page | title | desc | canonical | hreflang | og | twitter | json-ld |
|---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
| / | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✗ |
| /en/ | ✓ | ⚠ short | ✗ | ✗ | ✗ | ✗ | ✗ |
| /es/ | ✓ | ⚠ short | ✗ | ✗ | ✗ | ✗ | ✗ |
| /en/observe/ | ✓ | ⚠ generic | ✗ | ✗ | ✗ | ✗ | ✗ |
| /en/identify/ | ✓ | ⚠ generic | ✗ | ✗ | ✗ | ✗ | ✗ |
| /en/about/ | ✓ | ⚠ generic | ✗ | ✗ | ✗ | ✗ | ✗ |
| /en/docs/architecture/ | ✓ | ⚠ generic | ✗ | ✗ | ✗ | ✗ | ✗ |

**robots.txt:** ✗ ABSENT
**manifest.webmanifest:** ✓ Complete (5 icons, theme/bg colors, scope, start_url, name, description, categories)
**apple-touch-icon:** ✗ on every page
