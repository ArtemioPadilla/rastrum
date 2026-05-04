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
    // localStorage unavailable (private mode); broadcast still works.
  }
  for (const h of handles) h.setVolume(v);
}

export function __resetForTests(): void {
  handles.clear();
}
