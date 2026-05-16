/**
 * Pure decision: which identifier runners run for one pipeline node.
 *
 * Local-first invariants:
 *  - `local` mode never returns a cloud runner.
 *  - `local` + photo is NOT skipped — it returns the available on-device
 *    photo runners (efficientNet / phi / gemma) plus the megaDetector
 *    pre-filter. Returns [] only when nothing on-device is available, so
 *    the caller can fall back to `sponsored`.
 *  - `sponsored` / `own-key` run cloud runners AND on-device in parallel.
 *  - audio is birdnet-only in every mode.
 *
 * Returns abstract runner names; the caller maps them to concrete
 * runner-map keys.
 */
export type AiMode = 'sponsored' | 'own-key' | 'local';
export type MediaKind = 'photo' | 'audio' | 'video' | 'unknown';

export interface RunnerAvailability {
  plantnet: boolean;
  claude: boolean;
  phi: boolean;
  gemma: boolean;
  efficientNet: boolean;
  megaDetector: boolean;
  birdnet: boolean;
}

export interface ResolveInput {
  aiMode: AiMode;
  mediaKind: MediaKind;
  available: RunnerAvailability;
}

const ONDEVICE_PHOTO: Array<keyof RunnerAvailability> = [
  'megaDetector', 'efficientNet', 'phi', 'gemma',
];
const CLOUD_PHOTO: Array<keyof RunnerAvailability> = ['plantnet', 'claude'];

export function resolveRunnerSet(input: ResolveInput): string[] {
  const { aiMode, mediaKind, available } = input;

  if (mediaKind === 'audio') {
    return available.birdnet ? ['birdnet'] : [];
  }
  if (mediaKind !== 'photo') {
    return [];
  }

  const onDevice = ONDEVICE_PHOTO.filter((k) => available[k]);

  if (aiMode === 'local') {
    return onDevice; // [] → caller falls back to sponsored
  }

  const cloud = CLOUD_PHOTO.filter((k) => available[k]);
  return [...cloud, ...onDevice];
}
