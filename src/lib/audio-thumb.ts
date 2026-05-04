/**
 * audio-thumb.ts — compact inline audio player for observation thumbnails.
 *
 * Renders a mini waveform with play/pause into any container element.
 * Uses the native Web Audio API to decode and draw the waveform — no
 * wavesurfer dependency, keeping the thumbnail lightweight (~3 KB).
 *
 * Usage:
 *   import { mountAudioThumb } from '../lib/audio-thumb';
 *   mountAudioThumb(containerEl, audioUrl);
 *
 * The container should have a fixed width/height (e.g. 64×64 for list
 * thumbnails, or 220×120 for map popups). The waveform fills the space.
 */

interface AudioThumbOptions {
  /** Bar color for the waveform. Default: emerald. */
  barColor?: string;
  /** Background color. Default: transparent (inherits). */
  bgColor?: string;
  /** Progress bar color during playback. */
  progressColor?: string;
  /** Show a text label below the waveform. */
  label?: string;
  /** Compact mode for small thumbnails (64×64). Hides label, smaller button. */
  compact?: boolean;
}

/** Cache decoded waveform peaks per URL to avoid re-fetching. */
const peakCache = new Map<string, Float32Array>();

/**
 * Mount a compact audio player into the given container.
 * Returns a cleanup function that stops playback and removes listeners.
 */
export function mountAudioThumb(
  container: HTMLElement,
  audioUrl: string,
  opts: AudioThumbOptions = {},
): () => void {
  const {
    barColor = '#10b981',
    progressColor = '#34d399',
    label,
    compact = false,
  } = opts;

  const isDark = document.documentElement.classList.contains('dark');
  const bg = isDark ? '#18181b' : '#f4f4f5';
  const btnBg = isDark ? 'rgba(16,163,98,0.2)' : 'rgba(16,163,98,0.1)';
  const btnColor = isDark ? '#34d399' : '#059669';

  // Shell
  container.style.cssText = `position:relative;overflow:hidden;background:${bg};display:flex;flex-direction:column;align-items:center;justify-content:center;cursor:pointer;`;

  // Canvas for waveform
  const canvas = document.createElement('canvas');
  const w = container.clientWidth || 220;
  const h = compact ? (container.clientHeight || 64) : Math.min(container.clientHeight || 120, 120);
  canvas.width = w * 2; // retina
  canvas.height = h * 2;
  canvas.style.cssText = `width:100%;height:${h}px;display:block;`;
  container.appendChild(canvas);

  // Play button overlay
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', 'Play');
  const btnSize = compact ? 28 : 36;
  btn.style.cssText = `position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:${btnSize}px;height:${btnSize}px;border-radius:50%;border:none;background:${btnBg};color:${btnColor};display:flex;align-items:center;justify-content:center;cursor:pointer;transition:transform 0.15s,background 0.15s;z-index:2;`;
  const iconSize = compact ? 12 : 16;
  btn.innerHTML = `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
  container.appendChild(btn);

  // Progress overlay
  const progressEl = document.createElement('div');
  progressEl.style.cssText = `position:absolute;top:0;left:0;bottom:0;width:0%;background:${progressColor};opacity:0.12;pointer-events:none;transition:width 0.1s linear;z-index:1;`;
  container.appendChild(progressEl);

  // Label
  if (label && !compact) {
    const lbl = document.createElement('span');
    lbl.textContent = label;
    lbl.style.cssText = `position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:${isDark ? 'rgba(52,211,153,0.6)' : 'rgba(5,150,105,0.6)'};z-index:2;`;
    container.appendChild(lbl);
  }

  // Loading state — draw placeholder bars
  const ctx = canvas.getContext('2d');
  if (ctx) drawPlaceholderBars(ctx, canvas.width, canvas.height, barColor);

  let audio: HTMLAudioElement | null = null;
  let playing = false;
  let animFrame = 0;
  let peaks: Float32Array | null = null;

  // Fetch + decode waveform
  const cached = peakCache.get(audioUrl);
  if (cached) {
    peaks = cached;
    if (ctx) drawWaveform(ctx, canvas.width, canvas.height, peaks, 0, barColor, progressColor);
  } else {
    fetchPeaks(audioUrl).then(p => {
      peaks = p;
      peakCache.set(audioUrl, p);
      if (ctx) drawWaveform(ctx, canvas.width, canvas.height, peaks, 0, barColor, progressColor);
    }).catch(() => {
      // Keep placeholder bars on error
    });
  }

  function toggle() {
    if (!audio) {
      audio = new Audio(audioUrl);
      audio.crossOrigin = 'anonymous';
      audio.addEventListener('ended', () => {
        playing = false;
        cancelAnimationFrame(animFrame);
        updateBtn();
        progressEl.style.width = '0%';
        if (peaks && ctx) drawWaveform(ctx, canvas.width, canvas.height, peaks, 0, barColor, progressColor);
      });
    }
    if (playing) {
      audio.pause();
      playing = false;
      cancelAnimationFrame(animFrame);
    } else {
      audio.play().catch(() => { /* autoplay blocked */ });
      playing = true;
      tick();
    }
    updateBtn();
  }

  function tick() {
    if (!playing || !audio) return;
    const progress = audio.duration ? audio.currentTime / audio.duration : 0;
    progressEl.style.width = `${progress * 100}%`;
    if (peaks && ctx) drawWaveform(ctx, canvas.width, canvas.height, peaks, progress, barColor, progressColor);
    animFrame = requestAnimationFrame(tick);
  }

  function updateBtn() {
    const icon = playing
      ? `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="currentColor"><path d="M6 4h4v16H6zM14 4h4v16h-4z"/></svg>`
      : `<svg width="${iconSize}" height="${iconSize}" viewBox="0 0 24 24" fill="currentColor"><path d="M8 5v14l11-7z"/></svg>`;
    btn.innerHTML = icon;
    btn.setAttribute('aria-label', playing ? 'Pause' : 'Play');
  }

  btn.addEventListener('click', (e) => { e.stopPropagation(); toggle(); });
  container.addEventListener('click', toggle);

  // Cleanup
  return () => {
    cancelAnimationFrame(animFrame);
    if (audio) { audio.pause(); audio.src = ''; }
    container.removeEventListener('click', toggle);
  };
}

/** Decode audio and extract peaks for waveform drawing. */
async function fetchPeaks(url: string): Promise<Float32Array> {
  const resp = await fetch(url);
  const buf = await resp.arrayBuffer();
  const actx = new (window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext)();
  const decoded = await actx.decodeAudioData(buf);
  await actx.close();
  const raw = decoded.getChannelData(0);
  // Downsample to ~100 bars
  const bars = 100;
  const step = Math.floor(raw.length / bars);
  const peaks = new Float32Array(bars);
  for (let i = 0; i < bars; i++) {
    let max = 0;
    for (let j = 0; j < step; j++) {
      const v = Math.abs(raw[i * step + j] ?? 0);
      if (v > max) max = v;
    }
    peaks[i] = max;
  }
  return peaks;
}

/** Draw the waveform bars with progress coloring. */
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
  const gap = (w / bars) * 0.3;
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

/** Draw static placeholder bars before audio is decoded. */
function drawPlaceholderBars(
  ctx: CanvasRenderingContext2D,
  w: number, h: number,
  color: string,
): void {
  ctx.clearRect(0, 0, w, h);
  const bars = 30;
  const barW = (w / bars) * 0.6;
  const gap = (w / bars) * 0.4;
  for (let i = 0; i < bars; i++) {
    const x = i * (barW + gap) + gap / 2;
    // Pseudo-random heights for visual interest
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
