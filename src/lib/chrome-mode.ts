export type ChromeMode = 'app' | 'read' | 'console';

// Path prefixes that should render the app-mode chrome (no footer, bottom
// bar dominant on mobile). Order doesn't matter; matched by `startsWith`
// after the locale prefix is stripped, plus the auth callback path.
//
// Read PR 3 to see how the footer reads from this; PR 4 for search.
const APP_PREFIXES = [
  '/observe',
  '/observar',
  '/explore',
  '/explorar',
  '/chat',
  '/profile',
  '/perfil',
] as const;

const AUTH_PREFIXES = ['/auth/'] as const;

function normalizeBase(baseUrl: string | undefined): string {
  if (!baseUrl || baseUrl === '/') return '';
  const withSlash = baseUrl.startsWith('/') ? baseUrl : `/${baseUrl}`;
  return withSlash.replace(/\/$/, '');
}

export function resolveChromeMode(pathname: string, baseUrl?: string): ChromeMode {
  if (!pathname) return 'read';
  const base = normalizeBase(baseUrl ?? import.meta.env?.BASE_URL);
  const noBase = base && pathname.startsWith(base) ? pathname.slice(base.length) : pathname;
  // Console mode: privileged-actions surface, fully separate chrome.
  if (/^\/(en|es)\/(console|consola)(\/|$)/.test(noBase)) return 'console';
  // Locale-neutral check for /auth/* first
  for (const p of AUTH_PREFIXES) {
    if (noBase.startsWith(p)) return 'app';
  }
  // Strip the leading locale (e.g. "/en", "/es"); handle missing trailing slash.
  // Pathnames look like "/en/observe/" or "/es/perfil/exportar/" or "/en".
  const stripped = noBase.replace(/^\/(en|es)(?=\/|$)/, '') || '/';
  for (const p of APP_PREFIXES) {
    if (stripped === p || stripped.startsWith(p + '/') || stripped.startsWith(p + '?')) {
      return 'app';
    }
  }
  return 'read';
}
