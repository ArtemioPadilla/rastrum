import { describe, it, expect } from 'vitest';
import { isPlantLikeHint } from '../../supabase/functions/identify/_helpers';

describe('isPlantLikeHint (#580)', () => {
  it.each([
    [undefined, true],
    ['', true],
    ['plant', true],
    ['fungi', true],
    ['unknown', true],
    ['animal', false],
  ])('isPlantLikeHint(%j) === %s', (hint, expected) => {
    expect(isPlantLikeHint(hint as string | undefined)).toBe(expected);
  });
});
