import { describe, it, expect } from 'vitest';
import { parseGbifMatch, lookupGbif, type Lineage } from '../../supabase/functions/_shared/gbif';

const ARATINGA_OK = {
  usageKey: 2479045,
  scientificName: 'Aratinga canicularis (Linnaeus, 1758)',
  canonicalName: 'Aratinga canicularis',
  rank: 'SPECIES',
  status: 'ACCEPTED',
  matchType: 'EXACT',
  kingdom: 'Animalia',
  phylum: 'Chordata',
  class: 'Aves',
  order: 'Psittaciformes',
  family: 'Psittacidae',
  genus: 'Aratinga',
  species: 'Aratinga canicularis',
  synonym: false,
};

describe('parseGbifMatch', () => {
  it('extracts full lineage from a valid EXACT match', () => {
    const out = parseGbifMatch(ARATINGA_OK);
    expect(out).toEqual<Lineage>({
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Psittaciformes',
      family: 'Psittacidae',
      genus: 'Aratinga',
      matched_name: 'Aratinga canicularis',
      match_type: 'EXACT',
      rank: 'species',
    });
  });

  it('returns null when matchType is NONE', () => {
    expect(parseGbifMatch({ matchType: 'NONE', synonym: false })).toBeNull();
  });

  it('returns null when usageKey is missing', () => {
    expect(parseGbifMatch({ matchType: 'FUZZY', kingdom: 'Animalia' })).toBeNull();
  });

  it('handles partial lineage gracefully (HIGHERRANK match)', () => {
    const partial = parseGbifMatch({
      usageKey: 9311,
      matchType: 'HIGHERRANK',
      canonicalName: 'Psittacidae',
      rank: 'FAMILY',
      kingdom: 'Animalia',
      phylum: 'Chordata',
      class: 'Aves',
      order: 'Psittaciformes',
      family: 'Psittacidae',
    });
    expect(partial).not.toBeNull();
    expect(partial!.match_type).toBe('HIGHERRANK');
    expect(partial!.genus).toBeNull();
    expect(partial!.family).toBe('Psittacidae');
  });

  it('treats empty strings as null', () => {
    const out = parseGbifMatch({ ...ARATINGA_OK, genus: '', class: '   ' });
    expect(out!.genus).toBeNull();
    expect(out!.class).toBeNull();
  });

  it('rejects non-object inputs', () => {
    expect(parseGbifMatch(null)).toBeNull();
    expect(parseGbifMatch(undefined)).toBeNull();
    expect(parseGbifMatch('not json')).toBeNull();
    expect(parseGbifMatch(42)).toBeNull();
  });

  it('downcases the rank (GBIF returns SPECIES, we store species)', () => {
    expect(parseGbifMatch({ ...ARATINGA_OK, rank: 'SPECIES' })!.rank).toBe('species');
    expect(parseGbifMatch({ ...ARATINGA_OK, rank: 'Genus' })!.rank).toBe('genus');
  });

  it('coerces unrecognised matchType to UNKNOWN', () => {
    expect(parseGbifMatch({ ...ARATINGA_OK, matchType: 'WHATEVER' })!.match_type).toBe('UNKNOWN');
  });
});

describe('lookupGbif', () => {
  it('forwards the canonical name + extracts lineage when fetch succeeds', async () => {
    const fetcher = async (url: string | URL): Promise<Response> => {
      expect(String(url)).toContain('species/match');
      expect(String(url)).toContain('name=Aratinga+canicularis');
      return new Response(JSON.stringify(ARATINGA_OK), {
        status: 200, headers: { 'content-type': 'application/json' },
      });
    };
    const out = await lookupGbif('Aratinga canicularis', { fetcher: fetcher as typeof fetch });
    expect(out?.kingdom).toBe('Animalia');
    expect(out?.genus).toBe('Aratinga');
  });

  it('returns null on non-2xx responses', async () => {
    const fetcher = async () => new Response('boom', { status: 500 });
    const out = await lookupGbif('Anything', { fetcher: fetcher as typeof fetch });
    expect(out).toBeNull();
  });

  it('returns null on network errors / aborted requests', async () => {
    const fetcher = async () => { throw new TypeError('network failure'); };
    const out = await lookupGbif('Anything', { fetcher: fetcher as typeof fetch });
    expect(out).toBeNull();
  });

  it('returns null on unparseable JSON', async () => {
    const fetcher = async () => new Response('<html>oops</html>', { status: 200 });
    const out = await lookupGbif('Anything', { fetcher: fetcher as typeof fetch });
    expect(out).toBeNull();
  });
});
