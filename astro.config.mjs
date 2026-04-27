// @ts-check
import { defineConfig } from 'astro/config';
import tailwind from '@astrojs/tailwind';
import sitemap from '@astrojs/sitemap';

// https://astro.build/config
export default defineConfig({
  site: 'https://rastrum.org',
  base: '/',
  output: 'static',
  integrations: [tailwind(), sitemap()],
  i18n: {
    defaultLocale: 'en',
    locales: ['en', 'es'],
    routing: {
      prefixDefaultLocale: true,
    },
  },
  // PR-1 (UX revamp) IA reshuffle: watchlist is public-data exploration,
  // not personal admin, so it lives under /explore now. Old URL keeps
  // working via 301 so existing bookmarks survive.
  redirects: {
    '/en/profile/watchlist':    { status: 301, destination: '/en/explore/watchlist/' },
    '/en/profile/watchlist/':   { status: 301, destination: '/en/explore/watchlist/' },
    '/es/perfil/seguimiento':   { status: 301, destination: '/es/explorar/seguimiento/' },
    '/es/perfil/seguimiento/':  { status: 301, destination: '/es/explorar/seguimiento/' },
  },
});
