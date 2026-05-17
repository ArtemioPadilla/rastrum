import { describe, it, expect } from 'vitest';
import { cardActions } from './observe-card-actions';

describe('cardActions', () => {
  it('S1b exposes affirm/other/review', () => {
    expect(cardActions('S1b')).toEqual(['affirm', 'other', 'review']);
  });
  it('S2 exposes affirm/other/review', () => {
    expect(cardActions('S2')).toEqual(['affirm', 'other', 'review']);
  });
  it('S2prime exposes adopt/dismiss', () => {
    expect(cardActions('S2prime')).toEqual(['adopt', 'dismiss']);
  });
  it('S3 exposes other/review', () => {
    expect(cardActions('S3')).toEqual(['other', 'review']);
  });
  it('S0 exposes nothing', () => {
    expect(cardActions('S0')).toEqual([]);
  });
  it('S1a exposes nothing', () => {
    expect(cardActions('S1a')).toEqual([]);
  });
});
