// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://rastrum.org',
  base: '/',
  output: 'static',
  integrations: [
    tailwind(),
    sitemap({
      i18n: {
        defaultLocale: 'en',
        locales: { en: 'en-US', es: 'es-MX' },
      },
      filter: (page) => !page.includes('/auth/callback'),
    }),
  ],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: {
      prefixDefaultLocale: true,
      // Don't auto-redirect / to /en/ — we serve our own SEO-friendly
      // root index.astro with hreflang + locale picker so crawlers and
      // social-card scrapers get real metadata, not a thin redirect stub.
      redirectToDefaultLocale: false,
    },
  },
  // PR-1 (UX revamp) IA reshuffle: watchlist is public-data exploration,
  // not personal admin, so it lives under /explore now. Old URL keeps
  // working via 301 so existing bookmarks survive.
  redirects: {
    '/en/profile/watchlist':      { status: 301, destination: '/en/explore/watchlist/' },
    '/es/perfil/seguimiento':     { status: 301, destination: '/es/explorar/seguimiento/' },
    // PR-2: account hub + settings shell — legacy routes → new settings tabs
    '/en/profile/edit':           { status: 301, destination: '/en/profile/settings/profile/' },
    '/es/perfil/editar':          { status: 301, destination: '/es/perfil/ajustes/profile/' },
    '/en/profile/tokens':         { status: 301, destination: '/en/profile/settings/developer/' },
    '/es/perfil/tokens':          { status: 301, destination: '/es/perfil/ajustes/developer/' },
    '/en/profile/export':         { status: 301, destination: '/en/profile/settings/data/' },
    '/es/perfil/exportar':        { status: 301, destination: '/es/perfil/ajustes/data/' },
    '/en/profile/import':         { status: 301, destination: '/en/profile/settings/data/' },
    '/es/perfil/importar':        { status: 301, destination: '/es/perfil/ajustes/data/' },
    '/en/profile/expert-apply':   { status: 301, destination: '/en/profile/settings/developer/' },
    '/es/perfil/aplicar-experto': { status: 301, destination: '/es/perfil/ajustes/developer/' },
  },
});
