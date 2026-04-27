import { routes, type Locale } from '../i18n/utils';

export interface FabTarget {
  href: string;
  /** 'observe' = full save flow; 'quick-id' = lightweight photo lookup. */
  mode: 'observe' | 'quick-id';
}

/**
 * Default = /observe. On /observe itself the FAB shifts to /identify (quick
 * lookup, no save) so the camera button is never a no-op while still
 * meaning "photo → identification."
 */
export function getFabTarget(pathname: string, lang: string): FabTarget {
  const locale: Locale = lang === 'es' ? 'es' : 'en';
  const base = import.meta.env?.BASE_URL?.replace(/\/$/, '') ?? '';
  const observeSlug = routes.observe[locale];
  const identifySlug = routes.identify[locale];

  // Match /en/observe, /en/observe/, /es/observar, /es/observar/
  const onObserve = pathname.replace(/\/$/, '') === `${base}/${locale}${observeSlug}`;

  if (onObserve) {
    return { href: `${base}/${locale}${identifySlug}/`, mode: 'quick-id' };
  }
  return { href: `${base}/${locale}${observeSlug}/`, mode: 'observe' };
}

/**
 * Returns true when `currentPath` is inside the section identified by
 * `sectionKey`. Used by Header.astro / MobileBottomBar.astro to render the
 * active rail / active tab.
 *
 * Section keys mirror the top-level entries in `routes`/`routeTree`:
 *   'home', 'observe', 'explore', 'chat', 'about', 'docs', 'profile'
 */
export function isActiveSection(currentPath: string, sectionKey: string, lang: string): boolean {
  const locale: Locale = lang === 'es' ? 'es' : 'en';
  const base = import.meta.env?.BASE_URL?.replace(/\/$/, '') ?? '';
  const norm = currentPath.replace(/\/$/, '');
  const localeRoot = `${base}/${locale}`;

  if (sectionKey === 'home') {
    return norm === localeRoot || norm === '';
  }
  const slug = routes[sectionKey]?.[locale];
  if (slug === undefined) return false;
  const sectionRoot = `${localeRoot}${slug}`;
  return norm === sectionRoot || norm.startsWith(sectionRoot + '/');
}
