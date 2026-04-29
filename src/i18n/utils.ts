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
  exploreValidate: { en: '/explore/validate', es: '/explorar/validar' },
  observe: { en: '/observe', es: '/observar' },
  about: { en: '/about', es: '/acerca' },
  docs: { en: '/docs', es: '/docs' },
  signIn: { en: '/sign-in', es: '/ingresar' },
  profile: { en: '/profile', es: '/perfil' },
  profileEdit: { en: '/profile/edit', es: '/perfil/editar' },
  profileExport: { en: '/profile/export', es: '/perfil/exportar' },
  profileObservations: { en: '/profile/observations', es: '/perfil/observaciones' },
  profileExpertApply: { en: '/profile/expert-apply', es: '/perfil/aplicar-experto' },
  profileValidate:    { en: '/profile/validate',     es: '/perfil/validar' },
  profileAdminExperts: { en: '/profile/admin/experts', es: '/perfil/admin/expertos' },
  profileUser: { en: '/profile/u', es: '/perfil/u' },
  profileImport: { en: '/profile/import', es: '/perfil/importar' },
  profileImportCameraTrap: {
    en: '/profile/import/camera-trap',
    es: '/perfil/importar/camara-trampa',
  },
  dex: { en: '/profile/dex', es: '/perfil/dex' },
  profileSettings: { en: '/profile/settings', es: '/perfil/ajustes' },
  profileSettingsProfile: { en: '/profile/settings/profile', es: '/perfil/ajustes/profile' },
  profileSettingsPreferences: { en: '/profile/settings/preferences', es: '/perfil/ajustes/preferences' },
  profileSettingsData: { en: '/profile/settings/data', es: '/perfil/ajustes/data' },
  profileSettingsDeveloper: { en: '/profile/settings/developer', es: '/perfil/ajustes/developer' },
  profileSettingsPrivacy: { en: '/profile/settings/privacy', es: '/perfil/ajustes/privacy' },
  sponsoring:   { en: '/profile/sponsoring',    es: '/perfil/patrocinios' },
  sponsoredBy:  { en: '/profile/sponsored-by',  es: '/perfil/patrocinado-por' },
  publicProfile: { en: '/u', es: '/u' },
  chat: { en: '/chat', es: '/chat' },
  // Community discovery (M28)
  community:           { en: '/community',           es: '/comunidad' },
  communityObservers:  { en: '/community/observers', es: '/comunidad/observadores' },
  privacy: { en: '/privacy', es: '/privacidad' },
  terms: { en: '/terms', es: '/terminos' },
  faq: { en: '/faq', es: '/preguntas-frecuentes' },
  // Console (admin / moderator / expert privileged surface)
  console:                  { en: '/console',                  es: '/consola' },
  consoleUsers:             { en: '/console/users',            es: '/consola/usuarios' },
  consoleCredentials:       { en: '/console/credentials',      es: '/consola/credenciales' },
  consoleExperts:           { en: '/console/experts',          es: '/consola/expertos' },
  consoleObservations:      { en: '/console/observations',     es: '/consola/observaciones' },
  consoleApi:               { en: '/console/api',              es: '/consola/api' },
  consoleSync:              { en: '/console/sync',             es: '/consola/sync' },
  consoleCron:              { en: '/console/cron',             es: '/consola/cron' },
  consoleBadges:            { en: '/console/badges',           es: '/consola/insignias' },
  consoleTaxa:              { en: '/console/taxa',             es: '/consola/taxa' },
  consoleKarma:             { en: '/console/karma',            es: '/consola/karma' },
  consoleFlags:             { en: '/console/flags',            es: '/consola/banderas' },
  consoleAudit:             { en: '/console/audit',            es: '/consola/auditoria' },
  consoleAnomalies:         { en: '/console/anomalies',        es: '/consola/anomalias' },
  consoleForensics:         { en: '/console/forensics',        es: '/consola/forenses' },
  consoleFeatureFlags:      { en: '/console/features',         es: '/consola/caracteristicas' },
  consoleBioblitz:          { en: '/console/bioblitz',         es: '/consola/bioblitz' },
  consoleModFlagQueue:      { en: '/console/flag-queue',       es: '/consola/cola-banderas' },
  consoleModComments:       { en: '/console/comments',         es: '/consola/comentarios' },
  consoleModBans:           { en: '/console/bans',             es: '/consola/suspensiones' },
  consoleModDisputes:       { en: '/console/disputes',         es: '/consola/disputas' },
  consoleModAppeals:        { en: '/console/appeals',          es: '/consola/apelaciones' },
  consoleExpertValidation:  { en: '/console/validation',       es: '/consola/validacion' },
  consoleExpertOverrides:   { en: '/console/overrides',        es: '/consola/correcciones' },
  consoleExpertExpertise:   { en: '/console/expertise',        es: '/consola/experiencia' },
  consoleExpertTaxonNotes:  { en: '/console/taxon-notes',      es: '/consola/notas-taxon' },
  profileAppeal: { en: '/profile/appeal', es: '/perfil/apelar' },
  // Social graph (M26)
  inbox:            { en: '/inbox',     es: '/bandeja' },
  profileFollowers: { en: '/profile/u', es: '/perfil/u' },
  profileFollowing: { en: '/profile/u', es: '/perfil/u' },
  // Projects (M29)
  projects:     { en: '/projects',     es: '/proyectos' },
  projectNew:   { en: '/projects/new', es: '/proyectos/nuevo' },
};

export const docPages = [
  'vision', 'features', 'roadmap', 'tasks', 'market',
  'architecture', 'indigenous', 'funding', 'contribute',
  'faq', 'privacy', 'terms', 'console', 'sponsorships',
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
  exploreValidate:   { labels: { en: 'Validate',  es: 'Validar' },      parent: 'explore' },
  chat:        { labels: { en: 'Chat',          es: 'Chat' } },
  // Community discovery (M28)
  community:          { labels: { en: 'Community',  es: 'Comunidad' } },
  communityObservers: { labels: { en: 'Observers',  es: 'Observadores' }, parent: 'community' },
  about:       { labels: { en: 'About',         es: 'Acerca' } },
  docs:        { labels: { en: 'Docs',          es: 'Docs' } },
  signIn:      { labels: { en: 'Sign in',       es: 'Ingresar' } },
  profile:     { labels: { en: 'Profile',       es: 'Perfil' } },
  profileEdit:               { labels: { en: 'Edit profile',     es: 'Editar perfil' },     parent: 'profile' },
  profileExport:             { labels: { en: 'Export',           es: 'Exportar' },          parent: 'profile' },
  profileObservations:       { labels: { en: 'My observations',  es: 'Mis observaciones' }, parent: 'profile' },
  profileExpertApply:        { labels: { en: 'Apply expert',     es: 'Aplicar experto' },   parent: 'profile' },
  profileValidate:           { labels: { en: 'My validations',   es: 'Mis validaciones' },  parent: 'profile' },
  profileAdminExperts:       { labels: { en: 'Admin: experts',   es: 'Admin: expertos' },   parent: 'profile' },
  profileUser:               { labels: { en: 'Public profile',   es: 'Perfil público' },    parent: 'profile' },
  profileImport:             { labels: { en: 'Import',           es: 'Importar' },          parent: 'profile' },
  profileImportCameraTrap:   { labels: { en: 'Camera trap',      es: 'Cámara trampa' },     parent: 'profileImport' },
  dex:                       { labels: { en: 'Pokédex',          es: 'Pokédex' },           parent: 'profile' },
  profileSettings:           { labels: { en: 'Settings',         es: 'Ajustes' },           parent: 'profile' },
  profileSettingsProfile:    { labels: { en: 'Profile',          es: 'Perfil' },            parent: 'profileSettings' },
  profileSettingsPreferences:{ labels: { en: 'Preferences',      es: 'Preferencias' },      parent: 'profileSettings' },
  profileSettingsData:       { labels: { en: 'Data',             es: 'Datos' },             parent: 'profileSettings' },
  profileSettingsDeveloper:  { labels: { en: 'Developer',        es: 'Desarrollador' },     parent: 'profileSettings' },
  profileSettingsPrivacy:    { labels: { en: 'Privacy',          es: 'Privacidad' },        parent: 'profileSettings' },
  sponsoring:                { labels: { en: 'Sponsoring',       es: 'Patrocinios' },       parent: 'profile' },
  sponsoredBy:               { labels: { en: 'Sponsored by',     es: 'Patrocinado por' },   parent: 'profile' },
  profileAppeal:             { labels: { en: 'Appeal suspension', es: 'Apelar suspensión' }, parent: 'profile' },
  publicProfile:             { labels: { en: 'Public profile',   es: 'Perfil público' } },
  privacy:     { labels: { en: 'Privacy',       es: 'Privacidad' } },
  terms:       { labels: { en: 'Terms',         es: 'Términos' } },
  faq:         { labels: { en: 'FAQ',           es: 'Preguntas frecuentes' } },
  // Console
  console:                 { labels: { en: 'Console',          es: 'Consola' } },
  consoleUsers:            { labels: { en: 'Users',            es: 'Usuarios' },          parent: 'console' },
  consoleCredentials:      { labels: { en: 'Credentials',      es: 'Credenciales' },      parent: 'console' },
  consoleExperts:          { labels: { en: 'Experts',          es: 'Expertos' },          parent: 'console' },
  consoleObservations:     { labels: { en: 'Observations',     es: 'Observaciones' },     parent: 'console' },
  consoleApi:              { labels: { en: 'API',              es: 'API' },               parent: 'console' },
  consoleSync:             { labels: { en: 'Sync',             es: 'Sync' },              parent: 'console' },
  consoleCron:             { labels: { en: 'Cron',             es: 'Cron' },              parent: 'console' },
  consoleBadges:           { labels: { en: 'Badges',           es: 'Insignias' },         parent: 'console' },
  consoleTaxa:             { labels: { en: 'Taxa',             es: 'Taxa' },              parent: 'console' },
  consoleKarma:            { labels: { en: 'Karma',            es: 'Karma' },             parent: 'console' },
  consoleFlags:            { labels: { en: 'Flags',            es: 'Banderas' },          parent: 'console' },
  consoleAudit:            { labels: { en: 'Audit',            es: 'Auditoría' },         parent: 'console' },
  consoleAnomalies:        { labels: { en: 'Anomalies',        es: 'Anomalías' },         parent: 'console' },
  consoleForensics:        { labels: { en: 'Forensics',        es: 'Forenses' },          parent: 'console' },
  consoleFeatureFlags:     { labels: { en: 'Features',         es: 'Características' },   parent: 'console' },
  consoleBioblitz:         { labels: { en: 'Bioblitz',         es: 'Bioblitz' },          parent: 'console' },
  consoleModFlagQueue:     { labels: { en: 'Flag queue',       es: 'Cola de banderas' },  parent: 'console' },
  consoleModComments:      { labels: { en: 'Comments',         es: 'Comentarios' },       parent: 'console' },
  consoleModBans:          { labels: { en: 'Bans',             es: 'Suspensiones' },      parent: 'console' },
  consoleModDisputes:      { labels: { en: 'Disputes',         es: 'Disputas' },          parent: 'console' },
  consoleModAppeals:       { labels: { en: 'Appeals',          es: 'Apelaciones' },       parent: 'console' },
  consoleExpertValidation: { labels: { en: 'Validation',       es: 'Validación' },        parent: 'console' },
  consoleExpertOverrides:  { labels: { en: 'Overrides',        es: 'Correcciones' },      parent: 'console' },
  consoleExpertExpertise:  { labels: { en: 'Expertise',        es: 'Experiencia' },       parent: 'console' },
  consoleExpertTaxonNotes: { labels: { en: 'Taxon notes',      es: 'Notas de taxón' },    parent: 'console' },
  // Projects (M29)
  projects:          { labels: { en: 'Projects', es: 'Proyectos' } },
  projectDetail:     { labels: { en: 'Project',  es: 'Proyecto' }, parent: 'projects' },
  projectNew:        { labels: { en: 'New project', es: 'Nuevo proyecto' }, parent: 'projects' },
  // Social graph (M26)
  inbox:             { labels: { en: 'Inbox',     es: 'Bandeja' } },
  profileFollowers:  { labels: { en: 'Followers', es: 'Seguidores' }, parent: 'profileUser' },
  profileFollowing:  { labels: { en: 'Following', es: 'Siguiendo' },  parent: 'profileUser' },
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

/**
 * Per-page meta descriptions for doc pages. Consumed by DocLayout when no
 * explicit description prop is passed. Keep 120-160 chars, keyword-rich.
 */
export const docPageMeta = {
  vision: {
    en: "Why Rastrum exists: making every living thing identifiable by anyone, anywhere — even offline, even in indigenous languages, even for tracks and scat.",
    es: "Por qué existe Rastrum: hacer cada ser vivo identificable por cualquier persona, en cualquier lugar — sin conexión, en lenguas indígenas, hasta huellas y excrementos.",
  },
  features: {
    en: "What Rastrum does today: photo + audio + video identification, multi-modal cascade (PlantNet → Claude → on-device), offline-first PWA, Darwin Core export.",
    es: "Lo que Rastrum hace hoy: identificación con foto, audio y video, cascade multi-modal (PlantNet → Claude → en dispositivo), PWA sin conexión, export Darwin Core.",
  },
  roadmap: {
    en: "What's next on Rastrum's roadmap. v1.0 shipped — chrome revamp, parallel cascade. v1.1+: account hub, command palette, onboarding tour, species pages.",
    es: "Qué sigue en la hoja de ruta de Rastrum. v1.0 listo — renovación de chrome, cascade paralelo. v1.1+: hub de cuenta, paleta de comandos, tour, páginas de especies.",
  },
  tasks: {
    en: "Current implementation tasks across all roadmap items. Live status from docs/tasks.json — see what's in progress, what's done, what's deferred.",
    es: "Tareas actuales de implementación en cada ítem de hoja de ruta. Estado en vivo desde docs/tasks.json — ve qué está en curso, listo o diferido.",
  },
  market: {
    en: "How Rastrum compares to iNaturalist, Pl@ntNet, and Merlin Bird ID. Positioning, differentiators, and target Latin American biodiversity research community.",
    es: "Cómo se compara Rastrum con iNaturalist, Pl@ntNet y Merlin Bird ID. Posicionamiento, diferenciadores y la comunidad latinoamericana de investigación en biodiversidad.",
  },
  architecture: {
    en: "How Rastrum's identifier cascade, offline outbox, R2 media storage, and Darwin Core pipeline fit together. Block diagram, data flows, decisions.",
    es: "Cómo se integran el cascade de identificadores, outbox offline, almacén de medios R2 y pipeline Darwin Core de Rastrum. Diagrama de bloques, flujos, decisiones.",
  },
  indigenous: {
    en: "Indigenous-language commitments in Rastrum: Zapoteco, Mixteco, Náhuatl, Maya, Tsotsil/Tseltal. Built with CARE principles and community consent.",
    es: "Compromiso de Rastrum con lenguas indígenas: Zapoteco, Mixteco, Náhuatl, Maya, Tsotsil/Tseltal. Construido con principios CARE y consentimiento comunitario.",
  },
  funding: {
    en: "How Rastrum is funded today (zero-cost, BYO-key model) and how to support development. Grant outreach, GitHub Sponsors, operator-paid project keys.",
    es: "Cómo se financia Rastrum hoy (modelo zero-cost con tus propias keys) y cómo apoyar su desarrollo. Subvenciones, GitHub Sponsors, claves de proyecto pagadas por el operador.",
  },
  contribute: {
    en: "How to contribute to Rastrum: code (PRs welcome), translations, indigenous-language partnerships, observation data, and bug reports via the in-app reporter.",
    es: "Cómo contribuir a Rastrum: código (PRs bienvenidos), traducciones, alianzas con lenguas indígenas, datos de observación, y reportes de bugs desde la app.",
  },
  faq: {
    en: "Frequently asked questions about Rastrum: identification accuracy, privacy, sensitive species, offline mode, BYO API keys, and how to contribute.",
    es: "Preguntas frecuentes sobre Rastrum: precisión de identificación, privacidad, especies sensibles, modo sin conexión, claves API propias y cómo contribuir.",
  },
  privacy: {
    en: "Rastrum's privacy policy. What we collect, how we store it, and what we never log — your API keys, your queries, your precise location.",
    es: "Política de privacidad de Rastrum. Qué recopilamos, cómo lo almacenamos, y qué nunca registramos — tus claves API, consultas, ubicación precisa.",
  },
  terms: {
    en: "Rastrum's terms of service. Open-source under MIT (code) and AGPL-3.0 (server). Per-observation Creative Commons licensing — BY, BY-NC, or CC0.",
    es: "Términos de servicio de Rastrum. Open-source bajo MIT (código) y AGPL-3.0 (servidor). Licencias Creative Commons por observación — BY, BY-NC o CC0.",
  },
  console: {
    en: "Privileged-actions surface for admin, moderator, and expert roles. Role model, audit log, and per-action runbooks.",
    es: "Superficie de acciones privilegiadas para roles de admin, moderador y experto. Modelo de roles, auditoría y runbooks por acción.",
  },
  sponsorships: {
    en: "Share your Anthropic credential with friends, capped per month and audited. How sponsorship works for sponsors and beneficiaries.",
    es: "Comparte tu credencial Anthropic con amigos, con límite mensual y auditoría. Cómo funcionan los patrocinios para sponsors y beneficiarios.",
  },
} as const satisfies Record<DocPage, { en: string; es: string }>;

/**
 * Given a pathname like '/en/observe/' and a target locale like 'es',
 * returns the equivalent path in that locale: '/es/observar/'.
 * Falls back to a locale-prefix swap when no route key matches.
 */
export function getAlternateUrl(currentPath: string, targetLang: 'en' | 'es'): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  const pathWithoutBase = currentPath.replace(base, '') || '/';
  const segments = pathWithoutBase.split('/').filter(Boolean);
  const currentLang = segments[0];

  // Locale-less paths (e.g. /auth/callback/, /share/obs/) — these are
  // language-neutral transit/share routes; alternate is itself.
  if (currentLang !== 'en' && currentLang !== 'es') {
    const trailing = pathWithoutBase.endsWith('/') ? '' : '/';
    return `${base}${pathWithoutBase}${trailing}`;
  }

  // Locale-prefixed paths — existing route-key swap logic continues here
  const currentSlug = '/' + (segments.slice(1).join('/') || '');
  const matchedKey = Object.keys(routes).find(key => {
    const slug = routes[key][currentLang as Locale] || '';
    return slug === currentSlug || (currentSlug === '/' && slug === '');
  });
  const altSlug = matchedKey ? (routes[matchedKey][targetLang] || '') : currentSlug;
  return `${base}/${targetLang}${altSlug}/`;
}
