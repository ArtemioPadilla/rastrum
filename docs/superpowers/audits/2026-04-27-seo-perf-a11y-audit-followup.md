# Rastrum Post-PR SEO/Perf/A11y Re-Verification
**Date:** 2026-04-27
**Branch / tip:** `feat/seo-followup-and-audit` @ `e75f83c` (PR-A + PR-B + PR-C merged into main)

## Executive summary

PR-A (critical hygiene: robots.txt, apple-touch-icon, manifest lang, typecheck fix), PR-B (per-page canonical/hreflang/OG/Twitter/descriptions), and PR-C (sitemap hreflang + JSON-LD + Phase 5 polish) together deliver a near-complete SEO baseline. SEO holds at 100 across all 5 audited URLs. A11y improved meaningfully — `/en/observe/` rose from 91→95 (the unlabeled `<select>` fixed), `/en/docs/vision/` held at 90 (one remaining `color-contrast` item). Performance is unchanged: every URL scores 98–100 with LCP ≤ 0.6s, CLS ≤ 0.087, TBT 0ms. Two a11y issues remain: `color-contrast` (text-zinc-400 on dark bg, across all 5 pages) and `link-in-text-block` (inline links in vision docs). Build now produces 80 pages (up from 78). New baseline established.

## Lighthouse scores (delta vs baseline)

| URL | Perf | A11y | Best | SEO | LCP | CLS | TBT | A11y delta |
|---|---:|---:|---:|---:|---:|---:|---:|---:|
| `/en/` | 100 | 95 | 100 | 100 | 0.5s | 0 | 0ms | → (unchanged) |
| `/es/` | 100 | 95 | 100 | 100 | 0.5s | 0 | 0ms | → (unchanged) |
| `/en/docs/vision/` | 100 | 90 | 100 | 100 | 0.5s | 0 | 0ms | → (unchanged) |
| `/en/identify/` | 98 | 95 | 100 | 100 | 0.6s | 0.087 | 0ms | → (unchanged) |
| `/en/observe/` | 100 | 95 | 96 | 100 | 0.6s | 0.039 | 0ms | +4 (select-name fixed) |

Baseline (pre-PR-A): `/en/observe/` was 91; all others as shown. The `select-name` violation on `/en/observe/` is resolved. The `best-practices` score on `/en/observe/` (96) is unchanged from baseline — not regressed by PRs.

## Remaining a11y violations

- `color-contrast` — all 5 URLs. Offending elements:
  - `/en/` and `/es/`: CTA button `bg-emerald-600 text-white` (1 item each)
  - `/en/docs/vision/`: `text-zinc-600 dark:text-zinc-600 dark:text-zinc-400` paragraph (1 item)
  - `/en/identify/` and `/en/observe/`: `text-amber-700 border-amber-300` skip button (1 item each)
  - Fix: bump CTA button to `bg-emerald-700` or use `text-white font-semibold`; switch amber-700 to amber-800; fix zinc-600 duplicate dark class.
- `link-in-text-block` — `/en/docs/vision/` only (4 items). Inline anchor links in the TOC use color alone with no underline. Fix: add `underline` decoration to `<a>` elements in prose blocks. (See audit finding M2.)

Expected a11y ≥ 98 on all 5 URLs after these two fixes land.

## JSON-LD coverage

All pages verified with node HTML parse — zero parse errors.

| Page | JSON-LD blocks | Types |
|---|---:|---|
| `dist/index.html` (noindex transit) | 0 | — |
| `dist/en/index.html` | 2 | Organization, WebSite |
| `dist/es/index.html` | 2 | Organization, WebSite |
| `dist/en/observe/index.html` | 1 | Organization |
| `dist/en/docs/architecture/index.html` | 2 | Organization, BreadcrumbList |

Result: matches expected coverage exactly. No parse errors on any page.

## Sitemap hreflang

- **78 total URL entries** in `dist/sitemap-0.xml`
- **31 URLs have hreflang** annotations (docs pages + root + homepages)
- **47 URLs have no hreflang** — these are app pages (observe, identify, explore/*, profile/*, sign-in, faq, privacy, terms as top-level shortcuts) that do not yet have hreflang alternates in the sitemap config

The hreflang-free group includes all the app pages like `/en/observe/`, `/en/identify/`, `/en/explore/*`, and `/en/profile/*`. Their ES counterparts exist (`/es/observar/`, `/es/identificar/`, etc.) but are not cross-linked in the sitemap. This is a pre-existing gap — the `astro.config.mjs` sitemap `i18n` block only covers the pages registered in the sitemap's route map (docs + homepages). The observe/identify/explore pages need their EN/ES slug pairs added to the sitemap `i18n` customPages config to get hreflang annotations.

Sample entry for `/en/observe/`: no `xhtml:link` alternates present. Docs pages (e.g., `/en/docs/architecture/`) correctly show two `xhtml:link` alternates.

## What's next

- **`color-contrast` fix** (all 5 pages): bump emerald CTA, amber skip button, fix zinc-600 dark duplicate. Estimated +4–5 a11y points → a11y=100 on all pages.
- **`link-in-text-block` fix** (`/en/docs/vision/`): add `underline` to inline prose links in `DocLayout.astro`.
- **Sitemap hreflang for app pages**: extend sitemap `i18n` config to cover observe/identify/explore/profile route pairs.
- ~~**Phase 3 bundle slim** (deferred): Phi-vision dynamic-import audit — still the largest bundle risk (~6 MB lazy chunk).~~ **Investigated 2026-04-28 — already optimal.** All 20 source-level imports of `local-ai`/WebLLM use `await import(...)` inside async functions. The 5.8 MB `dist/_astro/index.DFLBea7M.js` chunk is referenced from ZERO HTML pages (no `<script>`, no `modulepreload`) and is NOT in the service worker's `SHELL` precache list. It only downloads when a user explicitly opts in to local AI (Profile → AI settings → Download model). Lighthouse perf=100 reflects this — the chunk does not affect first-paint or any deferred-load budget. Added `src/lib/static-imports.test.ts` as a regression guard so accidental static imports of `@mlc-ai/web-llm` or `local-ai` fail the test suite. Tree-shaking the WebLLM SDK below 5.8 MB would require deep upstream surgery and is not in scope.
- **Identify-overhaul C1/I1/I2** (`phi_skip_hint` hardcoded, `LOCAL_AI_OPTIN` not respected, source tooltip anchors): out of scope here, tracked in identify-overhaul branch.
- **CLS on `/en/identify/`** (0.087, approaching 0.1 threshold): reserve min-height on cascade results panel.
