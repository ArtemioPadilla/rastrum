import { describe, it, expect } from 'vitest';
import en from '../../src/i18n/en.json';
import es from '../../src/i18n/es.json';

describe('maps IA cleanup — i18n parity', () => {
  type Maybe = Record<string, unknown> | undefined;

  function get(obj: unknown, path: string): unknown {
    return path.split('.').reduce<unknown>((acc, key) =>
      (acc as Maybe)?.[key], obj);
  }

  const requiredKeys = [
    'nav.map',
    'nav.explore_dropdown.map',
    'nav.explore_megamenu.community_map',
    'map.title',
    'map.cross_link.prompt',
    'map.cross_link.cta',
    'community.map_title',
    'community.cross_link.prompt',
    'community.cross_link.cta',
  ];

  for (const key of requiredKeys) {
    it(`EN has ${key} populated`, () => {
      const v = get(en, key);
      expect(typeof v).toBe('string');
      expect((v as string).trim().length).toBeGreaterThan(0);
    });
    it(`ES has ${key} populated`, () => {
      const v = get(es, key);
      expect(typeof v).toBe('string');
      expect((v as string).trim().length).toBeGreaterThan(0);
    });
  }

  it('EN map labels are no longer the bare "Map"', () => {
    expect(get(en, 'nav.map')).not.toBe('Map');
    expect(get(en, 'nav.explore_dropdown.map')).not.toBe('Map');
    expect(get(en, 'nav.explore_megamenu.community_map')).not.toBe('Map');
    expect(get(en, 'map.title')).not.toBe('Map');
  });

  it('ES map labels are no longer the bare "Mapa"', () => {
    expect(get(es, 'nav.map')).not.toBe('Mapa');
    expect(get(es, 'nav.explore_dropdown.map')).not.toBe('Mapa');
    expect(get(es, 'nav.explore_megamenu.community_map')).not.toBe('Mapa');
    expect(get(es, 'map.title')).not.toBe('Mapa');
  });

  // `nav.map` (Footer) and `nav.explore_dropdown.map` (Header MegaMenu) both
  // link to /explore/map/ and so must show the SAME label. Drift here would
  // make the same page show different names depending on which surface the
  // user clicked from. Mirror invariant for both locales + assert vs the
  // page's own h1 (`map.title`) to catch a third-place drift.
  it('EN: nav.map, nav.explore_dropdown.map, map.title agree', () => {
    const a = get(en, 'nav.map');
    const b = get(en, 'nav.explore_dropdown.map');
    const c = get(en, 'map.title');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  it('ES: nav.map, nav.explore_dropdown.map, map.title agree', () => {
    const a = get(es, 'nav.map');
    const b = get(es, 'nav.explore_dropdown.map');
    const c = get(es, 'map.title');
    expect(a).toBe(b);
    expect(a).toBe(c);
  });

  // Same invariant for the observers map: nav.explore_megamenu.community_map
  // (Header) and community.map_title (the page itself) must agree.
  it('EN: community_map MegaMenu label matches community.map_title', () => {
    expect(get(en, 'nav.explore_megamenu.community_map'))
      .toBe(get(en, 'community.map_title'));
  });

  it('ES: community_map MegaMenu label matches community.map_title', () => {
    expect(get(es, 'nav.explore_megamenu.community_map'))
      .toBe(get(es, 'community.map_title'));
  });
});
