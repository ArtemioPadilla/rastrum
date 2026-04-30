import { describe, it, expect } from 'vitest';
import { publicProfileHref } from '../../src/lib/community';

describe('publicProfileHref', () => {
  it('uses querystring form, not path-segment form', () => {
    expect(publicProfileHref('/en/u', 'art')).toBe('/en/u/?username=art');
    expect(publicProfileHref('/es/u', 'art')).toBe('/es/u/?username=art');
  });

  it('encodes handles with reserved chars', () => {
    expect(publicProfileHref('/en/u', 'maría_núñez')).toMatch(/\?username=mar%C3%ADa_n%C3%BA%C3%B1ez$/);
    expect(publicProfileHref('/en/u', 'a/b')).toBe('/en/u/?username=a%2Fb');
  });

  it('preserves the locale-prefixed base', () => {
    expect(publicProfileHref('/en/u', 'foo')).toMatch(/^\/en\/u\//);
    expect(publicProfileHref('/es/u', 'foo')).toMatch(/^\/es\/u\//);
  });
});
