import { describe, it, expect } from 'vitest';
import { resolveRunnerSet, type RunnerAvailability } from './observe-runner-set';

const none: RunnerAvailability = {
  plantnet: false, claude: false, phi: false, gemma: false,
  efficientNet: false, megaDetector: false, birdnet: false,
};

describe('resolveRunnerSet — local-first invariants', () => {
  it('local mode + photo runs available on-device photo runners, NO cloud', () => {
    const r = resolveRunnerSet({
      aiMode: 'local', mediaKind: 'photo',
      available: { ...none, efficientNet: true, megaDetector: true, phi: true, plantnet: true, claude: true },
    });
    expect(r).toContain('efficientNet');
    expect(r).toContain('phi');
    expect(r).toContain('megaDetector');
    expect(r).not.toContain('plantnet');
    expect(r).not.toContain('claude');
  });

  it('local mode + photo with nothing on-device returns [] (caller falls back)', () => {
    const r = resolveRunnerSet({
      aiMode: 'local', mediaKind: 'photo',
      available: { ...none, plantnet: true, claude: true },
    });
    expect(r).toEqual([]);
  });

  it('sponsored mode + photo runs cloud AND on-device in parallel', () => {
    const r = resolveRunnerSet({
      aiMode: 'sponsored', mediaKind: 'photo',
      available: { ...none, plantnet: true, claude: true, efficientNet: true },
    });
    expect(r).toEqual(expect.arrayContaining(['plantnet', 'claude', 'efficientNet']));
  });

  it('audio runs birdnet only, in any mode', () => {
    for (const aiMode of ['local', 'sponsored', 'own-key'] as const) {
      expect(
        resolveRunnerSet({ aiMode, mediaKind: 'audio', available: { ...none, birdnet: true, claude: true } }),
      ).toEqual(['birdnet']);
    }
  });

  it('own-key mode + photo excludes cloud claude when claude unavailable', () => {
    const r = resolveRunnerSet({
      aiMode: 'own-key', mediaKind: 'photo',
      available: { ...none, plantnet: true, claude: false, efficientNet: true },
    });
    expect(r).toContain('plantnet');
    expect(r).toContain('efficientNet');
    expect(r).not.toContain('claude');
  });

  it('unknown / unsupported media returns []', () => {
    expect(resolveRunnerSet({ aiMode: 'local', mediaKind: 'unknown', available: { ...none, efficientNet: true } })).toEqual([]);
  });
});
