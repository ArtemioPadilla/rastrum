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
  about: { en: '/about', es: '/acerca' },
  docs: { en: '/docs', es: '/docs' },
};

export const docPages = [
  'vision', 'features', 'roadmap', 'market',
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
