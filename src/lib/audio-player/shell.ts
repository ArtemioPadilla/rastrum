import type { AudioPlayerSize } from './types';

const PLAY_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON_SVG = '<svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';

export interface PlayerShellSlots {
  root: HTMLElement;
  waveHost: HTMLElement;
  canvas?: HTMLCanvasElement;
  audio?: HTMLAudioElement;
  playButton: HTMLButtonElement;
  timeLabel?: HTMLSpanElement;
  volumeHost?: HTMLElement;
  spectrogramHost?: HTMLElement;
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

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;align-items:center;gap:10px;';
  container.appendChild(controls);

  const playButton = makePlayButton(playLabel);
  playButton.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:36px;height:36px;border-radius:9999px;background:#10b981;color:#fff;border:none;cursor:pointer;';
  if (size !== 'lg') {
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
