import { describe, it, expect } from 'vitest';
import { willDemote } from './photo-deletion';

describe('willDemote', () => {
  const photos = [
    { id: 'a', is_primary: true,  deleted_at: null },
    { id: 'b', is_primary: false, deleted_at: null },
    { id: 'c', is_primary: false, deleted_at: '2026-04-01T00:00:00Z' },
  ];

  it('deleting the only active photo demotes', () => {
    expect(willDemote([photos[0]], 'a')).toBe(true);
  });

  it('deleting the cascade (is_primary) photo demotes even with siblings', () => {
    expect(willDemote(photos, 'a')).toBe(true);
  });

  it('deleting a non-primary photo with active siblings does not demote', () => {
    expect(willDemote(photos, 'b')).toBe(false);
  });

  it('already-deleted siblings do not count toward "has siblings"', () => {
    // Only `a` (primary, active) and `c` (non-primary, soft-deleted) remain.
    // Deleting `a` would leave zero active photos → demote.
    expect(willDemote([photos[0], photos[2]], 'a')).toBe(true);
  });

  it('deleting an unknown id with active siblings does not demote', () => {
    expect(willDemote(photos, 'zzz')).toBe(false);
  });

  it('deleting an already-deleted photo with siblings does not demote', () => {
    // `c` is already soft-deleted; removing it again should be a no-op
    // and leave `a` + `b` active.
    expect(willDemote(photos, 'c')).toBe(false);
  });
});
