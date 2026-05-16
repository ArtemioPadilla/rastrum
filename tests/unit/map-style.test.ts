/**
 * #1081 — ExploreMap was theme-aware (OpenFreeMap dark/liberty) while
 * MapPicker (share-obs) and CommunityMapView were hardcoded to `liberty`,
 * so dark mode showed an explore map that was dark next to bright-white
 * community / share maps. `basemapStyleUrl` is the shared, theme-aware
 * source of truth all three now consume.
 */
import { describe, it, expect, vi } from 'vitest';
import { basemapStyleUrl, installSpriteFallback } from '../../src/lib/map-style';

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

describe('installSpriteFallback (#1113)', () => {
  function fakeMap() {
    let handler: ((e: { id: string }) => void) | null = null;
    const images = new Set<string>();
    return {
      on: vi.fn((_type: string, fn: (e: { id: string }) => void) => { handler = fn; }),
      hasImage: (id: string) => images.has(id),
      addImage: vi.fn((id: string) => { images.add(id); }),
      fire: (id: string) => handler?.({ id }),
      images,
    };
  }

  it('subscribes to styleimagemissing', () => {
    const m = fakeMap();
    installSpriteFallback(m);
    expect(m.on).toHaveBeenCalledWith('styleimagemissing', expect.any(Function));
  });

  it('registers a 1x1 transparent fallback for a missing basemap icon', () => {
    const m = fakeMap();
    installSpriteFallback(m);
    m.fire('circle-11');
    expect(m.addImage).toHaveBeenCalledWith('circle-11', {
      width: 1,
      height: 1,
      data: new Uint8ClampedArray(4),
    });
    expect(m.images.has('circle-11')).toBe(true);
  });

  it('is idempotent — does not re-register an already-present image', () => {
    const m = fakeMap();
    installSpriteFallback(m);
    m.fire('circle-11');
    m.fire('circle-11');
    expect(m.addImage).toHaveBeenCalledTimes(1);
  });

  it('ignores a missing event with no id', () => {
    const m = fakeMap();
    installSpriteFallback(m);
    m.fire(undefined as unknown as string);
    expect(m.addImage).not.toHaveBeenCalled();
  });
});
