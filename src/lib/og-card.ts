/**
 * Client-side OG card renderer for user-generated content (observations,
 * profiles). Uses the same `og-layout.ts` tree as the build-time
 * generator so the visual stays in lockstep.
 *
 * Strategy: satori produces an SVG string in the browser; we paint it
 * onto an OffscreenCanvas via a Blob URL + Image, then `convertToBlob`
 * to get a 1200×630 PNG. The result is PUT to R2 alongside the photo
 * at `og/<obs-id>.png`. After that, `og:image` meta tags reference
 * `https://media.rastrum.org/og/<obs-id>.png` — a static file served
 * by Cloudflare's CDN, no per-request server compute, no edge worker.
 *
 * Fonts are fetched once on first use and memoised in the module
 * scope. Satori is a dynamic import so the bundle cost (~150 KB
 * gzipped) only lands when an observation is actually being saved.
 */
import { OG_WIDTH, OG_HEIGHT, buildOgTree, type ObservationCardInput, type ProfileCardInput } from './og-layout';

const FONT_BASE = '/fonts';
let fontPromise: Promise<{ bold: ArrayBuffer; regular: ArrayBuffer }> | null = null;

async function loadFonts(): Promise<{ bold: ArrayBuffer; regular: ArrayBuffer }> {
  if (fontPromise) return fontPromise;
  fontPromise = (async () => {
    const [boldRes, regRes] = await Promise.all([
      fetch(`${FONT_BASE}/DMSans-Bold.ttf`),
      fetch(`${FONT_BASE}/DMSans-Regular.ttf`),
    ]);
    if (!boldRes.ok || !regRes.ok) throw new Error('og-card: font fetch failed');
    const [bold, regular] = await Promise.all([boldRes.arrayBuffer(), regRes.arrayBuffer()]);
    return { bold, regular };
  })();
  return fontPromise;
}

async function svgFromTree(tree: ReturnType<typeof buildOgTree>): Promise<string> {
  const { default: satori } = await import('satori');
  const fonts = await loadFonts();
  return satori(tree as unknown as Parameters<typeof satori>[0], {
    width: OG_WIDTH,
    height: OG_HEIGHT,
    fonts: [
      { name: 'DM Sans', data: fonts.bold,    weight: 700, style: 'normal' },
      { name: 'DM Sans', data: fonts.regular, weight: 400, style: 'normal' },
    ],
  });
}

/**
 * Rasterise an SVG string to a 1200×630 PNG Blob via the browser's
 * canvas. Works in all modern browsers; no WASM rasterizer needed.
 */
async function svgToPng(svg: string): Promise<Blob> {
  const blob = new Blob([svg], { type: 'image/svg+xml' });
  const url = URL.createObjectURL(blob);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('og-card: SVG image load failed'));
      i.src = url;
    });
    const canvas = ('OffscreenCanvas' in window)
      ? new OffscreenCanvas(OG_WIDTH, OG_HEIGHT)
      : Object.assign(document.createElement('canvas'), { width: OG_WIDTH, height: OG_HEIGHT });
    const ctx = canvas.getContext('2d') as CanvasRenderingContext2D | OffscreenCanvasRenderingContext2D | null;
    if (!ctx) throw new Error('og-card: no 2d context');
    ctx.drawImage(img, 0, 0, OG_WIDTH, OG_HEIGHT);
    if ('convertToBlob' in canvas) {
      return await (canvas as OffscreenCanvas).convertToBlob({ type: 'image/png' });
    }
    return await new Promise<Blob>((resolve, reject) => {
      (canvas as HTMLCanvasElement).toBlob(b => b ? resolve(b) : reject(new Error('toBlob null')), 'image/png');
    });
  } finally {
    URL.revokeObjectURL(url);
  }
}

/** Render an observation OG card; returns a 1200×630 PNG Blob. */
export async function renderObservationOgPng(input: Omit<ObservationCardInput, 'kind'>): Promise<Blob> {
  const tree = buildOgTree({ kind: 'observation', ...input });
  const svg = await svgFromTree(tree);
  return svgToPng(svg);
}

/** Render a profile OG card; returns a 1200×630 PNG Blob. */
export async function renderProfileOgPng(input: Omit<ProfileCardInput, 'kind'>): Promise<Blob> {
  const tree = buildOgTree({ kind: 'profile', ...input });
  const svg = await svgFromTree(tree);
  return svgToPng(svg);
}
