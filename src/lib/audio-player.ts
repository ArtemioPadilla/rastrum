// Backwards-compat shim. Prefer importing `mountMediaPlayer` from
// `./media-player` directly in new code. AudioPlayer.astro and any other
// caller that still imports from this path will keep working.
export { mountAudioPlayer, mountMediaPlayer } from './media-player';
export type {
  MediaPlayerOptions, MediaPlayerSize, MediaPlayerKind,
  AudioPlayerOptions, AudioPlayerSize,
} from './media-player/types';
