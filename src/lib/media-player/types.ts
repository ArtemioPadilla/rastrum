export type MediaPlayerSize = 'xs' | 'sm' | 'md' | 'lg';
export type MediaPlayerKind = 'audio' | 'video';

export interface MediaPlayerOptions {
  size: MediaPlayerSize;
  /** 'audio' (default) shows waveform/spectrogram/radial; 'video' shows the video element. */
  kind?: MediaPlayerKind;
  obsId?: string;
  mimeType?: string;
  lang: 'en' | 'es';
  /** lg only — start with spectrogram open (audio kind only). */
  autoExpand?: boolean;
  label?: string;
  /** Video kind only — poster image URL for xs/sm/md/lg. */
  poster?: string;
}

export interface MediaPlayerEngine {
  play(): Promise<void>;
  pause(): void;
  seek(timeSec: number): void;
  setVolume(value: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  getMediaElement(): HTMLMediaElement | null;
  on(event: MediaPlayerEvent, cb: () => void): () => void;
  destroy(): void;
}

export type MediaPlayerEvent =
  | 'ready'
  | 'play'
  | 'pause'
  | 'finish'
  | 'timeupdate'
  | 'error';

export interface MediaPlayerHandle {
  pause(): void;
  setVolume(value: number): void;
  destroy(): void;
}

// Backwards-compat aliases for code that imported the old names.
export type AudioPlayerSize = MediaPlayerSize;
export type AudioPlayerOptions = MediaPlayerOptions;
export type AudioPlayerEngine = MediaPlayerEngine;
export type AudioPlayerEvent = MediaPlayerEvent;
export type AudioPlayerHandle = MediaPlayerHandle;
