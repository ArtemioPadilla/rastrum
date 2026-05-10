/**
 * Unit tests for the Discover feed page (#865).
 *
 * Tests cover:
 *   - i18n keys exist in en.json and es.json
 *   - routes object has 'discover' route for both locales
 *   - discover route is separate from communityObservers
 *   - section labels are defined
 */
import { describe, it, expect } from 'vitest';
import enJson from '../../src/i18n/en.json';
import esJson from '../../src/i18n/es.json';
import { routes } from '../../src/i18n/utils';

describe('Discover feed i18n (en)', () => {
  const dc = (enJson as unknown as { discover: Record<string, string> }).discover;

  it('en.json has discover object', () => {
    expect(dc).toBeDefined();
  });

  it('has title', () => {
    expect(dc?.title).toBeTruthy();
  });

  it('has section_followed', () => {
    expect(dc?.section_followed).toBeTruthy();
  });

  it('has section_nearby', () => {
    expect(dc?.section_nearby).toBeTruthy();
  });

  it('has section_trending', () => {
    expect(dc?.section_trending).toBeTruthy();
  });

  it('has sign_in_hint', () => {
    expect(dc?.sign_in_hint).toBeTruthy();
  });
});

describe('Discover feed i18n (es)', () => {
  const dc = (esJson as unknown as { discover: Record<string, string> }).discover;

  it('es.json has discover object', () => {
    expect(dc).toBeDefined();
  });

  it('es title is different from en', () => {
    const enDc = (enJson as unknown as { discover: Record<string, string> }).discover;
    expect(dc?.title).not.toBe(enDc?.title);
  });

  it('es has section_followed', () => {
    expect(dc?.section_followed).toBeTruthy();
  });
});

describe('Discover route in i18n/utils.ts', () => {
  it('routes.discover is defined', () => {
    expect(routes.discover).toBeDefined();
  });

  it('routes.discover.en is /discover', () => {
    expect(routes.discover?.en).toBe('/discover');
  });

  it('routes.discover.es is /descubrir', () => {
    expect(routes.discover?.es).toBe('/descubrir');
  });

  it('discover route is different from communityObservers', () => {
    expect(routes.discover?.en).not.toBe(routes.communityObservers?.en);
    expect(routes.discover?.es).not.toBe(routes.communityObservers?.es);
  });
});
