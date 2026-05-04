import type { MediaPlayerSize } from './types';

const PLAY_ICON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M8 5v14l11-7z"/></svg>';
const PAUSE_ICON_SVG = '<svg viewBox="0 0 24 24" width="20" height="20" fill="currentColor" aria-hidden="true"><path d="M6 19h4V5H6v14zm8-14v14h4V5h-4z"/></svg>';
const FULLSCREEN_ICON_SVG = '<svg viewBox="0 0 24 24" width="14" height="14" fill="currentColor" aria-hidden="true"><path d="M7 14H5v5h5v-2H7v-3zm-2-4h2V7h3V5H5v5zm12 7h-3v2h5v-5h-2v3zM14 5v2h3v3h2V5h-5z"/></svg>';

export interface VideoShellSlots {
  root: HTMLElement;
  video: HTMLVideoElement;
  /** Wrapper around the video used for full-bleed positioning. */
  videoWrap: HTMLElement;
  playButton: HTMLButtonElement;
  timeLabel?: HTMLSpanElement;
  volumeHost?: HTMLElement;
  fullscreenButton?: HTMLButtonElement;
}

function makePlayButton(label: string): HTMLButtonElement {
  const btn = document.createElement('button');
  btn.type = 'button';
  btn.setAttribute('aria-label', label);
  btn.innerHTML = `<span class="play-icon" style="display:inline-flex">${PLAY_ICON_SVG}</span><span class="pause-icon" style="display:none">${PAUSE_ICON_SVG}</span>`;
  return btn;
}

export function setVideoPlayButtonState(btn: HTMLButtonElement, playing: boolean): void {
  const play = btn.querySelector<HTMLElement>('.play-icon');
  const pause = btn.querySelector<HTMLElement>('.pause-icon');
  if (play && pause) {
    play.style.display = playing ? 'none' : 'inline-flex';
    pause.style.display = playing ? 'inline-flex' : 'none';
  }
}

export function buildVideoShell(
  container: HTMLElement, size: MediaPlayerSize, lang: 'en' | 'es', poster?: string,
): VideoShellSlots {
  container.replaceChildren();
  const isEs = lang === 'es';
  const playLabel = isEs ? 'Reproducir' : 'Play';
  const fullscreenLabel = isEs ? 'Pantalla completa' : 'Fullscreen';

  if (size === 'xs') {
    container.style.cssText = 'position:relative;display:flex;align-items:center;justify-content:center;background:#0a0a0a;overflow:hidden;cursor:pointer;';

    const video = document.createElement('video');
    video.muted = true;
    video.playsInline = true;
    video.preload = 'metadata';
    if (poster) video.poster = poster;
    video.style.cssText = 'width:100%;height:100%;object-fit:cover;display:block;';
    container.appendChild(video);

    const videoWrap = container;

    const playButton = makePlayButton(playLabel);
    playButton.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:32px;height:32px;border-radius:9999px;background:rgba(0,0,0,0.55);color:#fff;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;z-index:2;backdrop-filter:blur(4px);';
    container.appendChild(playButton);

    return { root: container, video, videoWrap, playButton };
  }

  // sm / md / lg shell
  container.style.cssText = 'display:flex;flex-direction:column;gap:8px;border-radius:12px;overflow:hidden;background:#000;border:1px solid rgba(63,63,70,0.5);';

  const videoWrap = document.createElement('div');
  videoWrap.style.cssText = 'position:relative;background:#000;width:100%;aspect-ratio:16/9;cursor:pointer;';
  container.appendChild(videoWrap);

  const video = document.createElement('video');
  video.playsInline = true;
  video.preload = 'metadata';
  if (poster) video.poster = poster;
  video.style.cssText = 'width:100%;height:100%;object-fit:contain;display:block;background:#000;';
  videoWrap.appendChild(video);

  // Big center play overlay (visible until first play)
  const centerPlay = document.createElement('button');
  centerPlay.type = 'button';
  centerPlay.setAttribute('aria-label', playLabel);
  centerPlay.dataset.centerPlay = '1';
  centerPlay.innerHTML = PLAY_ICON_SVG;
  centerPlay.style.cssText = 'position:absolute;top:50%;left:50%;transform:translate(-50%,-50%);width:56px;height:56px;border-radius:9999px;background:rgba(0,0,0,0.55);color:#fff;border:none;display:flex;align-items:center;justify-content:center;cursor:pointer;backdrop-filter:blur(6px);box-shadow:0 4px 16px rgba(0,0,0,0.5);';
  videoWrap.appendChild(centerPlay);

  const controls = document.createElement('div');
  controls.style.cssText = 'display:flex;align-items:center;gap:10px;padding:8px 12px;background:rgba(0,0,0,0.6);';
  container.appendChild(controls);

  const playButton = makePlayButton(playLabel);
  playButton.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:32px;height:32px;border-radius:9999px;background:transparent;color:#e4e4e7;border:none;cursor:pointer;';
  controls.appendChild(playButton);

  // Center play button delegates to the controls bar play button so behavior + state stay in one place.
  centerPlay.addEventListener('click', () => playButton.click());

  const timeLabel = document.createElement('span');
  timeLabel.textContent = '0:00';
  timeLabel.style.cssText = 'font-family:ui-monospace,monospace;font-size:11px;color:#a1a1aa;font-variant-numeric:tabular-nums;';
  controls.appendChild(timeLabel);

  const spacer = document.createElement('div');
  spacer.style.flex = '1';
  controls.appendChild(spacer);

  const volumeHost = document.createElement('div');
  controls.appendChild(volumeHost);

  let fullscreenButton: HTMLButtonElement | undefined;
  if (size === 'md' || size === 'lg') {
    fullscreenButton = document.createElement('button');
    fullscreenButton.type = 'button';
    fullscreenButton.setAttribute('aria-label', fullscreenLabel);
    fullscreenButton.title = fullscreenLabel;
    fullscreenButton.innerHTML = FULLSCREEN_ICON_SVG;
    fullscreenButton.style.cssText = 'display:inline-flex;align-items:center;justify-content:center;width:28px;height:28px;color:#a1a1aa;background:transparent;border:none;cursor:pointer;';
    fullscreenButton.addEventListener('click', () => {
      if (document.fullscreenElement) void document.exitFullscreen();
      else void videoWrap.requestFullscreen?.();
    });
    controls.appendChild(fullscreenButton);
  }

  // Hide the center play overlay once playback starts so it doesn't sit on the picture.
  video.addEventListener('play', () => { centerPlay.style.display = 'none'; });
  video.addEventListener('pause', () => { centerPlay.style.display = 'flex'; });
  video.addEventListener('ended', () => { centerPlay.style.display = 'flex'; });

  // Click on the video itself toggles play/pause.
  videoWrap.addEventListener('click', (e) => {
    if (e.target === centerPlay || (e.target as HTMLElement).closest('[data-center-play]')) return;
    playButton.click();
  });

  return { root: container, video, videoWrap, playButton, timeLabel, volumeHost, fullscreenButton };
}
