/**
 * #1081 — ExploreMap was theme-aware (OpenFreeMap dark/liberty) while
 * MapPicker (share-obs) and CommunityMapView were hardcoded to `liberty`,
 * so dark mode showed an explore map that was dark next to bright-white
 * community / share maps. `basemapStyleUrl` is the shared, theme-aware
 * source of truth all three now consume.
 */
import { describe, it, expect } from 'vitest';
import { basemapStyleUrl } from '../../src/lib/map-style';

describe('basemapStyleUrl (#1081)', () => {
  it('returns the dark OpenFreeMap style in dark mode', () => {
    expect(basemapStyleUrl(true)).toBe('https://tiles.openfreemap.org/styles/dark');
  });

  it('returns the light (liberty) OpenFreeMap style in light mode', () => {
    expect(basemapStyleUrl(false)).toBe('https://tiles.openfreemap.org/styles/liberty');
  });

  it('is a single source of truth — light and dark differ', () => {
    expect(basemapStyleUrl(true)).not.toBe(basemapStyleUrl(false));
  });
});
