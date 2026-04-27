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
  profileAdminExperts: { en: '/profile/admin/experts', es: '/perfil/admin/expertos' },
  profileUser: { en: '/profile/u', es: '/perfil/u' },
  profileImport: { en: '/profile/import', es: '/perfil/importar' },
  profileImportCameraTrap: {
    en: '/profile/import/camera-trap',
    es: '/perfil/importar/camara-trampa',
  },
  chat: { en: '/chat', es: '/chat' },
  privacy: { en: '/privacy', es: '/privacidad' },
  terms: { en: '/terms', es: '/terminos' },
  faq: { en: '/faq', es: '/preguntas-frecuentes' },
};

export const docPages = [
  'vision', 'features', 'roadmap', 'tasks', 'market',
  'architecture', 'indigenous', 'funding', 'contribute',
  'faq', 'privacy', 'terms',
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
  profileAdminExperts:       { labels: { en: 'Admin: experts',   es: 'Admin: expertos' },   parent: 'profile' },
  profileUser:               { labels: { en: 'Public profile',   es: 'Perfil público' },    parent: 'profile' },
  profileImport:             { labels: { en: 'Import',           es: 'Importar' },          parent: 'profile' },
  profileImportCameraTrap:   { labels: { en: 'Camera trap',      es: 'Cámara trampa' },     parent: 'profileImport' },
  privacy:     { labels: { en: 'Privacy',       es: 'Privacidad' } },
  terms:       { labels: { en: 'Terms',         es: 'Términos' } },
  faq:         { labels: { en: 'FAQ',           es: 'Preguntas frecuentes' } },
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
