import { describe, it, expect } from 'vitest';
import {
  parseFilters,
  serializeFilters,
  type CommunityFilters,
} from '../../src/lib/community-url';

describe('community-url', () => {
  it('parses an empty querystring to defaults', () => {
    expect(parseFilters('')).toEqual({
      sort: 'observation_count',
      country: null,
      taxa: [],
      experts: false,
      nearby: false,
      page: 1,
    });
  });

  it('round-trips a fully populated state', () => {
    const f: CommunityFilters = {
      sort: 'obs_count_30d',
      country: 'MX',
      taxa: ['Aves', 'Plantae'],
      experts: true,
      nearby: false,
      page: 2,
    };
    expect(parseFilters(serializeFilters(f))).toEqual(f);
  });

  it('drops unknown sort values silently (does not crash)', () => {
    expect(parseFilters('?sort=unknown_thing').sort).toBe('observation_count');
  });

  it('treats nearby=true as forcing sort=distance when no sort is given', () => {
    expect(parseFilters('?nearby=true')).toMatchObject({
      nearby: true,
      sort: 'distance',
    });
  });

  it('keeps an explicit sort even when nearby=true', () => {
    expect(parseFilters('?nearby=true&sort=species_count')).toMatchObject({
      nearby: true,
      sort: 'species_count',
    });
  });

  it('parses comma-separated taxa', () => {
    expect(parseFilters('?taxon=Aves,Plantae').taxa).toEqual(['Aves', 'Plantae']);
  });

  it('clamps page to >= 1', () => {
    expect(parseFilters('?page=0').page).toBe(1);
    expect(parseFilters('?page=-5').page).toBe(1);
    expect(parseFilters('?page=abc').page).toBe(1);
  });

  it('emits no key for empty arrays / nulls / defaults', () => {
    const f: CommunityFilters = {
      sort: 'observation_count',
      country: null,
      taxa: [],
      experts: false,
      nearby: false,
      page: 1,
    };
    expect(serializeFilters(f)).toBe('');
  });

  it('rejects invalid country codes', () => {
    expect(parseFilters('?country=mexico').country).toBe(null);
    expect(parseFilters('?country=MEX').country).toBe(null);
    expect(parseFilters('?country=MX').country).toBe('MX');
  });

  it('serializes country with leading question mark', () => {
    expect(serializeFilters({
      sort: 'observation_count',
      country: 'BR',
      taxa: [],
      experts: false,
      nearby: false,
      page: 1,
    })).toBe('?country=BR');
  });

  it('round-trips with experts and nearby together', () => {
    const f: CommunityFilters = {
      sort: 'distance',
      country: null,
      taxa: ['Aves'],
      experts: true,
      nearby: true,
      page: 1,
    };
    expect(parseFilters(serializeFilters(f))).toEqual(f);
  });
});
