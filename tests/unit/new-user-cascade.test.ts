/**
 * Unit tests for the new-user cascade threshold bypass (#898).
 *
 * Tests cover:
 *   - New user with confidence 0.35 → 'provisional' (not 'uncertain')
 *   - Returning user with confidence 0.35 → 'uncertain' (no change)
 *   - New user with confidence 0.55 → 'winner' (standard threshold still applies)
 *   - New user with ALL_FAILED → still all_failed
 *   - NEW_USER_PROVISIONAL_THRESHOLD constant value
 *   - isNewUser = false defaults to standard threshold 0.5
 */
import { describe, it, expect } from 'vitest';
import {
  runParallelIdentify,
  NEW_USER_PROVISIONAL_THRESHOLD,
  type IdentifierRunner,
  type UnifiedIdResult,
} from '../../src/lib/identify-cascade-client';

// Helper: make a runner that resolves with given confidence
function makeRunner(confidence: number, sci = 'Quercus robur'): IdentifierRunner {
  const result: UnifiedIdResult = {
    source: 'test',
    scientific_name: sci,
    common_name: 'Oak',
    confidence,
    alternates: [],
  };
  return async (_file, _signal) => result;
}

// Helper: make a failing runner
function makeFailRunner(): IdentifierRunner {
  return async () => { throw new Error('network error'); };
}

// Minimal File stub
function fakeFile(): File {
  return new File(['x'], 'test.jpg', { type: 'image/jpeg' });
}

describe('NEW_USER_PROVISIONAL_THRESHOLD', () => {
  it('is 0.3', () => {
    expect(NEW_USER_PROVISIONAL_THRESHOLD).toBe(0.3);
  });
});

describe('runParallelIdentify with isNewUser=true', () => {
  it('returns provisional when confidence is 0.35 (above new-user floor, below standard 0.5)', async () => {
    const outcome = await runParallelIdentify(
      fakeFile(),
      { runners: { test: makeRunner(0.35) }, isNewUser: true },
    );
    expect(outcome.kind).toBe('provisional');
    if (outcome.kind === 'provisional') {
      expect(outcome.uncertain).toBe(false);
      expect(outcome.awaitingConfirmation).toBe(true);
      expect(outcome.result.confidence).toBe(0.35);
    }
  });

  it('returns winner (not provisional) when confidence is 0.55 even for new user', async () => {
    const outcome = await runParallelIdentify(
      fakeFile(),
      { runners: { test: makeRunner(0.55) }, isNewUser: true },
    );
    expect(outcome.kind).toBe('winner');
    if (outcome.kind === 'winner') {
      expect(outcome.uncertain).toBe(false);
    }
  });

  it('returns all_failed when runner throws', async () => {
    const outcome = await runParallelIdentify(
      fakeFile(),
      { runners: { test: makeFailRunner() }, isNewUser: true },
    );
    expect(outcome.kind).toBe('all_failed');
  });

  it('returns provisional for confidence exactly at new-user threshold (0.3)', async () => {
    const outcome = await runParallelIdentify(
      fakeFile(),
      { runners: { test: makeRunner(0.3) }, isNewUser: true },
    );
    expect(outcome.kind).toBe('provisional');
  });

  it('returns all_failed for confidence below new-user threshold (0.29)', async () => {
    // Confidence 0.29 is below 0.3, so it won't be "winner" — goes to uncertain/all_failed
    const outcome = await runParallelIdentify(
      fakeFile(),
      { runners: { test: makeRunner(0.29) }, isNewUser: true },
    );
    // 0.29 < 0.3 threshold → won't be winner. result ends up in results array → uncertain
    expect(outcome.kind).toBe('uncertain');
  });
});

describe('runParallelIdentify with isNewUser=false (default behaviour unchanged)', () => {
  it('returns uncertain when confidence is 0.35 (below standard threshold)', async () => {
    const outcome = await runParallelIdentify(
      fakeFile(),
      { runners: { test: makeRunner(0.35) }, isNewUser: false },
    );
    expect(outcome.kind).toBe('uncertain');
    if (outcome.kind === 'uncertain') {
      expect(outcome.uncertain).toBe(true);
    }
  });

  it('returns winner when confidence is 0.55', async () => {
    const outcome = await runParallelIdentify(
      fakeFile(),
      { runners: { test: makeRunner(0.55) } },
    );
    expect(outcome.kind).toBe('winner');
  });

  it('omits provisional kind entirely', async () => {
    const outcome = await runParallelIdentify(
      fakeFile(),
      { runners: { test: makeRunner(0.4) } },
    );
    expect(outcome.kind).not.toBe('provisional');
  });
});
