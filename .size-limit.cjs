// Per-route JS bundle budgets for Rastrum's static Astro build.
//
// Each entry below maps a public route → a budget over the JS chunks
// referenced by that route's emitted `dist/<route>/index.html`.
//
// Why dynamic resolution? Astro emits content-hashed filenames
// (`/_astro/Foo.<hash>.js`) that change every build. Hard-coding paths
// would force us to edit this file on every chunk-name churn. Instead we
// scan the HTML for `/_astro/*.js` references at config-load time so the
// path arrays we hand to size-limit always reflect the real referenced
// set.
//
// Budgets are derived from the current baseline (May 2026) plus ~20%
// headroom rounded to a clean number — see `.size-limit.md` for the
// per-route rationale and the v1.1 override convention.
//
// To rebaseline: run `npm run build`, then `node scripts/bundle-budgets-report.mjs`
// to see current numbers and adjust the `limit` here in the same PR.

const fs = require('node:fs');
const path = require('node:path');

const DIST = path.resolve(__dirname, 'dist');

// Routes covered by the gate. Each entry MUST exist post-build; if Astro
// renames a slug we want to fail loudly so the gate stays honest.
//
// Order matches what we report in $GITHUB_STEP_SUMMARY (home first, then
// the hot paths).
// Limits are brotli-compressed — that's what users actually pay for over
// the network. Baseline (May 2026) sizes + ~20% headroom rounded clean:
//
//   home    34.92 kB → 50 kB
//   observe 48.49 kB → 65 kB
//   console  7.11 kB → 12 kB
//   species 35.02 kB → 50 kB
//   chat    36.58 kB → 50 kB
//
// Override convention: raise a budget in this file with a one-line PR-
// comment justification (see `docs/qa-policy.md` §6). NEVER raise as a
// CI re-run workaround.
const ROUTES = [
  { name: 'home (en)',         html: 'en/index.html',                   limit: '50 KB' },
  { name: 'observe (en)',      html: 'en/observe/index.html',           limit: '65 KB' },
  { name: 'console (en)',      html: 'en/console/index.html',           limit: '12 KB' },
  { name: 'species (en)',      html: 'en/explore/species/index.html',   limit: '50 KB' },
  { name: 'chat (en)',         html: 'en/chat/index.html',              limit: '50 KB' },
];

function chunksFor(htmlRel) {
  const htmlAbs = path.join(DIST, htmlRel);
  if (!fs.existsSync(htmlAbs)) {
    // Treat a missing HTML as a config error rather than silently passing —
    // the gate should never be a no-op.
    throw new Error(
      `[.size-limit.cjs] expected ${htmlAbs} after build; route slug renamed? ` +
      `Update the ROUTES table or run \`npm run build\` first.`,
    );
  }
  const html = fs.readFileSync(htmlAbs, 'utf8');
  const refs = Array.from(html.matchAll(/\/_astro\/[A-Za-z0-9._-]+\.js/g))
    .map(m => m[0])
    .filter((v, i, a) => a.indexOf(v) === i)
    .sort();
  return refs.map(ref => path.join('dist', ref));
}

module.exports = ROUTES.map(r => ({
  name: r.name,
  path: chunksFor(r.html),
  limit: r.limit,
  // Brotli is the default compressor. Astro ships brotli-friendly chunks
  // already and CDN-served bytes are what users actually pay for.
  brotli: true,
}));
