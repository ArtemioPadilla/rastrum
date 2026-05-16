/**
 * #1075 — observation card thumbnails were empty on list/grid surfaces
 * (home "Ve a buscar"/"Cerca de ti", /explore/recent?view=list,
 * /explore/species grid) because those loaders only read `media_files.url`
 * and ignored `thumbnail_url`, while the working /share/obs/ gallery falls
 * back across both. `pickCardImageUrl` is the shared fix.
 */
import { describe, it, expect } from 'vitest';
import { pickCardImageUrl } from '../../src/lib/media-url';

describe('pickCardImageUrl (#1075)', () => {
  it('prefers thumbnail_url when present', () => {
    expect(
      pickCardImageUrl({ url: 'https://media.rastrum.org/full', thumbnail_url: 'https://media.rastrum.org/thumb' }),
    ).toBe('https://media.rastrum.org/thumb');
  });

  it('falls back to url when thumbnail_url is null/empty (the bug)', () => {
    expect(pickCardImageUrl({ url: 'https://media.rastrum.org/full', thumbnail_url: null }))
      .toBe('https://media.rastrum.org/full');
    expect(pickCardImageUrl({ url: 'https://media.rastrum.org/full', thumbnail_url: '   ' }))
      .toBe('https://media.rastrum.org/full');
  });

  it('returns null when neither is usable so callers render a placeholder', () => {
    expect(pickCardImageUrl({ url: null, thumbnail_url: null })).toBeNull();
    expect(pickCardImageUrl({ url: '', thumbnail_url: '' })).toBeNull();
    expect(pickCardImageUrl(null)).toBeNull();
    expect(pickCardImageUrl(undefined)).toBeNull();
  });

  it('handles extension-less media.rastrum.org objects (still a valid 200)', () => {
    expect(pickCardImageUrl({ url: 'https://media.rastrum.org/obs/abc123', thumbnail_url: null }))
      .toBe('https://media.rastrum.org/obs/abc123');
  });
});
