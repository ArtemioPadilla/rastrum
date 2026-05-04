import type { MediaPlayerEngine, MediaPlayerEvent } from './types';

export interface VideoEngineHosts {
  video: HTMLVideoElement;
}

/**
 * Video engine — wraps an HTMLVideoElement to satisfy MediaPlayerEngine.
 * No fancy waveform/spectrogram; the video itself is the primary surface.
 */
export function createVideoEngine(url: string, hosts: VideoEngineHosts): MediaPlayerEngine {
  const { video } = hosts;
  video.src = url;
  video.preload = 'metadata';
  video.playsInline = true;

  const listeners: Record<MediaPlayerEvent, Set<() => void>> = {
    ready: new Set(), play: new Set(), pause: new Set(),
    finish: new Set(), timeupdate: new Set(), error: new Set(),
  };
  const fire = (e: MediaPlayerEvent) => { for (const cb of listeners[e]) cb(); };

  video.addEventListener('loadedmetadata', () => fire('ready'));
  video.addEventListener('play', () => fire('play'));
  video.addEventListener('pause', () => fire('pause'));
  video.addEventListener('ended', () => fire('finish'));
  video.addEventListener('timeupdate', () => fire('timeupdate'));
  video.addEventListener('error', () => fire('error'));

  return {
    play: () => video.play(),
    pause: () => video.pause(),
    seek: (t) => { video.currentTime = t; },
    setVolume: (v) => { video.volume = v; },
    getCurrentTime: () => video.currentTime,
    getDuration: () => video.duration || 0,
    isPlaying: () => !video.paused && !video.ended,
    getMediaElement: () => video,
    on: (event, cb) => {
      listeners[event].add(cb);
      return () => listeners[event].delete(cb);
    },
    destroy: () => {
      video.pause();
      video.removeAttribute('src');
      video.load();
      for (const set of Object.values(listeners)) set.clear();
    },
  };
}
