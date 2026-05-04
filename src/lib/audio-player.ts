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
