# Admin Console — Chrome Rendering Invariant

> Why every `/console/*` and `/consola/*` page must use `ConsoleLayout`,
> never `BaseLayout` directly. Background reading for anyone touching the
> 70+ console pages or adding a new one.

## TL;DR

- **Pages**: `src/pages/{en,es}/{console,consola}/**/index.astro` — wrap
  page bodies in `ConsoleLayout`, not `BaseLayout`.
- **Layout**: `src/components/ConsoleLayout.astro` — owns the sidebar,
  role pills, header chrome, and keybindings. No public `Header.astro` /
  `Footer.astro`.
- **Detection**: `BaseLayout.astro` calls `resolveChromeMode()` on the
  current path and emits `console.warn(...)` at build time if a
  console-prefixed path slipped through to it. Fix any such warning by
  switching the page to `ConsoleLayout`.

## What renders where

`ConsoleLayout` server-renders three role-scoped tab lists:

```html
<aside data-console-sidebar>
  <ul data-role="admin">    … 28 admin tabs … </ul>
  <ul data-role="moderator">… 5 mod tabs … </ul>
  <ul data-role="expert">   … 5 expert tabs … </ul>
</aside>
```

Plus three role pills in the header:

```html
<nav data-console-pills>
  <a data-console-pill="admin"    class="hidden …">Admin</a>
  <a data-console-pill="moderator" class="hidden …">Moderation</a>
  <a data-console-pill="expert"   class="hidden …">Expert</a>
</nav>
```

All three lists + all three pills start hidden. A client script in the
layout reads `await getUserRoles(user.id)` and:

1. Removes `hidden` from the pill for each role the user holds.
2. Picks the active role from `?role=…` (or the first held role) and
   reveals only that role's `<ul data-role="...">`.
3. Styles the active pill with the role's accent (`bg-emerald-700` for
   admin, `bg-amber-600` for moderator, `bg-sky-700` for expert).

This means the HTML is byte-stable across all users — only CSS class
flips happen client-side. No layout shift, no flash of wrong sidebar.

## Why we don't pre-resolve roles at build time

Astro is configured for **static output** (`output: 'static'`). At build
time we have no idea who is signed in. Server-rendering all three role
lists once and hiding the inactive ones is the cheapest correct
solution — total per-page overhead is ~3 KB of compressed HTML.

The alternative (lazy-loading the sidebar via JS after auth resolves)
would cause a ~200 ms blank-sidebar flash on every nav. Not worth it.

## When adding a new console tab

The contract is described in [`CLAUDE.md` § "Console / privileged
surfaces"](../../CLAUDE.md). One entry in `src/lib/console-tabs.ts`,
one route pair in `src/i18n/utils.ts`, one EN page, one ES page. Both
pages **must** wrap their content in `ConsoleLayout`:

```astro
---
import ConsoleLayout from '../../../../components/ConsoleLayout.astro';
import ConsoleNewTabView from '../../../../components/ConsoleNewTabView.astro';
const lang = 'en';
---
<ConsoleLayout lang={lang} title="New tab — Console">
  <ConsoleNewTabView lang={lang} />
</ConsoleLayout>
```

If you accidentally use `BaseLayout`, you'll see a `console.warn` in
`npm run build` output. Fix it before merging.

## Verifying the chrome ships in `dist/`

```bash
npm run build
grep -c 'data-console-pill\|<aside' dist/en/console/index.html
grep -c 'data-console-pill\|<aside' dist/en/console/anomalies/index.html
```

Both lines should return non-zero (the sidebar markup is one minified
line, so a count of 1 is normal). If either returns 0, the page is
missing console chrome.
