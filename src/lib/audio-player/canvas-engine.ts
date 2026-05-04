import type { AudioPlayerEngine, AudioPlayerEvent } from './types';

const peakCache = new Map<string, Float32Array>();

async function fetchPeaks(url: string): Promise<Float32Array> {
  const cached = peakCache.get(url);
  if (cached) return cached;
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const Ctor = window.AudioContext
    ?? (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
  const actx = new Ctor();
  const decoded = await actx.decodeAudioData(buf);
  await actx.close();
  const raw = decoded.getChannelData(0);
  const bars = 100;
  const step = Math.max(1, Math.floor(raw.length / bars));
  const peaks = new Float32Array(bars);
  for (let i = 0; i < bars; i++) {
    let max = 0;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(raw[i * step + j] ?? 0);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  peakCache.set(url, peaks);
  return peaks;
}

function drawWaveform(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  peaks: Float32Array,
  progress: number,
  barColor: string,
  progressColor: string,
): void {
  ctx.clearRect(0, 0, w, h);
  const bars = peaks.length;
  const barW = (w / bars) * 0.7;
  const gap  = (w / bars) * 0.3;
  const maxPeak = Math.max(...peaks) || 1;
  const progressX = progress * w;
  for (let i = 0; i < bars; i++) {
    const x = i * (barW + gap) + gap / 2;
    const barH = Math.max(2, (peaks[i] / maxPeak) * h * 0.8);
    const y = (h - barH) / 2;
    ctx.fillStyle = x < progressX ? progressColor : barColor;
    ctx.globalAlpha = x < progressX ? 0.9 : 0.5;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, barW / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

function drawPlaceholderBars(
  ctx: CanvasRenderingContext2D, w: number, h: number, color: string,
): void {
  ctx.clearRect(0, 0, w, h);
  const bars = 30;
  const barW = (w / bars) * 0.6;
  const gap  = (w / bars) * 0.4;
  for (let i = 0; i < bars; i++) {
    const x = i * (barW + gap) + gap / 2;
    const seed = Math.sin(i * 12.9898 + 78.233) * 43758.5453;
    const r = seed - Math.floor(seed);
    const barH = Math.max(4, r * h * 0.6);
    const y = (h - barH) / 2;
    ctx.fillStyle = color;
    ctx.globalAlpha = 0.25;
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, barW / 2);
    ctx.fill();
  }
  ctx.globalAlpha = 1;
}

export interface CanvasEngineHosts {
  canvas: HTMLCanvasElement;
  audio: HTMLAudioElement;
}

const BAR_COLOR = '#10b981';
const PROGRESS_COLOR = '#34d399';

export function createCanvasEngine(url: string, hosts: CanvasEngineHosts): AudioPlayerEngine {
  const { canvas, audio } = hosts;
  audio.src = url;
  audio.crossOrigin = 'anonymous';
  audio.preload = 'metadata';

  const ctx = canvas.getContext('2d');
  let peaks: Float32Array | null = null;
  let animFrame = 0;

  const listeners: Record<AudioPlayerEvent, Set<() => void>> = {
    ready: new Set(), play: new Set(), pause: new Set(),
    finish: new Set(), timeupdate: new Set(), error: new Set(),
  };
  const fire = (e: AudioPlayerEvent) => { for (const cb of listeners[e]) cb(); };

  function draw() {
    if (!ctx || !peaks) return;
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    drawWaveform(ctx, canvas.width, canvas.height, peaks, progress, BAR_COLOR, PROGRESS_COLOR);
  }

  function tick() {
    if (audio.paused || audio.ended) return;
    draw();
    fire('timeupdate');
    animFrame = requestAnimationFrame(tick);
  }

  if (ctx) drawPlaceholderBars(ctx, canvas.width, canvas.height, BAR_COLOR);
  fetchPeaks(url).then(p => {
    peaks = p;
    draw();
    fire('ready');
  }).catch(() => fire('error'));

  audio.addEventListener('play', () => { fire('play'); animFrame = requestAnimationFrame(tick); });
  audio.addEventListener('pause', () => { cancelAnimationFrame(animFrame); fire('pause'); });
  audio.addEventListener('ended', () => {
    cancelAnimationFrame(animFrame);
    if (peaks && ctx) drawWaveform(ctx, canvas.width, canvas.height, peaks, 0, BAR_COLOR, PROGRESS_COLOR);
    fire('finish');
  });
  audio.addEventListener('error', () => fire('error'));

  return {
    play: () => audio.play(),
    pause: () => audio.pause(),
    seek: (t) => { audio.currentTime = t; draw(); },
    setVolume: (v) => { audio.volume = v; },
    getCurrentTime: () => audio.currentTime,
    getDuration: () => audio.duration || 0,
    isPlaying: () => !audio.paused && !audio.ended,
    getMediaElement: () => audio,
    on: (event, cb) => {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    destroy: () => {
      cancelAnimationFrame(animFrame);
      audio.pause();
      audio.removeAttribute('src');
      audio.load();
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}
