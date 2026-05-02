#!/usr/bin/env tsx
/**
 * Build-time OG card generator.
 *
 * Renders a 1200×630 PNG for every (locale, page) at
 * `public/og/<lang>/<slug>.png`, served as a plain static file by GitHub
 * Pages CDN — zero runtime compute, zero per-request server-side. Pattern
 * borrowed from watchboard's social-preview pipeline.
 *
 * Wired into npm run build via the prebuild script.
 *
 * For user-generated content (observations, profiles), see
 * `src/lib/og-card.ts` which renders the same layout client-side at
 * observation-save time and PUTs the result to R2.
 */
import satori from 'satori';
import { Resvg } from '@resvg/resvg-js';
import * as fs from 'node:fs';
import * as path from 'node:path';
import { buildOgTree, OG_WIDTH, OG_HEIGHT, type StaticCardInput } from '../src/lib/og-layout';

const ROOT = path.resolve(import.meta.dirname, '..');
const OUT_DIR = path.join(ROOT, 'public', 'og');
const FONT_BOLD_PATH    = path.join(ROOT, 'public', 'fonts', 'DMSans-Bold.ttf');
const FONT_REGULAR_PATH = path.join(ROOT, 'public', 'fonts', 'DMSans-Regular.ttf');

type Lang = 'en' | 'es';
const LANGS: Lang[] = ['en', 'es'];

interface PageSpec {
  slug: string;
  cards: Record<Lang, StaticCardInput>;
}

// One PNG per (locale, surface). Rendered to `public/og/<lang>/<slug>.png`.
// BaseLayout picks the path from the page's `lang` prop, so scrapers see
// localized titles/subtitles for /en/ and /es/ paths alike.
const PAGES: PageSpec[] = [
  {
    slug: 'default',
    cards: {
      en: { kind: 'static', title: 'Rastrum',                       subtitle: 'Open biodiversity identification platform for Latin America.',          accent: 'emerald' },
      es: { kind: 'static', title: 'Rastrum',                       subtitle: 'Plataforma de identificación de biodiversidad para América Latina.',     accent: 'emerald' },
    },
  },
  {
    slug: 'home',
    cards: {
      en: { kind: 'static', title: 'Identify any living thing',     subtitle: 'Rastrum — biodiversity observed in your language.',                      accent: 'emerald' },
      es: { kind: 'static', title: 'Identifica cualquier ser vivo', subtitle: 'Rastrum — biodiversidad observada en tu idioma.',                        accent: 'emerald' },
    },
  },
  {
    slug: 'observe',
    cards: {
      en: { kind: 'static', title: 'Observe nature',                subtitle: 'Upload photos, audio, evidence. Works offline too.',                     accent: 'emerald' },
      es: { kind: 'static', title: 'Observa la naturaleza',         subtitle: 'Sube fotos, audio o evidencia. Sin conexión también funciona.',          accent: 'emerald' },
    },
  },
  {
    slug: 'identify',
    cards: {
      en: { kind: 'static', title: 'Identify a species',            subtitle: 'PlantNet · Claude · GPT-4o · Gemini — all in parallel.',                accent: 'emerald' },
      es: { kind: 'static', title: 'Identifica una especie',        subtitle: 'PlantNet · Claude · GPT-4o · Gemini — todos en paralelo.',              accent: 'emerald' },
    },
  },
  {
    slug: 'explore',
    cards: {
      en: { kind: 'static', title: 'Explore observations',          subtitle: 'Map, species, recent, watchlist.',                                       accent: 'teal' },
      es: { kind: 'static', title: 'Explora observaciones',         subtitle: 'Mapa, especies, recientes, seguimiento.',                                accent: 'teal' },
    },
  },
  {
    slug: 'chat',
    cards: {
      en: { kind: 'static', title: 'Chat about biodiversity',       subtitle: 'Ask anything about the flora and fauna you observe.',                    accent: 'sky' },
      es: { kind: 'static', title: 'Conversa sobre biodiversidad',  subtitle: 'Pregunta cualquier cosa sobre la flora y fauna que observas.',           accent: 'sky' },
    },
  },
  {
    slug: 'about',
    cards: {
      en: { kind: 'static', title: 'About Rastrum',                 subtitle: 'Open source · Offline-first · Indigenous-language ready.',               accent: 'stone' },
      es: { kind: 'static', title: 'Acerca de Rastrum',             subtitle: 'Código abierto · Sin conexión · Lenguas indígenas.',                     accent: 'stone' },
    },
  },
  {
    slug: 'docs-roadmap',
    cards: {
      en: { kind: 'static', title: 'Roadmap',                       subtitle: 'What we shipped and what comes next.',                                   accent: 'stone' },
      es: { kind: 'static', title: 'Hoja de ruta',                  subtitle: 'Lo que se ha enviado y lo que viene a continuación.',                    accent: 'stone' },
    },
  },
  {
    slug: 'docs-architecture',
    cards: {
      en: { kind: 'static', title: 'Architecture',                  subtitle: 'Astro · Supabase · R2 · WebLLM · ONNX.',                                  accent: 'stone' },
      es: { kind: 'static', title: 'Arquitectura',                  subtitle: 'Astro · Supabase · R2 · WebLLM · ONNX.',                                  accent: 'stone' },
    },
  },
  {
    slug: 'docs-contribute',
    cards: {
      en: { kind: 'static', title: 'Contribute',                    subtitle: 'Open source under AGPL-3.0. Join the team.',                             accent: 'stone' },
      es: { kind: 'static', title: 'Contribuye',                    subtitle: 'Código abierto bajo AGPL-3.0. Únete al equipo.',                         accent: 'stone' },
    },
  },
  {
    slug: 'profile-dex',
    cards: {
      en: { kind: 'static', title: 'Your species log',              subtitle: 'A living Pokédex of every species you have observed.',                   accent: 'emerald' },
      es: { kind: 'static', title: 'Tu registro de especies',       subtitle: 'Un Pokédex vivo de todas las especies que has observado.',               accent: 'emerald' },
    },
  },
  {
    slug: 'profile-dex-visitor',
    cards: {
      en: { kind: 'static', title: 'Visitor Pokédex',               subtitle: 'A public species log — gated by the per-facet privacy matrix.',          accent: 'emerald' },
      es: { kind: 'static', title: 'Pokédex de visitante',          subtitle: 'Un registro público de especies — controlado por la matriz de privacidad.', accent: 'emerald' },
    },
  },
  {
    slug: 'profile-settings',
    cards: {
      en: { kind: 'static', title: 'Settings',                      subtitle: 'Profile, preferences, data, developer.',                                 accent: 'stone' },
      es: { kind: 'static', title: 'Ajustes',                       subtitle: 'Perfil, preferencias, datos, desarrollador.',                            accent: 'stone' },
    },
  },
  {
    slug: 'validate',
    cards: {
      en: { kind: 'static', title: 'Validate observations',         subtitle: 'Help confirm community species identifications.',                        accent: 'teal' },
      es: { kind: 'static', title: 'Valida observaciones',          subtitle: 'Ayuda a confirmar identificaciones de la comunidad.',                    accent: 'teal' },
    },
  },
  {
    slug: 'community-observers',
    cards: {
      en: { kind: 'static', title: 'Community observers',           subtitle: 'Find observers by activity, expertise, location, or country.',           accent: 'teal' },
      es: { kind: 'static', title: 'Observadores de la comunidad',  subtitle: 'Encuentra observadores por actividad, experiencia, ubicación o país.',   accent: 'teal' },
    },
  },
  {
    slug: 'inbox',
    cards: {
      en: { kind: 'static', title: 'Activity inbox',                subtitle: 'Follows, reactions, comments, and identifications on your work.',         accent: 'sky' },
      es: { kind: 'static', title: 'Bandeja de actividad',          subtitle: 'Follows, reacciones, comentarios e identificaciones de tu trabajo.',     accent: 'sky' },
    },
  },
  {
    slug: 'projects',
    cards: {
      en: { kind: 'static', title: 'Projects (ANP polygons)',       subtitle: 'Define a polygon, then observations inside auto-tag into your project.',   accent: 'orange' },
      es: { kind: 'static', title: 'Proyectos (polígonos ANP)',     subtitle: 'Define un polígono y las observaciones dentro se auto-etiquetan.',         accent: 'orange' },
    },
  },
  {
    slug: 'sponsoring',
    cards: {
      en: { kind: 'static', title: 'AI sponsorships',               subtitle: 'Share your AI credentials with specific beneficiaries. Caps + auto-pause.', accent: 'amber' },
      es: { kind: 'static', title: 'Patrocinios de IA',             subtitle: 'Comparte tus credenciales de IA con beneficiarios. Topes + auto-pausa.',  accent: 'amber' },
    },
  },
  {
    slug: 'sponsored-by',
    cards: {
      en: { kind: 'static', title: 'Sponsored by',                  subtitle: 'See who is sharing AI capacity with you.',                                 accent: 'amber' },
      es: { kind: 'static', title: 'Patrocinado por',               subtitle: 'Quién comparte capacidad de IA contigo.',                                  accent: 'amber' },
    },
  },
  {
    slug: 'console',
    cards: {
      en: { kind: 'static', title: 'Admin console',                 subtitle: 'Operator + moderator + expert dashboard. 36 handlers, 7 entity browsers.', accent: 'slate' },
      es: { kind: 'static', title: 'Consola de administración',     subtitle: 'Dashboard de operador, moderador y experto. 36 handlers, 7 navegadores.',  accent: 'slate' },
    },
  },
];

async function renderOne(slug: string, lang: Lang, card: StaticCardInput, fontBold: ArrayBuffer, fontRegular: ArrayBuffer): Promise<Buffer> {
  const tree = buildOgTree(card);
  // satori expects a React-style element; our tree is shape-compatible.
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      { name: 'DM Sans', data: fontBold,    weight: 700, style: 'normal' },
      { name: 'DM Sans', data: fontRegular, weight: 400, style: 'normal' },
    ],
  });
  const png = new Resvg(svg, {
    fitTo: { mode: 'width', value: OG_WIDTH },
  }).render().asPng();
  const outPath = path.join(OUT_DIR, lang, `${slug}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`  ✓ ${lang}/${slug}.png  (${(png.length / 1024).toFixed(1)} KB)`);
  return png;
}

// PWA screenshot specs — required by Chrome's "Richer PWA Install UI"
// (one wide for desktop, one narrow for mobile). Stored under
// public/screenshots/<slug>.png and referenced from manifest.webmanifest.
const SCREENSHOTS_DIR = path.join(ROOT, 'public', 'screenshots');
interface ScreenshotSpec {
  slug: string;
  width: number;
  height: number;
  card: StaticCardInput;
}
const SCREENSHOTS: ScreenshotSpec[] = [
  {
    slug: 'desktop-home',
    width: 1280,
    height: 720,
    card: {
      kind: 'static',
      title: 'Rastrum',
      subtitle: 'Identifica plantas, animales y hongos. Sin conexión. En tu idioma.',
      accent: 'emerald',
    },
  },
  {
    slug: 'mobile-home',
    width: 750,
    height: 1334,
    card: {
      kind: 'static',
      title: 'Rastrum',
      subtitle: 'Captura una foto. Identifícala al instante. Sin conexión.',
      accent: 'emerald',
    },
  },
];

async function renderScreenshot(spec: ScreenshotSpec, fontBold: ArrayBuffer, fontRegular: ArrayBuffer): Promise<void> {
  // The OG-card layout was designed for 1200×630; reuse the same satori
  // tree but tell satori the canvas is the screenshot's dimensions.
  // satori scales children proportionally; if the layout doesn't fit, it
  // re-flows. Acceptable for the install-UI screenshots (informational).
  const tree = buildOgTree(spec.card);
  const svg = await satori(tree as unknown as Parameters<typeof satori>[0], {
    width: spec.width,
    height: spec.height,
    fonts: [
      { name: 'DM Sans', data: fontBold,    weight: 700, style: 'normal' },
      { name: 'DM Sans', data: fontRegular, weight: 400, style: 'normal' },
    ],
  });
  const png = new Resvg(svg, { fitTo: { mode: 'width', value: spec.width } }).render().asPng();
  const outPath = path.join(SCREENSHOTS_DIR, `${spec.slug}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`  ✓ screenshots/${spec.slug}.png  (${spec.width}×${spec.height}, ${(png.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  for (const fp of [FONT_BOLD_PATH, FONT_REGULAR_PATH]) {
    if (!fs.existsSync(fp)) {
      throw new Error(`Font not found at ${fp}. Download DMSans-{Bold,Regular}.ttf into public/fonts/.`);
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  for (const lang of LANGS) {
    fs.mkdirSync(path.join(OUT_DIR, lang), { recursive: true });
  }
  fs.mkdirSync(SCREENSHOTS_DIR, { recursive: true });
  // Convert Buffer → ArrayBuffer (satori's Font['data'] type expects
  // ArrayBuffer | Buffer, not Uint8Array). The slice() copies.
  const toAb = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const fontBold    = toAb(fs.readFileSync(FONT_BOLD_PATH));
  const fontRegular = toAb(fs.readFileSync(FONT_REGULAR_PATH));
  const total = PAGES.length * LANGS.length;
  console.log(`Generating ${total} OG cards into public/og/{en,es}/…`);
  for (const spec of PAGES) {
    let esPng: Buffer | null = null;
    for (const lang of LANGS) {
      const png = await renderOne(spec.slug, lang, spec.cards[lang], fontBold, fontRegular);
      if (lang === 'es') esPng = png;
    }
    // Backward-compat shim for cached scrapers (Facebook/Twitter/LinkedIn)
    // that already indexed the legacy /og/<slug>.png path. The legacy
    // location matches the original Spanish content.
    if (esPng) {
      const legacyPath = path.join(OUT_DIR, `${spec.slug}.png`);
      fs.writeFileSync(legacyPath, esPng);
    }
  }
  console.log(`Generating ${SCREENSHOTS.length} PWA screenshots into public/screenshots/…`);
  for (const spec of SCREENSHOTS) {
    await renderScreenshot(spec, fontBold, fontRegular);
  }
  console.log(`Done.`);
}

main().catch((err) => {
  console.error('OG generation failed:', err);
  process.exit(1);
});
