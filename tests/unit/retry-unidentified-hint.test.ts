import { describe, it, expect } from 'vitest';
import { deriveHint } from '../../supabase/functions/retry-unidentified/_helpers';

describe('retry-unidentified deriveHint (#590)', () => {
  it.each([
    [null, 'unknown'],
    [undefined, 'unknown'],
    ['', 'unknown'],
    ['plant_observation', 'plant'],
    ['fungi_observation', 'fungi'],
    ['camera_trap', 'animal'],
    ['direct_sighting', 'animal'],
    ['tracks', 'animal'],
    ['scat', 'animal'],
    ['sound', 'animal'],
    ['unknown_type', 'unknown'],
  ])('deriveHint(%j) === %s', (evidenceType, expected) => {
    expect(deriveHint(evidenceType as string | null | undefined)).toBe(expected);
  });
});
