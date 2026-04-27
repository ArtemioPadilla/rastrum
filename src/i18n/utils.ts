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
