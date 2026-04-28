/**
 * Build-time script: emits public/search-index.en.json + public/search-index.es.json
 * Run before `astro build` (see package.json "build" script).
 *
 * Each entry shape:
 *   { id, type: 'action' | 'page' | 'doc', label, labelEs, url, keywords?, description? }
 */

import { writeFileSync, mkdirSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));
const root = join(__dirname, '..');
const publicDir = join(root, 'public');

// ---------------------------------------------------------------------------
// Route data (mirrors src/i18n/utils.ts — keep in sync)
// ---------------------------------------------------------------------------
const routes = {
  home:                     { en: '',                            es: '' },
  identify:                 { en: '/identify',                   es: '/identificar' },
  explore:                  { en: '/explore',                    es: '/explorar' },
  exploreMap:               { en: '/explore/map',                es: '/explorar/mapa' },
  exploreRecent:            { en: '/explore/recent',             es: '/explorar/recientes' },
  exploreWatchlist:         { en: '/explore/watchlist',          es: '/explorar/seguimiento' },
  exploreSpecies:           { en: '/explore/species',            es: '/explorar/especies' },
  exploreValidate:          { en: '/explore/validate',           es: '/explorar/validar' },
  observe:                  { en: '/observe',                    es: '/observar' },
  about:                    { en: '/about',                      es: '/acerca' },
  docs:                     { en: '/docs',                       es: '/docs' },
  signIn:                   { en: '/sign-in',                    es: '/ingresar' },
  profile:                  { en: '/profile',                    es: '/perfil' },
  profileEdit:              { en: '/profile/edit',               es: '/perfil/editar' },
  profileExport:            { en: '/profile/export',             es: '/perfil/exportar' },
  profileObservations:      { en: '/profile/observations',       es: '/perfil/observaciones' },
  profileImport:            { en: '/profile/import',             es: '/perfil/importar' },
  profileImportCameraTrap:  { en: '/profile/import/camera-trap', es: '/perfil/importar/camara-trampa' },
  chat:                     { en: '/chat',                       es: '/chat' },
  privacy:                  { en: '/privacy',                    es: '/privacidad' },
  terms:                    { en: '/terms',                      es: '/terminos' },
  faq:                      { en: '/faq',                        es: '/preguntas-frecuentes' },
};

const routeLabels = {
  home:                     { en: 'Home',               es: 'Inicio' },
  identify:                 { en: 'Identify',           es: 'Identificar' },
  explore:                  { en: 'Explore',            es: 'Explorar' },
  exploreMap:               { en: 'Map',                es: 'Mapa' },
  exploreRecent:            { en: 'Recent',             es: 'Recientes' },
  exploreWatchlist:         { en: 'Watchlist',          es: 'Seguimiento' },
  exploreSpecies:           { en: 'Species',            es: 'Especies' },
  exploreValidate:          { en: 'Validate',           es: 'Validar' },
  observe:                  { en: 'Observe',            es: 'Observar' },
  about:                    { en: 'About',              es: 'Acerca' },
  docs:                     { en: 'Docs',               es: 'Docs' },
  signIn:                   { en: 'Sign in',            es: 'Ingresar' },
  profile:                  { en: 'Profile',            es: 'Perfil' },
  profileEdit:              { en: 'Edit profile',       es: 'Editar perfil' },
  profileExport:            { en: 'Export',             es: 'Exportar' },
  profileObservations:      { en: 'My observations',   es: 'Mis observaciones' },
  profileImport:            { en: 'Import',             es: 'Importar' },
  profileImportCameraTrap:  { en: 'Camera trap',        es: 'Cámara trampa' },
  chat:                     { en: 'Chat',               es: 'Chat' },
  privacy:                  { en: 'Privacy',            es: 'Privacidad' },
  terms:                    { en: 'Terms',              es: 'Términos' },
  faq:                      { en: 'FAQ',                es: 'Preguntas frecuentes' },
};

const docPages = [
  { key: 'vision',        en: 'Vision',        es: 'Visión',              group: 'Product' },
  { key: 'features',      en: 'Features',      es: 'Funcionalidades',     group: 'Product' },
  { key: 'architecture',  en: 'Architecture',  es: 'Arquitectura',        group: 'Product' },
  { key: 'roadmap',       en: 'Roadmap',       es: 'Hoja de ruta',        group: 'Progress' },
  { key: 'tasks',         en: 'Tasks',         es: 'Tareas',              group: 'Progress' },
  { key: 'market',        en: 'Market',        es: 'Mercado',             group: 'Progress' },
  { key: 'indigenous',    en: 'Indigenous',    es: 'Lenguas indígenas',   group: 'Community' },
  { key: 'funding',       en: 'Funding',       es: 'Financiamiento',      group: 'Community' },
  { key: 'contribute',    en: 'Contribute',    es: 'Contribuir',          group: 'Community' },
  { key: 'faq',           en: 'FAQ',           es: 'Preguntas frecuentes', group: 'Product' },
  { key: 'privacy',       en: 'Privacy',       es: 'Privacidad',          group: 'Community' },
  { key: 'terms',         en: 'Terms',         es: 'Términos',            group: 'Community' },
];

// ---------------------------------------------------------------------------
// Quick actions (same set for both locales; labels differ)
// ---------------------------------------------------------------------------
const quickActions = [
  {
    id: 'action-new-observation',
    label:   { en: 'New observation',      es: 'Nueva observación' },
    url:     { en: '/en/observe/',          es: '/es/observar/' },
    keywords: 'observe photo identify species record',
  },
  {
    id: 'action-quick-identify',
    label:   { en: 'Quick identify',        es: 'Identificación rápida' },
    url:     { en: '/en/identify/',          es: '/es/identificar/' },
    keywords: 'identify photo species quick',
  },
  {
    id: 'action-sign-out',
    label:   { en: 'Sign out',              es: 'Cerrar sesión' },
    url:     null,
    keywords: 'logout sign out account session',
    action: 'sign-out',
  },
  {
    id: 'action-toggle-theme',
    label:   { en: 'Toggle theme',          es: 'Cambiar tema' },
    url:     null,
    keywords: 'dark light theme mode color',
    action: 'toggle-theme',
  },
  {
    id: 'action-switch-lang',
    label:   { en: 'Switch to Spanish',     es: 'Cambiar a inglés' },
    url:     null,
    keywords: 'language español english change locale',
    action: 'switch-lang',
  },
  {
    id: 'action-api-tokens',
    label:   { en: 'Open API tokens',       es: 'Abrir tokens API' },
    url:     { en: '/en/profile/tokens/',    es: '/es/perfil/tokens/' },
    keywords: 'api tokens developer key rst',
  },
  {
    id: 'action-export-dwc',
    label:   { en: 'Export DwC archive',    es: 'Exportar archivo DwC' },
    url:     { en: '/en/profile/export/',    es: '/es/perfil/exportar/' },
    keywords: 'export darwin core archive dwca gbif',
  },
  {
    id: 'action-privacy-settings',
    label:   { en: 'Privacy settings',      es: 'Configuración de privacidad' },
    url:     { en: '/en/profile/settings/privacy/', es: '/es/perfil/ajustes/privacy/' },
    keywords: 'privacy facets matrix profile visibility public signed-in private',
  },
  {
    id: 'action-pokedex',
    label:   { en: 'Pokédex',               es: 'Pokédex' },
    url:     { en: '/en/profile/dex/',       es: '/es/perfil/dex/' },
    keywords: 'pokedex dex species rarity collected discovered',
  },
  {
    id: 'action-view-public-profile',
    label:   { en: 'View my public profile', es: 'Ver mi perfil público' },
    url:     { en: '/en/profile/',           es: '/es/perfil/' },
    keywords: 'public profile share view username u',
  },
  {
    id: 'action-make-profile-private',
    label:   { en: 'Make profile private',  es: 'Hacer perfil privado' },
    url:     null,
    keywords: 'private hide privacy visibility off',
    action: 'make-profile-private',
  },
];

// ---------------------------------------------------------------------------
// Build index for a given locale
// ---------------------------------------------------------------------------
function buildIndex(lang) {
  const entries = [];
  const l = lang;
  const other = l === 'en' ? 'es' : 'en';

  // Quick actions
  for (const a of quickActions) {
    const url = a.url ? a.url[l] : null;
    entries.push({
      id:          a.id,
      type:        'action',
      label:       a.label[l],
      labelAlt:    a.label[other],
      url:         url ?? '',
      keywords:    a.keywords ?? '',
      ...(a.action ? { action: a.action } : {}),
    });
  }

  // Pages from routes map
  const pageRouteKeys = [
    'home', 'identify', 'observe', 'explore', 'exploreMap',
    'exploreRecent', 'exploreWatchlist', 'exploreSpecies', 'exploreValidate',
    'chat', 'about', 'docs', 'signIn', 'profile', 'profileEdit',
    'profileExport', 'profileObservations', 'profileImport',
    'profileImportCameraTrap', 'faq', 'privacy', 'terms',
  ];
  for (const key of pageRouteKeys) {
    const slug = routes[key][l];
    const url = `/${l}${slug}/`;
    const labelEn = routeLabels[key].en;
    const labelEs = routeLabels[key].es;
    entries.push({
      id:       `page-${key}`,
      type:     'page',
      label:    l === 'en' ? labelEn : labelEs,
      labelAlt: l === 'en' ? labelEs : labelEn,
      url,
      keywords: `${labelEn} ${labelEs}`,
    });
  }

  // Doc pages
  for (const doc of docPages) {
    const url = `/${l}/docs/${doc.key}/`;
    entries.push({
      id:          `doc-${doc.key}`,
      type:        'doc',
      label:       l === 'en' ? doc.en : doc.es,
      labelAlt:    l === 'en' ? doc.es : doc.en,
      url,
      keywords:    `${doc.en} ${doc.es} docs ${doc.group.toLowerCase()}`,
      description: doc.group,
    });
  }

  return entries;
}

// ---------------------------------------------------------------------------
// Emit files
// ---------------------------------------------------------------------------
mkdirSync(publicDir, { recursive: true });

for (const lang of ['en', 'es']) {
  const index = buildIndex(lang);
  const outPath = join(publicDir, `search-index.${lang}.json`);
  writeFileSync(outPath, JSON.stringify(index, null, 0));
  console.log(`[search-index] Wrote ${index.length} entries → ${outPath}`);
}
