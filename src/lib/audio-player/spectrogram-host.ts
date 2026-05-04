import type { AudioPlayerEngine, AudioPlayerSize } from './types';

function buildInfernoColormap(): [number, number, number, number][] {
  const stops: [number, [number, number, number]][] = [
    [0, [0,0,4]], [0.13, [31,12,72]], [0.25, [85,15,109]], [0.38, [139,34,82]],
    [0.50, [188,55,84]], [0.63, [229,107,54]], [0.75, [246,163,10]],
    [0.88, [250,213,43]], [1.0, [252,255,164]],
  ];
  const out: [number, number, number, number][] = [];
  for (let i = 0; i < 256; i++) {
    const t = i / 255;
    let lo = stops[0], hi = stops[stops.length - 1];
    for (let j = 0; j < stops.length - 1; j++) {
      if (t >= stops[j][0] && t <= stops[j + 1][0]) { lo = stops[j]; hi = stops[j + 1]; break; }
    }
    const span = hi[0] - lo[0];
    const f = span > 0 ? (t - lo[0]) / span : 0;
    out.push([
      Math.round(lo[1][0] + f * (hi[1][0] - lo[1][0])) / 255,
      Math.round(lo[1][1] + f * (hi[1][1] - lo[1][1])) / 255,
      Math.round(lo[1][2] + f * (hi[1][2] - lo[1][2])) / 255, 1,
    ]);
  }
  return out;
}

function drawPlaceholder(host: HTMLElement): void {
  const canvas = document.createElement('canvas');
  const w = host.clientWidth || 400;
  const h = host.clientHeight || 140;
  canvas.width = w * 2;
  canvas.height = h * 2;
  canvas.style.cssText = `width:100%;height:${h}px;display:block;opacity:0.35;`;
  const ctx = canvas.getContext('2d');
  if (!ctx) { host.appendChild(canvas); return; }
  ctx.fillStyle = '#09090b';
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  const cmap = buildInfernoColormap();
  for (let x = 0; x < canvas.width; x += 4) {
    const seed = Math.sin(x * 0.013) * Math.cos(x * 0.007);
    const t = (seed + 1) / 2;
    for (let y = 0; y < canvas.height; y += 2) {
      const fy = 1 - y / canvas.height;
      const i = Math.floor(t * fy * 255);
      const c = cmap[i] ?? cmap[0];
      ctx.fillStyle = `rgba(${Math.round(c[0]*255)},${Math.round(c[1]*255)},${Math.round(c[2]*255)},0.5)`;
      ctx.fillRect(x, y, 4, 2);
    }
  }
  host.replaceChildren(canvas);
}

export interface SpectrogramHostOptions {
  size: Extract<AudioPlayerSize, 'md' | 'lg'>;
  host: HTMLElement;
  engine: AudioPlayerEngine;
  wavesurfer: unknown;
  frequencyMax?: number;
}

export function mountSpectrogram(opts: SpectrogramHostOptions): () => void {
  const { size, host, engine, wavesurfer } = opts;
  const frequencyMax = opts.frequencyMax ?? 12000;
  let registered = false;
  let unsubReady: (() => void) | null = null;
  let unsubPlay: (() => void) | null = null;

  drawPlaceholder(host);

  async function register(): Promise<void> {
    if (registered) return;
    registered = true;
    try {
      const SpectrogramPlugin = (await import('wavesurfer.js/plugins/spectrogram')).default;
      const plugin = SpectrogramPlugin.create({
        container: host,
        labels: true,
        labelsBackground: 'rgba(9,9,11,0.7)',
        labelsColor: '#a1a1aa',
        labelsHzColor: '#a1a1aa',
        height: 140,
        frequencyMax,
        frequencyMin: 0,
        fftSamples: 512,
        colorMap: buildInfernoColormap(),
      });
      host.replaceChildren();
      (wavesurfer as { registerPlugin: (p: unknown) => unknown }).registerPlugin(plugin);
    } catch (e) {
      console.warn('[rastrum] spectrogram failed:', e);
    }
  }

  if (size === 'lg') {
    unsubReady = engine.on('ready', () => { void register(); });
  } else {
    unsubPlay = engine.on('play', () => { void register(); });
  }

  return () => {
    unsubReady?.();
    unsubPlay?.();
    host.replaceChildren();
  };
}
