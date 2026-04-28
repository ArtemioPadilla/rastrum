/**
 * Post-build: inject missing hreflang alternates into sitemap-0.xml.
 *
 * @astrojs/sitemap's i18n resolver only pairs URLs whose path structure
 * is identical in both locales (e.g. /en/chat/ ↔ /es/chat/).  App pages
 * with slug-aliased routes (/en/observe/ ↔ /es/observar/) are left
 * unpaired.  This script reads the same routes map used at build time,
 * finds every unpaired <url> that has a known EN↔ES counterpart, and
 * rewrites the XML to inject the correct <xhtml:link> alternates.
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { resolve, dirname } from 'node:path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '..');
const SITEMAP = resolve(ROOT, 'dist/sitemap-0.xml');
const SITE = 'https://rastrum.org';

// ---------------------------------------------------------------------------
// Route pairs: EN slug → ES slug (path only, no locale prefix, no trailing /)
// Mirrors src/i18n/utils.ts `routes` map.
// ---------------------------------------------------------------------------
const ROUTES = {
  '':                        '',         // home
  '/identify':               '/identificar',
  '/explore':                '/explorar',
  '/explore/map':            '/explorar/mapa',
  '/explore/recent':         '/explorar/recientes',
  '/explore/watchlist':      '/explorar/seguimiento',
  '/explore/species':        '/explorar/especies',
  '/explore/validate':       '/explorar/validar',
  '/observe':                '/observar',
  '/about':                  '/acerca',
  '/docs':                   '/docs',
  '/sign-in':                '/ingresar',
  '/profile':                '/perfil',
  '/profile/edit':           '/perfil/editar',
  '/profile/export':         '/perfil/exportar',
  '/profile/observations':   '/perfil/observaciones',
  '/profile/observations/local': '/perfil/observaciones/local',
  '/profile/expert-apply':   '/perfil/aplicar-experto',
  '/profile/validate':       '/perfil/validar',
  '/profile/admin/experts':  '/perfil/admin/expertos',
  '/profile/u':              '/perfil/u',
  '/profile/import':         '/perfil/importar',
  '/profile/import/camera-trap': '/perfil/importar/camara-trampa',
  '/profile/tokens':         '/perfil/tokens',
  '/chat':                   '/chat',
  '/privacy':                '/privacidad',
  '/terms':                  '/terminos',
  '/faq':                    '/preguntas-frecuentes',
};

/** Build lookup: canonical URL → { en, es } absolute URLs */
function buildPairMap() {
  const map = new Map();
  for (const [enSlug, esSlug] of Object.entries(ROUTES)) {
    const enUrl = `${SITE}/en${enSlug}/`;
    const esUrl = `${SITE}/es${esSlug}/`;
    map.set(enUrl, { en: enUrl, es: esUrl });
    map.set(esUrl, { en: enUrl, es: esUrl });
  }
  // Root (locale-neutral) already handled by @astrojs/sitemap
  return map;
}

function hreflangBlock(enUrl, esUrl) {
  return (
    `<xhtml:link rel="alternate" hreflang="en-US" href="${enUrl}"/>` +
    `<xhtml:link rel="alternate" hreflang="es-MX" href="${esUrl}"/>` +
    `<xhtml:link rel="alternate" hreflang="x-default" href="${enUrl}"/>`
  );
}

/**
 * Best-effort enumeration of public profiles for /u/<username>/ entries.
 * Requires SUPABASE_SERVICE_ROLE_KEY + SUPABASE_URL in the build env;
 * silently skipped otherwise (CI does not always carry the service role
 * for security reasons).
 */
async function fetchPublicUsernames() {
  const url = process.env.SUPABASE_URL || process.env.PUBLIC_SUPABASE_URL;
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!url || !key) {
    console.warn('[sitemap] SUPABASE_SERVICE_ROLE_KEY not set — skipping public-profile enumeration');
    return [];
  }
  try {
    const res = await fetch(
      `${url.replace(/\/$/, '')}/rest/v1/users?select=username&profile_privacy->>profile=eq.public&username=not.is.null&limit=10000`,
      {
        headers: {
          apikey: key,
          Authorization: `Bearer ${key}`,
          Accept: 'application/json',
        },
      },
    );
    if (!res.ok) {
      console.warn(`[sitemap] users enumeration returned ${res.status} — skipping`);
      return [];
    }
    const rows = await res.json();
    return rows
      .map((r) => (r && typeof r.username === 'string' ? r.username : null))
      .filter((u) => !!u && /^[A-Za-z0-9._-]+$/.test(u));
  } catch (err) {
    console.warn(`[sitemap] users enumeration failed: ${err.message ?? err}`);
    return [];
  }
}

function appendUserUrls(xml, usernames) {
  if (!usernames.length) return { xml, appended: 0 };
  const blocks = usernames
    .map((u) => {
      const en = `${SITE}/en/u/${u}/`;
      const es = `${SITE}/es/u/${u}/`;
      return `<url><loc>${en}</loc>${hreflangBlock(en, es)}</url><url><loc>${es}</loc>${hreflangBlock(en, es)}</url>`;
    })
    .join('');
  const injected = xml.replace('</urlset>', `${blocks}</urlset>`);
  return { xml: injected, appended: usernames.length * 2 };
}

async function run() {
  const xml = readFileSync(SITEMAP, 'utf-8');
  const pairMap = buildPairMap();

  let injected = 0;
  let result = xml.replace(/<url><loc>(https:\/\/rastrum\.org\/[^<]+)<\/loc><\/url>/g, (match, url) => {
    // Already has hreflang (shouldn't match — but be defensive)
    if (match.includes('xhtml:link')) return match;

    const pair = pairMap.get(url);
    if (!pair) return match; // no known pair (e.g. /share/obs/)

    injected++;
    return `<url><loc>${url}</loc>${hreflangBlock(pair.en, pair.es)}</url>`;
  });

  const usernames = await fetchPublicUsernames();
  const userResult = appendUserUrls(result, usernames);
  result = userResult.xml;

  if (injected === 0 && userResult.appended === 0) {
    console.log('[sitemap-hreflang] No unpaired URLs found — sitemap already complete.');
    return;
  }

  writeFileSync(SITEMAP, result, 'utf-8');
  console.log(`[sitemap-hreflang] Injected hreflang into ${injected} previously-unpaired URLs.`);
  if (userResult.appended) {
    console.log(`[sitemap-hreflang] Appended ${userResult.appended} public-profile URLs.`);
  }
}

run().catch((err) => {
  console.error('[sitemap-hreflang] failed:', err);
  process.exit(1);
});
