import { routes, type Locale } from '../i18n/utils';

export interface FabTarget {
  href: string;
  /** True when the user is already on /observe — the FAB triggers the
   *  camera input instead of navigating. */
  onObserve: boolean;
}

/**
 * FAB always points to /observe. When the user is already on /observe,
 * `onObserve` is true so the client script can trigger the camera input
 * directly instead of navigating to the same page.
 */
export function getFabTarget(pathname: string, lang: string): FabTarget {
  const locale: Locale = lang === 'es' ? 'es' : 'en';
  const base = import.meta.env?.BASE_URL?.replace(/\/$/, '') ?? '';
  const observeSlug = routes.observe[locale];

  const onObserve = pathname.replace(/\/$/, '') === `${base}/${locale}${observeSlug}`;

  return { href: `${base}/${locale}${observeSlug}/`, onObserve };
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
