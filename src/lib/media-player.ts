import type { MediaPlayerEngine, MediaPlayerHandle, MediaPlayerOptions } from './media-player/types';
import { buildShell, setPlayButtonState, formatTime } from './media-player/shell';
import { buildVideoShell, setVideoPlayButtonState } from './media-player/video-shell';
import { createCanvasEngine } from './media-player/canvas-engine';
import { createWavesurferEngine } from './media-player/wavesurfer-engine';
import { createVideoEngine } from './media-player/video-engine';
import { mountVolumeControl } from './media-player/volume-control';
import { mountSpectrogram } from './media-player/spectrogram-host';
import { mountRadial } from './media-player/radial-host';
import {
  registerHandle, unregisterHandle, pauseAllExcept, getStoredVolume,
} from './media-player/registry';

export type {
  MediaPlayerOptions, MediaPlayerSize, MediaPlayerKind,
  AudioPlayerOptions, AudioPlayerSize,
} from './media-player/types';

function wireSeekOnHost(host: HTMLElement, eng: MediaPlayerEngine): void {
  host.addEventListener('click', (e) => {
    const rect = host.getBoundingClientRect();
    const ratio = (e.clientX - rect.left) / rect.width;
    const dur = eng.getDuration();
    if (dur > 0) eng.seek(Math.max(0, Math.min(1, ratio)) * dur);
  });
}

function mountVideo(container: HTMLElement, url: string, opts: MediaPlayerOptions): () => void {
  const slots = buildVideoShell(container, opts.size, opts.lang, opts.poster);
  const cleanups: Array<() => void> = [];
  let destroyed = false;

  const engine = createVideoEngine(url, { video: slots.video });
  engine.setVolume(getStoredVolume());

  const handle: MediaPlayerHandle = {
    pause: () => engine.pause(),
    setVolume: (v) => engine.setVolume(v),
    destroy: () => engine.destroy(),
  };
  registerHandle(handle);
  cleanups.push(() => unregisterHandle(handle));

  cleanups.push(engine.on('play', () => {
    pauseAllExcept(handle);
    setVideoPlayButtonState(slots.playButton, true);
  }));
  cleanups.push(engine.on('pause', () => setVideoPlayButtonState(slots.playButton, false)));
  cleanups.push(engine.on('finish', () => setVideoPlayButtonState(slots.playButton, false)));

  if (slots.timeLabel) {
    const tl = slots.timeLabel;
    const update = () => { tl.textContent = `${formatTime(engine.getCurrentTime())} / ${formatTime(engine.getDuration())}`; };
    cleanups.push(engine.on('ready', update));
    cleanups.push(engine.on('timeupdate', update));
  }

  slots.playButton.addEventListener('click', (e) => {
    e.stopPropagation();
    if (engine.isPlaying()) engine.pause();
    else void engine.play();
  });

  if (slots.volumeHost) mountVolumeControl(slots.volumeHost, opts.size);

  // xs: clicking the container plays/pauses inline (small surface, no separate button).
  if (opts.size === 'xs') {
    container.addEventListener('click', (e) => {
      if (e.target !== slots.playButton && !slots.playButton.contains(e.target as Node)) {
        if (engine.isPlaying()) engine.pause();
        else void engine.play();
      }
    });
  }

  return () => {
    if (destroyed) return;
    destroyed = true;
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* ignore */ }
    }
    try { engine.destroy(); } catch { /* ignore */ }
    container.replaceChildren();
  };
}

function mountAudio(container: HTMLElement, url: string, opts: MediaPlayerOptions): () => void {
  const slots = buildShell(container, opts.size, opts.lang, opts.label);
  const cleanups: Array<() => void> = [];
  let engine: MediaPlayerEngine | null = null;
  let destroyed = false;

  function wireCommon(eng: MediaPlayerEngine): void {
    engine = eng;
    eng.setVolume(getStoredVolume());

    const handle: MediaPlayerHandle = {
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
      const tl = slots.timeLabel;
      const update = () => { tl.textContent = `${formatTime(eng.getCurrentTime())} / ${formatTime(eng.getDuration())}`; };
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
    const eng = createCanvasEngine(url, { canvas: slots.canvas, audio: slots.audio });
    wireCommon(eng);
    container.addEventListener('click', () => {
      if (eng.isPlaying()) eng.pause();
      else void eng.play();
    });
  } else {
    void createWavesurferEngine(url, { waveContainer: slots.waveHost }).then(({ engine: eng, extras }) => {
      if (destroyed) { eng.destroy(); return; }
      wireCommon(eng);
      if (slots.spectrogramHost && (opts.size === 'md' || opts.size === 'lg')) {
        cleanups.push(mountSpectrogram({
          size: opts.size, host: slots.spectrogramHost, engine: eng, wavesurfer: extras.wavesurfer,
        }));
      }
      if (slots.radialHost && opts.size === 'lg') {
        cleanups.push(mountRadial({
          container, host: slots.radialHost, engine: eng, playButton: slots.playButton, diameter: 220,
        }));
      }
    }).catch(err => {
      console.warn('[rastrum] media-player wavesurfer init failed:', err);
    });
  }

  return () => {
    if (destroyed) return;
    destroyed = true;
    for (const c of cleanups.splice(0)) {
      try { c(); } catch { /* ignore */ }
    }
    try { engine?.destroy(); } catch { /* ignore */ }
    container.replaceChildren();
  };
}

/**
 * Mount a media player into `container`. Dispatches by `kind`:
 *  - 'audio' (default): waveform + (spectrogram + radial in larger sizes).
 *  - 'video': HTMLVideoElement with custom controls (play, scrub, time, volume, fullscreen).
 *
 * Size variants control the feature set within each kind.
 */
export function mountMediaPlayer(
  container: HTMLElement,
  url: string,
  opts: MediaPlayerOptions,
): () => void {
  const kind = opts.kind ?? 'audio';
  return kind === 'video' ? mountVideo(container, url, opts) : mountAudio(container, url, opts);
}

/** @deprecated Use `mountMediaPlayer` — preserved for code that still imports the audio-only name. */
export function mountAudioPlayer(
  container: HTMLElement,
  url: string,
  opts: MediaPlayerOptions,
): () => void {
  return mountMediaPlayer(container, url, opts);
}
