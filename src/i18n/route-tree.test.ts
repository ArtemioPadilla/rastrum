import { describe, it, expect } from 'vitest';
import { routeTree, getRouteLabel, getRouteParent } from './utils';

describe('routeTree', () => {
  it('contains every route key in `routes`', async () => {
    const { routes } = await import('./utils');
    for (const key of Object.keys(routes)) {
      expect(routeTree[key], `missing routeTree entry for ${key}`).toBeDefined();
    }
  });

  it('maps explore subroutes to the explore parent', () => {
    expect(getRouteParent('exploreMap')).toBe('explore');
    expect(getRouteParent('exploreRecent')).toBe('explore');
    expect(getRouteParent('exploreWatchlist')).toBe('explore');
    expect(getRouteParent('exploreSpecies')).toBe('explore');
  });

  it('returns localized labels for known routes', () => {
    expect(getRouteLabel('observe', 'en')).toBe('Observe');
    expect(getRouteLabel('observe', 'es')).toBe('Observar');
    expect(getRouteLabel('exploreMap', 'en')).toBe('Map');
    expect(getRouteLabel('exploreMap', 'es')).toBe('Mapa');
  });

  it('falls back to the route key when no label is registered', () => {
    expect(getRouteLabel('definitely-not-a-route', 'en')).toBe('definitely-not-a-route');
  });

  it('top-level routes have no parent', () => {
    expect(getRouteParent('observe')).toBeUndefined();
    expect(getRouteParent('chat')).toBeUndefined();
  });
});
