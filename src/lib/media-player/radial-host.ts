import type { AudioPlayerEngine } from './types';

interface BirdNetCandidate { scientific_name: string; common_name_en: string | null; score: number; }
interface BirdNetSegment { startSec: number; endSec: number; top: BirdNetCandidate[]; }

const SPECIES_COLORS = [
  { rgb: [16,185,129] }, { rgb: [251,191,36] }, { rgb: [167,139,250] },
  { rgb: [251,113,133] }, { rgb: [56,189,248] }, { rgb: [52,211,153] },
  { rgb: [249,115,22] }, { rgb: [232,121,249] },
];
const DEFAULT_COLOR_RGB = [16, 185, 129];
const CONF_THRESHOLD = 0.3;

export interface RadialHostOptions {
  container: HTMLElement;
  host: HTMLElement;
  engine: AudioPlayerEngine;
  playButton: HTMLElement;
  diameter?: number;
}

export function mountRadial(opts: RadialHostOptions): () => void {
  const { container, host, engine, playButton } = opts;
  const diameter = opts.diameter ?? 220;

  host.style.cssText = `position:relative;width:${diameter}px;height:${diameter}px;background:#09090b;border-radius:9999px;overflow:hidden;margin:0 auto;`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  playButton.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:64px;height:64px;border-radius:9999px;border:none;background:rgba(16,185,129,0.85);color:#fff;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;box-shadow:0 4px 16px rgba(0,0,0,0.4);`;
  host.appendChild(playButton);

  const speciesEl = document.createElement('span');
  speciesEl.style.cssText = 'position:absolute;left:0;right:0;bottom:14px;text-align:center;font-size:11px;font-style:italic;font-weight:600;color:rgba(255,255,255,0.85);text-shadow:0 1px 4px rgba(0,0,0,0.6);pointer-events:none;z-index:1;';
  host.appendChild(speciesEl);

  const ctx = canvas.getContext('2d');
  let audioCtx: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let source: MediaElementAudioSourceNode | null = null;
  let animId = 0;
  let connected = false;

  function getSpeciesAtTime(timeSec: number): { scientific: string; color: number[] } | null {
    const segments = (container as HTMLElement & { __birdnetSegments?: BirdNetSegment[] }).__birdnetSegments;
    if (!segments) return null;
    for (const seg of segments) {
      if (timeSec >= seg.startSec && timeSec <= seg.endSec && seg.top[0]?.score >= CONF_THRESHOLD) {
        const speciesOrder: string[] = [];
        for (const s of segments) {
          if (s.top[0]?.score >= CONF_THRESHOLD && !speciesOrder.includes(s.top[0].scientific_name)) {
            speciesOrder.push(s.top[0].scientific_name);
          }
        }
        const idx = speciesOrder.indexOf(seg.top[0].scientific_name);
        return { scientific: seg.top[0].scientific_name, color: SPECIES_COLORS[idx % SPECIES_COLORS.length].rgb };
      }
    }
    return null;
  }

  function connect(): void {
    if (connected) return;
    const media = engine.getMediaElement();
    if (!media) return;
    try {
      audioCtx = new AudioContext();
      analyser = audioCtx.createAnalyser();
      analyser.fftSize = 256;
      source = audioCtx.createMediaElementSource(media);
      source.connect(analyser);
      analyser.connect(audioCtx.destination);
      connected = true;
    } catch {
      // createMediaElementSource is one-shot per element; fall through to idle.
    }
  }

  function draw(): void {
    if (!ctx) return;
    const dpr = window.devicePixelRatio || 1;
    const rect = canvas.getBoundingClientRect();
    const w = rect.width;
    const h = rect.height;
    canvas.width = w * dpr;
    canvas.height = h * dpr;
    ctx.setTransform(dpr, 0, 0, dpr, 0, 0);

    ctx.fillStyle = '#09090b';
    ctx.fillRect(0, 0, w, h);

    const cx = w / 2;
    const cy = h / 2;
    const innerR = Math.min(w, h) * 0.22;
    const maxBarH = Math.min(w, h) * 0.26;

    const playing = engine.isPlaying();
    const currentTime = engine.getCurrentTime();

    let dataArray: Uint8Array<ArrayBuffer>;
    if (analyser && connected) {
      dataArray = new Uint8Array(new ArrayBuffer(analyser.frequencyBinCount));
      analyser.getByteFrequencyData(dataArray);
    } else {
      const t = Date.now() / 1000;
      dataArray = new Uint8Array(new ArrayBuffer(64));
      for (let i = 0; i < 64; i++) {
        const base = playing ? 40 : 15;
        dataArray[i] = base + Math.sin(t * 1.5 + i * 0.3) * (playing ? 20 : 8);
      }
    }

    const species = playing ? getSpeciesAtTime(currentTime) : null;
    const baseColor = species ? species.color : DEFAULT_COLOR_RGB;
    speciesEl.textContent = species?.scientific ?? '';

    const barCount = dataArray.length;
    const angleStep = (Math.PI * 2) / barCount;
    for (let i = 0; i < barCount; i++) {
      const val = dataArray[i] / 255;
      const barH = val * maxBarH + 2;
      const angle = i * angleStep - Math.PI / 2;
      const x1 = cx + Math.cos(angle) * innerR;
      const y1 = cy + Math.sin(angle) * innerR;
      const x2 = cx + Math.cos(angle) * (innerR + barH);
      const y2 = cy + Math.sin(angle) * (innerR + barH);
      const alpha = 0.3 + val * 0.7;
      const bright = 0.7 + val * 0.3;
      ctx.beginPath();
      ctx.moveTo(x1, y1);
      ctx.lineTo(x2, y2);
      ctx.strokeStyle = `rgba(${Math.round(baseColor[0]*bright)},${Math.round(baseColor[1]*bright)},${Math.round(baseColor[2]*bright)},${alpha})`;
      ctx.lineWidth = Math.max(2, (w / barCount) * 0.6);
      ctx.lineCap = 'round';
      ctx.stroke();
    }

    animId = requestAnimationFrame(draw);
  }

  const unsubPlay = engine.on('play', () => {
    connect();
    if (audioCtx?.state === 'suspended') void audioCtx.resume();
    if (!animId) animId = requestAnimationFrame(draw);
  });

  animId = requestAnimationFrame(draw);

  return () => {
    unsubPlay();
    if (animId) { cancelAnimationFrame(animId); animId = 0; }
    try { source?.disconnect(); analyser?.disconnect(); void audioCtx?.close(); } catch { /* ignore */ }
    host.replaceChildren();
  };
}
