import { describe, it, expect } from 'vitest';
import { renderProgressiveCardHtml, type CardStrings } from './observe-card-render';
import type { CardViewModel } from './observe-card-vm';

const S: CardStrings = {
  analyzing: 'Identifying on your device…',
  savedPrefix: 'saved',
  bestGuess: 'best guess',
  lowConfidence: 'low confidence',
  improvedByCloud: 'improved by cloud',
  yourId: 'your ID',
  cloudSuggests: 'The cloud suggests a different identification.',
  unidentified: 'Unidentified',
  willIdentifyOnSync: 'will identify on sync',
  viewTrace: 'view trace',
  provenanceDevice: 'device',
  provenanceCloud: 'cloud',
  provenanceCommunity: 'community',
};
const vm = (o: Partial<CardViewModel>): CardViewModel => ({
  state: 'S0', sovereignty: 'none', trace: [], headline: null, sourceLabel: null, ...o,
});

describe('renderProgressiveCardHtml', () => {
  it('S0 shows the analyzing line', () => {
    const h = renderProgressiveCardHtml(vm({ state: 'S0' }), S);
    expect(h).toContain('Identifying on your device');
    expect(h).toContain('data-card-state="S0"');
  });
  it('S1a is the collapsed confident row with headline + sourceLabel + view trace', () => {
    const h = renderProgressiveCardHtml(vm({ state: 'S1a', headline: 'Quercus rugosa', sourceLabel: 'plantnet · 94%' }), S);
    expect(h).toContain('Quercus rugosa');
    expect(h).toContain('plantnet · 94%');
    expect(h).toContain('saved');
    expect(h).toContain('data-card-trace');
    expect(h).toContain('emerald');
  });
  it('S1b is the amber question with provenance strip', () => {
    const h = renderProgressiveCardHtml(vm({ state: 'S1b', headline: 'Quercus sp.' }), S);
    expect(h).toContain('¿Quercus sp.?');
    expect(h).toContain('best guess');
    expect(h).toContain('amber');
    expect(h).toContain('device');
    expect(h).toContain('cloud');
    expect(h).toContain('community');
  });
  it('S2 shows improved-by-cloud with headline + sourceLabel', () => {
    const h = renderProgressiveCardHtml(vm({ state: 'S2', headline: 'Quercus rugosa', sourceLabel: 'plantnet · 94%' }), S);
    expect(h).toContain('Quercus rugosa');
    expect(h).toContain('improved by cloud');
    expect(h).toContain('plantnet · 94%');
  });
  it('S2prime shows the observer ID + a cloud-suggestion box', () => {
    const h = renderProgressiveCardHtml(vm({ state: 'S2prime', headline: 'Quercus crassifolia' }), S);
    expect(h).toContain('Quercus crassifolia');
    expect(h).toContain('your ID');
    expect(h).toContain('The cloud suggests a different identification.');
  });
  it('S3 shows unidentified + will-identify-on-sync, never blocks', () => {
    const h = renderProgressiveCardHtml(vm({ state: 'S3' }), S);
    expect(h).toContain('Unidentified');
    expect(h).toContain('will identify on sync');
  });
  it('escapes HTML in headline/sourceLabel (no injection)', () => {
    const h = renderProgressiveCardHtml(vm({ state: 'S1a', headline: '<img src=x onerror=1>', sourceLabel: 'a&b' }), S);
    expect(h).not.toContain('<img src=x');
    expect(h).toContain('&lt;img');
    expect(h).toContain('a&amp;b');
  });
});
