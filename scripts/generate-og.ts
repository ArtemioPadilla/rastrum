#!/usr/bin/env tsx
/**
 * Build-time OG card generator.
 *
 * Renders a 1200×630 PNG for every static page at `public/og/<slug>.png`,
 * served as a plain static file by GitHub Pages CDN — zero runtime
 * compute, zero per-request server-side. Pattern borrowed from
 * watchboard's social-preview pipeline.
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

interface PageSpec {
  slug: string;
  card: StaticCardInput;
}

// One PNG per surface that needs a custom OG. The slug becomes the
// filename (`public/og/<slug>.png`); pages reference it by setting
// `ogImage` in their frontmatter or via the BaseLayout default.
const PAGES: PageSpec[] = [
  { slug: 'default',           card: { kind: 'static', title: 'Rastrum',                       subtitle: 'Plataforma de identificación de biodiversidad para América Latina.', accent: 'emerald' } },
  { slug: 'home',              card: { kind: 'static', title: 'Identifica cualquier ser vivo', subtitle: 'Rastrum — biodiversidad observada en tu idioma.',                       accent: 'emerald' } },
  { slug: 'observe',           card: { kind: 'static', title: 'Observa la naturaleza',         subtitle: 'Sube fotos, audio o evidencia. Sin conexión también funciona.',          accent: 'emerald' } },
  { slug: 'identify',          card: { kind: 'static', title: 'Identifica una especie',        subtitle: 'PlantNet · Claude · Phi-3.5 — todos en paralelo.',                       accent: 'emerald' } },
  { slug: 'explore',           card: { kind: 'static', title: 'Explora observaciones',         subtitle: 'Mapa, especies, recientes, seguimiento.',                                accent: 'teal' } },
  { slug: 'chat',              card: { kind: 'static', title: 'Conversa sobre biodiversidad',  subtitle: 'Pregunta cualquier cosa sobre la flora y fauna que observas.',           accent: 'sky' } },
  { slug: 'about',             card: { kind: 'static', title: 'Acerca de Rastrum',             subtitle: 'Código abierto · Sin conexión · Lenguas indígenas.',                     accent: 'stone' } },
  { slug: 'docs-roadmap',      card: { kind: 'static', title: 'Hoja de ruta',                  subtitle: 'Lo que se ha enviado y lo que viene a continuación.',                    accent: 'stone' } },
  { slug: 'docs-architecture', card: { kind: 'static', title: 'Arquitectura',                  subtitle: 'Astro · Supabase · R2 · WebLLM · ONNX.',                                  accent: 'stone' } },
  { slug: 'docs-contribute',   card: { kind: 'static', title: 'Contribuye',                    subtitle: 'Código abierto bajo AGPL-3.0. Únete al equipo.',                          accent: 'stone' } },
];

async function renderOne(spec: PageSpec, fontBold: ArrayBuffer, fontRegular: ArrayBuffer): Promise<void> {
  const tree = buildOgTree(spec.card);
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
  const outPath = path.join(OUT_DIR, `${spec.slug}.png`);
  fs.writeFileSync(outPath, png);
  console.log(`  ✓ ${spec.slug}.png  (${(png.length / 1024).toFixed(1)} KB)`);
}

async function main() {
  for (const fp of [FONT_BOLD_PATH, FONT_REGULAR_PATH]) {
    if (!fs.existsSync(fp)) {
      throw new Error(`Font not found at ${fp}. Download DMSans-{Bold,Regular}.ttf into public/fonts/.`);
    }
  }
  fs.mkdirSync(OUT_DIR, { recursive: true });
  // Convert Buffer → ArrayBuffer (satori's Font['data'] type expects
  // ArrayBuffer | Buffer, not Uint8Array). The slice() copies.
  const toAb = (b: Buffer): ArrayBuffer => b.buffer.slice(b.byteOffset, b.byteOffset + b.byteLength) as ArrayBuffer;
  const fontBold    = toAb(fs.readFileSync(FONT_BOLD_PATH));
  const fontRegular = toAb(fs.readFileSync(FONT_REGULAR_PATH));
  console.log(`Generating ${PAGES.length} OG cards into public/og/…`);
  for (const spec of PAGES) {
    await renderOne(spec, fontBold, fontRegular);
  }
  console.log(`Done.`);
}

main().catch((err) => {
  console.error('OG generation failed:', err);
  process.exit(1);
});
