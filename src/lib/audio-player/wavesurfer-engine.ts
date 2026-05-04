import type { AudioPlayerEngine, AudioPlayerEvent } from './types';

export interface WavesurferEngineHosts {
  waveContainer: HTMLElement;
}

export interface WavesurferEngineExtras {
  wavesurfer: unknown;
}

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
