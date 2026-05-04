export type AudioPlayerSize = 'xs' | 'sm' | 'md' | 'lg';

export interface AudioPlayerOptions {
  size: AudioPlayerSize;
  obsId?: string;
  mimeType?: string;
  lang: 'en' | 'es';
  autoExpand?: boolean;
  label?: string;
}

export interface AudioPlayerEngine {
  play(): Promise<void>;
  pause(): void;
  seek(timeSec: number): void;
  setVolume(value: number): void;
  getCurrentTime(): number;
  getDuration(): number;
  isPlaying(): boolean;
  getMediaElement(): HTMLMediaElement | null;
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

export interface AudioPlayerHandle {
  pause(): void;
  setVolume(value: number): void;
  destroy(): void;
}
