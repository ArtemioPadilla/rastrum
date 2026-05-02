import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { showKarmaToast, _resetToastContainer, type KarmaToast } from './karma-toast';

function makeToast(overrides: Partial<KarmaToast> = {}): KarmaToast {
  return {
    delta: 5,
    reason: 'consensus_win',
    label: 'Consensus win',
    timestamp: Date.now(),
    ...overrides,
  };
}

describe('showKarmaToast', () => {
  beforeEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
  });

  afterEach(() => {
    _resetToastContainer();
    document.body.innerHTML = '';
  });

  it('creates the toast container on first call', () => {
    expect(document.getElementById('karma-toast-container')).toBeNull();
    showKarmaToast(makeToast());
    const container = document.getElementById('karma-toast-container');
    expect(container).not.toBeNull();
    expect(container?.parentElement).toBe(document.body);
  });

  it('reuses the same container on subsequent calls', () => {
    showKarmaToast(makeToast());
    showKarmaToast(makeToast({ delta: 1, reason: 'observation_synced', label: 'Observation synced' }));
    const containers = document.querySelectorAll('#karma-toast-container');
    expect(containers.length).toBe(1);
    expect(containers[0].children.length).toBe(2);
  });

  it('applies emerald styling for positive delta', () => {
    showKarmaToast(makeToast({ delta: 10 }));
    const el = document.querySelector('#karma-toast-container > div');
    expect(el).not.toBeNull();
    expect(el?.className).toContain('bg-emerald-100');
    expect(el?.className).toContain('text-emerald-800');
    expect(el?.textContent).toContain('+10 karma');
  });

  it('applies red styling for negative delta', () => {
    showKarmaToast(makeToast({ delta: -2, reason: 'consensus_loss', label: 'Consensus loss' }));
    const el = document.querySelector('#karma-toast-container > div');
    expect(el).not.toBeNull();
    expect(el?.className).toContain('bg-red-100');
    expect(el?.className).toContain('text-red-800');
    expect(el?.textContent).toContain('-2 karma');
  });

  it('renders the label in the toast text', () => {
    showKarmaToast(makeToast({ delta: 10, label: 'First in Rastrum' }));
    const el = document.querySelector('#karma-toast-container > div');
    expect(el?.textContent).toContain('First in Rastrum');
  });

  it('rounds fractional deltas', () => {
    showKarmaToast(makeToast({ delta: 0.5, label: 'Comment reaction' }));
    const el = document.querySelector('#karma-toast-container > div');
    expect(el?.textContent).toContain('+1 karma');
  });
});
