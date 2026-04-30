import { describe, it, expect } from 'vitest';
import { getAlternateUrl } from './utils';

describe('getAlternateUrl', () => {
  it('swaps observe to observar', () => {
    expect(getAlternateUrl('/en/observe/', 'es')).toBe('/es/observar/');
    expect(getAlternateUrl('/es/observar/', 'en')).toBe('/en/observe/');
  });

  it('handles homepage', () => {
    expect(getAlternateUrl('/en/', 'es')).toBe('/es/');
    expect(getAlternateUrl('/es/', 'en')).toBe('/en/');
  });

  it('preserves shared paths like /docs/', () => {
    expect(getAlternateUrl('/en/docs/architecture/', 'es')).toBe('/es/docs/architecture/');
  });

  it('falls through unmapped paths via locale prefix swap', () => {
    expect(getAlternateUrl('/en/some/random/', 'es')).toBe('/es/some/random/');
  });

  it('swaps identify/observe to observar/observe (consolidated routes)', () => {
    // After #273: /identify redirects to /observe; routes.identify → /observe
    // getAlternateUrl for /en/observe → /es/observar (via routes.identify key)
    expect(getAlternateUrl('/en/observe/', 'es')).toBe('/es/observar/');
    expect(getAlternateUrl('/es/observar/', 'en')).toBe('/en/observe/');
  });

  it('swaps explore map subroute', () => {
    expect(getAlternateUrl('/en/explore/map/', 'es')).toBe('/es/explorar/mapa/');
    expect(getAlternateUrl('/es/explorar/mapa/', 'en')).toBe('/en/explore/map/');
  });

  it('returns same-lang url when targetLang matches current', () => {
    expect(getAlternateUrl('/en/observe/', 'en')).toBe('/en/observe/');
  });

  it('returns locale-less paths unchanged (auth callback)', () => {
    expect(getAlternateUrl('/auth/callback/', 'es')).toBe('/auth/callback/');
    expect(getAlternateUrl('/auth/callback/', 'en')).toBe('/auth/callback/');
  });

  it('returns locale-less paths unchanged (share obs)', () => {
    expect(getAlternateUrl('/share/obs/', 'es')).toBe('/share/obs/');
    expect(getAlternateUrl('/share/obs/', 'en')).toBe('/share/obs/');
  });
});
