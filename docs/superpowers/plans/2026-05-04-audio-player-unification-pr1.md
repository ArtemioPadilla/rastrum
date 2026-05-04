# Audio Player Unification — PR1 Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:subagent-driven-development (recommended) or superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Land a new `src/lib/audio-player.ts` module exposing `mountAudioPlayer(container, url, opts)` with all four size variants (xs/sm/md/lg) wired and tested. **No caller migrations in this PR** — that's PR2 (`AudioPlayer.astro` + `share/obs/`) and PR3 (the eight remaining sites).

**Architecture:** A single mount function dispatches to one of two engines: a tiny canvas-based engine for `xs` (no wavesurfer dependency, copied logic from `audio-thumb.ts`), and a wavesurfer-backed engine for `sm`/`md`/`lg`. The DOM is built per-size with progressive feature unlock (scrub → spectrogram → radial). A module-level instance registry enforces "pause others on play" and broadcasts a global volume value persisted in `localStorage`.

**Tech Stack:** TypeScript (strict), Astro (only at the wrapper boundary in PR2), wavesurfer.js v7 (already in `package.json`), Web Audio API, vitest + happy-dom.

**Spec:** [`docs/superpowers/specs/2026-05-03-audio-player-unification-design.md`](../specs/2026-05-03-audio-player-unification-design.md)

---

## File Structure

| File | Responsibility |
|---|---|
| `src/lib/audio-player.ts` | Public API. `mountAudioPlayer(container, url, opts) → cleanup`. Dispatches to engine + builds shell. |
| `src/lib/audio-player/types.ts` | Shared types: `AudioPlayerSize`, `AudioPlayerOptions`, `AudioPlayerEngine`, `AudioPlayerHandle`. |
| `src/lib/audio-player/registry.ts` | Module-level Set of active handles. Implements pause-others-on-play + global volume broadcast. |
| `src/lib/audio-player/canvas-engine.ts` | xs renderer: canvas peaks + native `<audio>`. Adapted from `audio-thumb.ts`. |
| `src/lib/audio-player/wavesurfer-engine.ts` | sm/md/lg renderer: lazy-imports wavesurfer + spectrogram plugin. |
| `src/lib/audio-player/shell.ts` | Per-size DOM builder. Plays, time, volume, spectrogram host, radial host. |
| `src/lib/audio-player/volume-control.ts` | Inline (md/lg) or popover (sm) volume slider. Reads/writes `localStorage` + emits event. |
| `src/lib/audio-player/spectrogram-host.ts` | Manages placeholder + lazy-decode for md, eager mount for lg. |
| `src/lib/audio-player/radial-host.ts` | lg only. Wraps existing `initRadialVisualizer` logic with play button embedded in inner ring. |
| `src/lib/audio-player.test.ts` | Unit tests for the public API: mount/unmount, size dispatch, registry, volume persistence. |
| `src/lib/audio-player/registry.test.ts` | Unit tests for pause-others + volume broadcast. |
| `src/lib/audio-player/volume-control.test.ts` | Unit tests for volume persistence + event emission. |

**Why this split:** each piece has a single responsibility small enough to hold in context. Tests live next to what they exercise. `audio-thumb.ts` and `AudioPlayer.astro` are NOT touched in this PR — they keep working as-is until PR2/PR3 migrates callers.

---

## Task 1: Create types module

**Files:**
- Create: `src/lib/audio-player/types.ts`

- [ ] **Step 1: Write the types file**

```typescript
// src/lib/audio-player/types.ts

export type AudioPlayerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AudioPlayerOptions {
  /** Visual + feature variant. */
  size: AudioPlayerSize;
  /** Required for spectrogram + BirdNET overlay event wiring. Omit for xs. */
  obsId?: string;
  /** MIME type hint for the audio element. Default 'audio/mpeg'. */
  mimeType?: string;
  /** UI language. */
  lang: 'en' | 'es';
  /** lg only — start with spectrogram open. */
  autoExpand?: boolean;
  /** Optional bottom caption (xs/sm). */
  label?: string;
}

/** Engine-agnostic playback contract. Both canvas + wavesurfer engines satisfy this. */
export interface AudioPlayerEngine {
  play(): Promise<void>;
  pause(): void;
  seek(timeSec: number): void;
  setVolume(value: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  /** Returns the underlying HTMLMediaElement for Web Audio analyser hookups (radial). */
  getMediaElement(): HTMLMediaElement | null;
  /** Subscribe to engine events. Returns an unsubscriber. */
  on(event: AudioPlayerEvent, cb: () => void): () => void;
  destroy(): void;
}

export type AudioPlayerEvent =
  | 'ready'
  | 'play'
  | 'pause'
  | 'finish'
  | 'timeupdate'
  | 'error';

/** Returned by mountAudioPlayer; used internally by registry for pause-others. */
export interface AudioPlayerHandle {
  pause(): void;
  setVolume(value: number): void;
  destroy(): void;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio-player/types.ts
git commit -m "feat(audio-player): introduce types module"
```

---

## Task 2: Registry with pause-others + volume broadcast

**Files:**
- Create: `src/lib/audio-player/registry.ts`
- Test: `src/lib/audio-player/registry.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/audio-player/registry.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  registerHandle,
  unregisterHandle,
  pauseAllExcept,
  getStoredVolume,
  setStoredVolume,
  __resetForTests,
} from './registry';
import type { AudioPlayerHandle } from './types';

function makeHandle(): AudioPlayerHandle & { pauseCalls: number; volumeCalls: number[] } {
  const h: AudioPlayerHandle & { pauseCalls: number; volumeCalls: number[] } = {
    pauseCalls: 0,
    volumeCalls: [],
    pause() { this.pauseCalls += 1; },
    setVolume(v) { this.volumeCalls.push(v); },
    destroy() {},
  };
  return h;
}

describe('registry', () => {
  beforeEach(() => {
    __resetForTests();
    localStorage.clear();
  });

  it('pauses all handles except the one passed to pauseAllExcept', () => {
    const a = makeHandle();
    const b = makeHandle();
    const c = makeHandle();
    registerHandle(a);
    registerHandle(b);
    registerHandle(c);
    pauseAllExcept(b);
    expect(a.pauseCalls).toBe(1);
    expect(b.pauseCalls).toBe(0);
    expect(c.pauseCalls).toBe(1);
  });

  it('does not pause handles that have been unregistered', () => {
    const a = makeHandle();
    const b = makeHandle();
    registerHandle(a);
    registerHandle(b);
    unregisterHandle(a);
    pauseAllExcept(b);
    expect(a.pauseCalls).toBe(0);
  });

  it('persists volume to localStorage and broadcasts to all handles', () => {
    const a = makeHandle();
    const b = makeHandle();
    registerHandle(a);
    registerHandle(b);
    setStoredVolume(0.42);
    expect(localStorage.getItem('rastrum.audio.volume')).toBe('0.42');
    expect(a.volumeCalls).toEqual([0.42]);
    expect(b.volumeCalls).toEqual([0.42]);
  });

  it('returns 1.0 when no stored volume', () => {
    expect(getStoredVolume()).toBe(1);
  });

  it('returns the stored volume when present', () => {
    localStorage.setItem('rastrum.audio.volume', '0.3');
    expect(getStoredVolume()).toBe(0.3);
  });

  it('clamps stored volume into [0, 1]', () => {
    setStoredVolume(2);
    expect(getStoredVolume()).toBe(1);
    setStoredVolume(-0.5);
    expect(getStoredVolume()).toBe(0);
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/audio-player/registry.test.ts`
Expected: FAIL with "Cannot find module './registry'".

- [ ] **Step 3: Write the registry**

```typescript
// src/lib/audio-player/registry.ts
import type { AudioPlayerHandle } from './types';

const STORAGE_KEY = 'rastrum.audio.volume';
const handles = new Set<AudioPlayerHandle>();

export function registerHandle(h: AudioPlayerHandle): void {
  handles.add(h);
}

export function unregisterHandle(h: AudioPlayerHandle): void {
  handles.delete(h);
}

export function pauseAllExcept(except: AudioPlayerHandle): void {
  for (const h of handles) {
    if (h !== except) h.pause();
  }
}

function clamp01(v: number): number {
  if (Number.isNaN(v)) return 1;
  return Math.max(0, Math.min(1, v));
}

export function getStoredVolume(): number {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (raw === null) return 1;
    return clamp01(parseFloat(raw));
  } catch {
    return 1;
  }
}

export function setStoredVolume(value: number): void {
  const v = clamp01(value);
  try {
    localStorage.setItem(STORAGE_KEY, String(v));
  } catch {
    // localStorage unavailable (private mode); volume change still
    // broadcasts to live handles, just not persisted.
  }
  for (const h of handles) h.setVolume(v);
}

export function __resetForTests(): void {
  handles.clear();
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/audio-player/registry.test.ts`
Expected: PASS, 6 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio-player/registry.ts src/lib/audio-player/registry.test.ts
git commit -m "feat(audio-player): registry for pause-others + global volume"
```

---

## Task 3: Volume control (inline + popover)

**Files:**
- Create: `src/lib/audio-player/volume-control.ts`
- Test: `src/lib/audio-player/volume-control.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/audio-player/volume-control.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountVolumeControl } from './volume-control';
import { __resetForTests } from './registry';

describe('mountVolumeControl', () => {
  beforeEach(() => {
    __resetForTests();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('mounts an inline slider for size md/lg', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'md');
    const range = host.querySelector('input[type="range"]');
    expect(range).not.toBeNull();
    expect(host.querySelector('button[data-volume-toggle]')).toBeNull();
  });

  it('mounts an icon button (popover trigger) for size sm', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'sm');
    const btn = host.querySelector('button[data-volume-toggle]');
    expect(btn).not.toBeNull();
    // No visible slider until toggle clicked.
    const range = host.querySelector('input[type="range"]');
    expect(range).toBeNull();
  });

  it('writes slider changes through to setStoredVolume', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'md');
    const range = host.querySelector('input[type="range"]') as HTMLInputElement;
    range.value = '0.25';
    range.dispatchEvent(new Event('input'));
    expect(localStorage.getItem('rastrum.audio.volume')).toBe('0.25');
  });

  it('initializes slider from stored volume', () => {
    localStorage.setItem('rastrum.audio.volume', '0.6');
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'lg');
    const range = host.querySelector('input[type="range"]') as HTMLInputElement;
    expect(range.value).toBe('0.6');
  });

  it('opens popover with slider when sm icon clicked', () => {
    const host = document.createElement('div');
    document.body.appendChild(host);
    mountVolumeControl(host, 'sm');
    const btn = host.querySelector('button[data-volume-toggle]') as HTMLButtonElement;
    btn.click();
    const range = host.querySelector('input[type="range"]');
    expect(range).not.toBeNull();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/audio-player/volume-control.test.ts`
Expected: FAIL.

- [ ] **Step 3: Write the volume control**

```typescript
// src/lib/audio-player/volume-control.ts
import { getStoredVolume, setStoredVolume } from './registry';
import type { AudioPlayerSize } from './types';

const SPEAKER_ICON = `<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M3 10v4a1 1 0 001 1h3l4 4V5L7 9H4a1 1 0 00-1 1zm13.5 2a4.5 4.5 0 00-2.5-4.03v8.05A4.5 4.5 0 0016.5 12z"/></svg>`;

function buildSlider(): HTMLInputElement {
  const range = document.createElement('input');
  range.type = 'range';
  range.min = '0';
  range.max = '1';
  range.step = '0.01';
  range.value = String(getStoredVolume());
  range.setAttribute('aria-label', 'Volume');
  range.style.cssText = 'width:80px;accent-color:#10b981;cursor:pointer;';
  range.addEventListener('input', () => {
    setStoredVolume(parseFloat(range.value));
  });
  return range;
}

function buildIconButton(): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.dataset.volumeToggle = '1';
  btn.setAttribute('aria-label', 'Volume');
  btn.setAttribute('aria-expanded', 'false');
  btn.innerHTML = SPEAKER_ICON;
  btn.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;border-radius:9999px;color:currentColor;background:transparent;border:none;cursor:pointer;';
  return btn;
}

/**
 * Mount a volume control into `host`.
 * - size 'md'/'lg': inline icon + slider, always visible.
 * - size 'sm': icon button; click toggles a popover containing the slider.
 * - size 'xs': no-op (xs has no volume UI).
 */
export function mountVolumeControl(host: HTMLElement, size: AudioPlayerSize): void {
  if (size === 'xs') return;

  const wrapper = document.createElement('div');
  wrapper.style.cssText = 'position:relative;display:inline-flex;align-items:center;gap:6px;color:#71717a;';
  host.appendChild(wrapper);

  if (size === 'md' || size === 'lg') {
    const icon = document.createElement('span');
    icon.innerHTML = SPEAKER_ICON;
    icon.style.cssText = 'display:inline-flex;align-items:center;';
    wrapper.appendChild(icon);
    wrapper.appendChild(buildSlider());
    return;
  }

  // sm: icon → popover
  const btn = buildIconButton();
  wrapper.appendChild(btn);

  let popover: HTMLDivElement | null = null;
  const close = () => {
    popover?.remove();
    popover = null;
    btn.setAttribute('aria-expanded', 'false');
    document.removeEventListener('click', onDocClick, true);
  };
  const onDocClick = (e: MouseEvent) => {
    if (popover && !popover.contains(e.target as Node) && e.target !== btn) close();
  };
  btn.addEventListener('click', (e) => {
    e.stopPropagation();
    if (popover) { close(); return; }
    popover = document.createElement('div');
    popover.style.cssText = 'position:absolute;bottom:calc(100% + 4px);right:0;background:#18181b;border:1px solid #27272a;border-radius:8px;padding:8px;box-shadow:0 4px 12px rgba(0,0,0,0.3);z-index:50;';
    popover.appendChild(buildSlider());
    wrapper.appendChild(popover);
    btn.setAttribute('aria-expanded', 'true');
    setTimeout(() => document.addEventListener('click', onDocClick, true), 0);
  });
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/audio-player/volume-control.test.ts`
Expected: PASS, 5 tests.

- [ ] **Step 5: Commit**

```bash
git add src/lib/audio-player/volume-control.ts src/lib/audio-player/volume-control.test.ts
git commit -m "feat(audio-player): inline + popover volume control"
```

---

## Task 4: Canvas engine (xs)

**Files:**
- Create: `src/lib/audio-player/canvas-engine.ts`

The xs engine reuses the peak-decoding logic from `src/lib/audio-thumb.ts` but reshapes it behind the `AudioPlayerEngine` contract from Task 1. We do not import from `audio-thumb.ts` (it is being deprecated); we copy the small bits we need.

- [ ] **Step 1: Write the engine**

```typescript
// src/lib/audio-player/canvas-engine.ts
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
  /** Canvas to draw waveform into. */
  canvas: HTMLCanvasElement;
  /** Native audio element used for playback. */
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio-player/canvas-engine.ts
git commit -m "feat(audio-player): canvas engine for xs variant"
```

---

## Task 5: Wavesurfer engine (sm/md/lg)

**Files:**
- Create: `src/lib/audio-player/wavesurfer-engine.ts`

- [ ] **Step 1: Write the engine**

```typescript
// src/lib/audio-player/wavesurfer-engine.ts
import type { AudioPlayerEngine, AudioPlayerEvent } from './types';

export interface WavesurferEngineHosts {
  /** Container the wavesurfer waveform mounts into. */
  waveContainer: HTMLElement;
}

export interface WavesurferEngineExtras {
  /** The wavesurfer instance — only consumed by spectrogram + radial hosts. */
  wavesurfer: unknown;
}

/**
 * Wavesurfer-backed engine. Lazily imports wavesurfer.js so xs callers do not
 * pay the bundle cost. Exposes the underlying `wavesurfer` instance via the
 * returned extras so the spectrogram + radial hosts can reach into it.
 */
export async function createWavesurferEngine(
  url: string,
  hosts: WavesurferEngineHosts,
): Promise<{ engine: AudioPlayerEngine; extras: WavesurferEngineExtras }> {
  const WaveSurfer = (await import('wavesurfer.js')).default;
  const ws = WaveSurfer.create({
    container: hosts.waveContainer,
    waveColor: '#10b981',
    progressColor: '#047857',
    cursorColor: '#6ee7b7',
    barWidth: 2,
    barGap: 1,
    barRadius: 2,
    height: 60,
    normalize: true,
    url,
  });

  const listeners: Record<AudioPlayerEvent, Set<() => void>> = {
    ready: new Set(), play: new Set(), pause: new Set(),
    finish: new Set(), timeupdate: new Set(), error: new Set(),
  };
  const fire = (e: AudioPlayerEvent) => { for (const cb of listeners[e]) cb(); };

  ws.on('ready', () => fire('ready'));
  ws.on('play', () => fire('play'));
  ws.on('pause', () => fire('pause'));
  ws.on('finish', () => fire('finish'));
  ws.on('timeupdate', () => fire('timeupdate'));
  ws.on('error', () => fire('error'));

  const engine: AudioPlayerEngine = {
    play: async () => { await ws.play(); },
    pause: () => ws.pause(),
    seek: (t) => {
      const dur = ws.getDuration();
      if (dur > 0) ws.seekTo(Math.max(0, Math.min(1, t / dur)));
    },
    setVolume: (v) => ws.setVolume(v),
    getCurrentTime: () => ws.getCurrentTime(),
    getDuration: () => ws.getDuration(),
    isPlaying: () => ws.isPlaying(),
    getMediaElement: () => {
      const m = (ws as unknown as { getMediaElement?: () => HTMLMediaElement }).getMediaElement;
      return m ? m.call(ws) : null;
    },
    on: (event, cb) => {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    destroy: () => {
      try { ws.destroy(); } catch { /* already destroyed */ }
      for (const set of Object.values(listeners)) set.clear();
    },
  };

  return { engine, extras: { wavesurfer: ws } };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio-player/wavesurfer-engine.ts
git commit -m "feat(audio-player): wavesurfer engine for sm/md/lg"
```

---

## Task 6: Spectrogram host

**Files:**
- Create: `src/lib/audio-player/spectrogram-host.ts`

- [ ] **Step 1: Write the spectrogram host**

```typescript
// src/lib/audio-player/spectrogram-host.ts
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
  // Faint inferno-ish gradient bands as a "ghost" hint.
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
  /** Underlying wavesurfer instance (from wavesurfer-engine extras). */
  wavesurfer: unknown;
  /** Initial frequency max (Hz). Default 12000. */
  frequencyMax?: number;
}

/**
 * Mount a spectrogram into `host`.
 * - 'md': renders a placeholder until the user first hits play; then registers the wavesurfer plugin.
 * - 'lg': registers the wavesurfer plugin immediately on engine 'ready'.
 *
 * Returns a cleanup that removes the host's children.
 */
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
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio-player/spectrogram-host.ts
git commit -m "feat(audio-player): spectrogram host with placeholder + lazy decode"
```

---

## Task 7: Radial host (lg only)

**Files:**
- Create: `src/lib/audio-player/radial-host.ts`

- [ ] **Step 1: Write the radial host**

```typescript
// src/lib/audio-player/radial-host.ts
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
  /** Container that mountAudioPlayer was called on; carries __birdnetSegments. */
  container: HTMLElement;
  /** Element that the radial canvas is appended to. */
  host: HTMLElement;
  engine: AudioPlayerEngine;
  /** The play button to embed inside the inner ring. */
  playButton: HTMLElement;
  /** Diameter of the radial canvas in CSS pixels. */
  diameter?: number;
}

/**
 * Mount the radial visualizer with the play button embedded in its inner ring.
 * Always visible (lg only — caller decides not to call this for md/sm/xs).
 * Reads BirdNET segments off `container.__birdnetSegments` if present.
 */
export function mountRadial(opts: RadialHostOptions): () => void {
  const { container, host, engine, playButton } = opts;
  const diameter = opts.diameter ?? 220;

  host.style.cssText = `position:relative;width:${diameter}px;height:${diameter}px;background:#09090b;border-radius:9999px;overflow:hidden;margin:0 auto;`;
  const canvas = document.createElement('canvas');
  canvas.style.cssText = 'position:absolute;inset:0;width:100%;height:100%;';
  canvas.setAttribute('aria-hidden', 'true');
  host.appendChild(canvas);

  // Center play button — caller passes it pre-built so it carries the right aria + click handler.
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
      // createMediaElementSource is one-shot per element — fall through to idle.
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

    let dataArray: Uint8Array;
    if (analyser && connected) {
      dataArray = new Uint8Array(analyser.frequencyBinCount);
      analyser.getByteFrequencyData(dataArray);
    } else {
      const t = Date.now() / 1000;
      dataArray = new Uint8Array(64);
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

  // Idle animation runs even before first play so the radial feels alive.
  animId = requestAnimationFrame(draw);

  return () => {
    unsubPlay();
    if (animId) { cancelAnimationFrame(animId); animId = 0; }
    try { source?.disconnect(); analyser?.disconnect(); void audioCtx?.close(); } catch { /* ignore */ }
    host.replaceChildren();
  };
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio-player/radial-host.ts
git commit -m "feat(audio-player): radial host with embedded play button"
```

---

## Task 8: Per-size shell builder

**Files:**
- Create: `src/lib/audio-player/shell.ts`

The shell builds the DOM scaffold for a given size and exposes named slots that `mountAudioPlayer` can wire up. Keeping shell construction in its own module keeps `mountAudioPlayer` focused on lifecycle.

- [ ] **Step 1: Write the shell builder**

```typescript
// src/lib/audio-player/shell.ts
import type { AudioPlayerSize } from './types';

const PLAY_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

export interface PlayerShellSlots {
  root: HTMLElement;
  /** Where the engine's waveform mounts (canvas for xs, wavesurfer container otherwise). */
  waveHost: HTMLElement;
  /** Optional canvas (xs only — engine writes here directly). */
  canvas?: HTMLCanvasElement;
  /** Optional native audio element (xs only). */
  audio?: HTMLAudioElement;
  playButton: HTMLButtonElement;
  /** sm/md/lg only. */
  timeLabel?: HTMLSpanElement;
  /** Container the volume control mounts into. sm/md/lg only. */
  volumeHost?: HTMLElement;
  /** Container the spectrogram host mounts into. md/lg only. */
  spectrogramHost?: HTMLElement;
  /** Container the radial host mounts into. lg only. */
  radialHost?: HTMLElement;
}

function makePlayButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `<span class="play-icon" style="display:inline-flex">${PLAY_ICON_SVG}</span><span class="pause-icon" style="display:none">${PAUSE_ICON_SVG}</span>`;
  return btn;
}

export function setPlayButtonState(btn: HTMLButtonElement, playing: boolean): void {
  const play = btn.querySelector<HTMLElement>('.play-icon');
  const pause = btn.querySelector<HTMLElement>('.pause-icon');
  if (play && pause) {
    play.style.display = playing ? 'none' : 'inline-flex';
    pause.style.display = playing ? 'inline-flex' : 'none';
  }
}

export function buildShell(
  container: HTMLElement, size: AudioPlayerSize, lang: 'en' | 'es', label?: string,
): PlayerShellSlots {
  container.replaceChildren();
  const isEs = lang === 'es';
  const playLabel = isEs ? 'Reproducir' : 'Play';

  if (size === 'xs') {
    container.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;background:#18181b;overflow:hidden;cursor:pointer;';
    const canvas = document.createElement('canvas');
    const w = container.clientWidth || 64;
    const h = container.clientHeight || 64;
    canvas.width = w * 2;
    canvas.height = h * 2;
    canvas.style.cssText = `width:100%;height:${h}px;display:block;`;
    container.appendChild(canvas);

    const playButton = makePlayButton(playLabel);
    playButton.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:28px;height:28px;border-radius:9999px;background:rgba(16,185,129,0.2);color:#34d399;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;';
    container.appendChild(playButton);

    const audio = document.createElement('audio');
    audio.style.display = 'none';
    container.appendChild(audio);

    if (label) {
      const lbl = document.createElement('span');
      lbl.textContent = label;
      lbl.style.cssText = 'position:absolute;bottom:4px;left:0;right:0;text-align:center;font-size:9px;font-weight:600;text-transform:uppercase;letter-spacing:0.5px;color:rgba(52,211,153,0.6);z-index:2;';
      container.appendChild(lbl);
    }

    return { root: container, waveHost: canvas, canvas, audio, playButton };
  }

  // sm / md / lg shell
  container.style.cssText = 'display:flex;flex-direction:column;gap:8px;border-radius:12px;border:1px solid rgba(63,63,70,0.5);background:rgba(24,24,27,0.4);padding:12px;';

  const radialHost = size === 'lg' ? document.createElement('div') : undefined;
  if (radialHost) container.appendChild(radialHost);

  const waveHost = document.createElement('div');
  waveHost.style.cssText = 'width:100%;min-height:60px;cursor:pointer;';
  container.appendChild(waveHost);

  const spectrogramHost = (size === 'md' || size === 'lg') ? document.createElement('div') : undefined;
  if (spectrogramHost) {
    spectrogramHost.style.cssText = 'width:100%;height:140px;background:#09090b;border-radius:6px;overflow:hidden;cursor:pointer;';
    container.appendChild(spectrogramHost);
  }

  // Controls row
  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;align-items:center;gap:10px;';
  container.appendChild(controls);

  const playButton = makePlayButton(playLabel);
  if (size === 'lg') {
    // lg: play button lives inside the radial; the controls row gets a spacer for visual rhythm
    playButton.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9999px;background:#10b981;color:#fff;border:none;cursor:pointer;';
  } else {
    playButton.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9999px;background:#10b981;color:#fff;border:none;cursor:pointer;';
    controls.appendChild(playButton);
  }

  const timeLabel = document.createElement('span');
  timeLabel.textContent = '0:00';
  timeLabel.style.cssText = 'font-family:ui-monospace,monospace;font-size:11px;color:#a1a1aa;font-variant-numeric:tabular-nums;';
  controls.appendChild(timeLabel);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  controls.appendChild(spacer);

  const volumeHost = document.createElement('div');
  controls.appendChild(volumeHost);

  return { root: container, waveHost, playButton, timeLabel, volumeHost, spectrogramHost, radialHost };
}

export function formatTime(sec: number): string {
  if (!Number.isFinite(sec) || sec < 0) sec = 0;
  const m = Math.floor(sec / 60);
  const s = Math.floor(sec % 60);
  return `${m}:${s.toString().padStart(2, '0')}`;
}
```

- [ ] **Step 2: Verify it compiles**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 3: Commit**

```bash
git add src/lib/audio-player/shell.ts
git commit -m "feat(audio-player): per-size shell builder + play icon helpers"
```

---

## Task 9: Public API — `mountAudioPlayer`

**Files:**
- Create: `src/lib/audio-player.ts`
- Test: `src/lib/audio-player.test.ts`

- [ ] **Step 1: Write the failing test**

```typescript
// src/lib/audio-player.test.ts
import { describe, it, expect, beforeEach, vi } from 'vitest';
import { mountAudioPlayer } from './audio-player';
import { __resetForTests } from './audio-player/registry';

// Stub wavesurfer + spectrogram so tests don't try to decode real audio.
vi.mock('wavesurfer.js', () => {
  class FakeWS {
    private listeners: Record<string, ((arg?: unknown) => void)[]> = {};
    static create(_opts: unknown) { return new FakeWS(); }
    on(e: string, cb: (arg?: unknown) => void) { (this.listeners[e] ||= []).push(cb); }
    play() { return Promise.resolve(); }
    pause() {}
    seekTo(_n: number) {}
    setVolume(_v: number) {}
    getCurrentTime() { return 0; }
    getDuration() { return 10; }
    isPlaying() { return false; }
    getMediaElement() { return null; }
    destroy() {}
  }
  return { default: FakeWS };
});
vi.mock('wavesurfer.js/plugins/spectrogram', () => ({
  default: { create: () => ({}) },
}));

describe('mountAudioPlayer', () => {
  beforeEach(() => {
    __resetForTests();
    localStorage.clear();
    document.body.innerHTML = '';
  });

  it('returns a cleanup function for xs', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const cleanup = mountAudioPlayer(c, 'data:audio/wav;base64,', { size: 'xs', lang: 'en' });
    expect(typeof cleanup).toBe('function');
    expect(c.querySelector('canvas')).not.toBeNull();
    expect(c.querySelector('button[aria-label]')).not.toBeNull();
    cleanup();
    expect(c.children.length).toBe(0);
  });

  it('builds an md shell with waveform + spectrogram + volume slider', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const cleanup = mountAudioPlayer(c, 'http://example/a.mp3', { size: 'md', lang: 'en', obsId: 'x' });
    // Wait a microtask for the dynamic wavesurfer import to resolve.
    await new Promise(r => setTimeout(r, 0));
    expect(c.querySelector('input[type="range"]')).not.toBeNull();
    cleanup();
  });

  it('builds an sm shell with popover volume (no inline slider)', async () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const cleanup = mountAudioPlayer(c, 'http://example/a.mp3', { size: 'sm', lang: 'en' });
    await new Promise(r => setTimeout(r, 0));
    expect(c.querySelector('input[type="range"]')).toBeNull();
    expect(c.querySelector('button[data-volume-toggle]')).not.toBeNull();
    cleanup();
  });

  it('cleanup is idempotent', () => {
    const c = document.createElement('div');
    document.body.appendChild(c);
    const cleanup = mountAudioPlayer(c, 'data:audio/wav;base64,', { size: 'xs', lang: 'en' });
    cleanup();
    expect(() => cleanup()).not.toThrow();
  });
});
```

- [ ] **Step 2: Run test to verify it fails**

Run: `npx vitest run src/lib/audio-player.test.ts`
Expected: FAIL with "Cannot find module './audio-player'".

- [ ] **Step 3: Write the public API**

```typescript
// src/lib/audio-player.ts
import type { AudioPlayerEngine, AudioPlayerHandle, AudioPlayerOptions } from './audio-player/types';
import { buildShell, setPlayButtonState, formatTime } from './audio-player/shell';
import { createCanvasEngine } from './audio-player/canvas-engine';
import { createWavesurferEngine } from './audio-player/wavesurfer-engine';
import { mountVolumeControl } from './audio-player/volume-control';
import { mountSpectrogram } from './audio-player/spectrogram-host';
import { mountRadial } from './audio-player/radial-host';
import {
  registerHandle, unregisterHandle, pauseAllExcept, getStoredVolume,
} from './audio-player/registry';

export type { AudioPlayerOptions, AudioPlayerSize } from './audio-player/types';

/**
 * Mount an audio player into `container` and return a cleanup function.
 *
 * The visual + feature set is controlled by `opts.size`:
 *   - 'xs': mini canvas, play/pause only.
 *   - 'sm': waveform + scrub + time + volume popover.
 *   - 'md': sm + spectrogram (lazy on first play) + inline volume slider.
 *   - 'lg': md + radial visualizer header (always visible) with play embedded.
 */
export function mountAudioPlayer(
  container: HTMLElement,
  audioUrl: string,
  opts: AudioPlayerOptions,
): () => void {
  const slots = buildShell(container, opts.size, opts.lang, opts.label);
  const cleanups: Array<() => void> = [];
  let engine: AudioPlayerEngine | null = null;
  let destroyed = false;

  function wireSeekOnHost(host: HTMLElement, eng: AudioPlayerEngine): void {
    host.addEventListener('click', (e) => {
      const rect = host.getBoundingClientRect();
      const ratio = (e.clientX - rect.left) / rect.width;
      const dur = eng.getDuration();
      if (dur > 0) eng.seek(Math.max(0, Math.min(1, ratio)) * dur);
    });
  }

  function wireCommon(eng: AudioPlayerEngine): void {
    engine = eng;

    eng.setVolume(getStoredVolume());

    const handle: AudioPlayerHandle = {
      pause: () => eng.pause(),
      setVolume: (v) => eng.setVolume(v),
      destroy: () => eng.destroy(),
    };
    registerHandle(handle);
    cleanups.push(() => unregisterHandle(handle));

    cleanups.push(eng.on('play', () => {
      pauseAllExcept(handle);
      setPlayButtonState(slots.playButton, true);
    }));
    cleanups.push(eng.on('pause', () => setPlayButtonState(slots.playButton, false)));
    cleanups.push(eng.on('finish', () => setPlayButtonState(slots.playButton, false)));
    if (slots.timeLabel) {
      const update = () => {
        slots.timeLabel!.textContent =
          `${formatTime(eng.getCurrentTime())} / ${formatTime(eng.getDuration())}`;
      };
      cleanups.push(eng.on('ready', update));
      cleanups.push(eng.on('timeupdate', update));
    }

    slots.playButton.addEventListener('click', (e) => {
      e.stopPropagation();
      if (eng.isPlaying()) eng.pause();
      else void eng.play();
    });

    if (opts.size !== 'xs') wireSeekOnHost(slots.waveHost, eng);
    if (slots.spectrogramHost) wireSeekOnHost(slots.spectrogramHost, eng);
    if (slots.volumeHost) mountVolumeControl(slots.volumeHost, opts.size);
  }

  if (opts.size === 'xs') {
    if (!slots.canvas || !slots.audio) {
      throw new Error('xs shell missing canvas or audio');
    }
    const eng = createCanvasEngine(audioUrl, { canvas: slots.canvas, audio: slots.audio });
    wireCommon(eng);
    container.addEventListener('click', () => {
      if (eng.isPlaying()) eng.pause();
      else void eng.play();
    });
  } else {
    void createWavesurferEngine(audioUrl, { waveContainer: slots.waveHost }).then(({ engine: eng, extras }) => {
      if (destroyed) { eng.destroy(); return; }
      wireCommon(eng);
      if (slots.spectrogramHost && (opts.size === 'md' || opts.size === 'lg')) {
        cleanups.push(
          mountSpectrogram({
            size: opts.size, host: slots.spectrogramHost, engine: eng, wavesurfer: extras.wavesurfer,
          }),
        );
      }
      if (slots.radialHost && opts.size === 'lg') {
        cleanups.push(mountRadial({
          container, host: slots.radialHost, engine: eng, playButton: slots.playButton, diameter: 220,
        }));
      }
      if (opts.autoExpand) {
        // already auto-mounted at lg; for md the spectrogram waits for play.
      }
    }).catch(err => {
      console.warn('[rastrum] audio-player wavesurfer init failed:', err);
    });
  }

  return () => {
    if (destroyed) return;
    destroyed = true;
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* ignore cleanup errors */ }
    }
    try { engine?.destroy(); } catch { /* ignore */ }
    container.replaceChildren();
  };
}
```

- [ ] **Step 4: Run test to verify it passes**

Run: `npx vitest run src/lib/audio-player.test.ts`
Expected: PASS, 4 tests.

- [ ] **Step 5: Run the full test suite**

Run: `npx vitest run`
Expected: all tests pass (734 existing + 15 new).

- [ ] **Step 6: Typecheck**

Run: `npx tsc --noEmit`
Expected: zero errors.

- [ ] **Step 7: Build**

Run: `npm run build`
Expected: build succeeds.

- [ ] **Step 8: Commit**

```bash
git add src/lib/audio-player.ts src/lib/audio-player.test.ts
git commit -m "feat(audio-player): public mountAudioPlayer API + size dispatch"
```

---

## Task 10: Verify, push, open PR

- [ ] **Step 1: Final pre-push checks**

Run all in sequence:
```bash
npx tsc --noEmit
npx vitest run
npm run build
```
Expected: all green.

- [ ] **Step 2: Push branch**

```bash
git push -u origin feat/audio-player-unification
```

- [ ] **Step 3: Open PR**

Use the `create-pr` skill. Title: `feat(audio): unified audio player module (PR1 of 3)`. Body must reference the design doc and explain that PR2 + PR3 will migrate callers; this PR introduces the module without breaking any existing usage.

---

## Self-review

**Spec coverage:** Every section of the design spec maps to a task —
- Module + types: tasks 1 + 9.
- Engine split (canvas vs wavesurfer): tasks 4 + 5.
- Per-size shell: task 8.
- Volume (inline + popover): task 3.
- Spectrogram with placeholder + lazy decode: task 6.
- Radial centerpiece: task 7.
- Pause-others + global volume registry: task 2.
- BirdNET integration: handled by reading `__birdnetSegments` in radial-host (task 7) — same contract as today, no change needed.
- Migration map: deferred to PR2 + PR3 (correct for this PR's scope).

**Placeholder scan:** No TBD, no "implement later", no "similar to" — every step ships actual code.

**Type consistency:** `AudioPlayerEngine` signature matches across canvas-engine, wavesurfer-engine, and consumers. `AudioPlayerSize` is the discriminator everywhere. `mountVolumeControl(host, size)` matches the call site in audio-player.ts. `mountSpectrogram` and `mountRadial` accept the engine + extras shapes the engine creators return.
