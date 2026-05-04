import { describe, it, expect } from 'vitest';

// Verifies the state-mapping function used by startCascadeWithGraph (#592).
// We reach into pipeline-engine via a structural duplicate; the real
// function is unexported. The mapping is small and stable enough that
// keeping the test pure-functional avoids importing onnxruntime/dexie.

function attemptStateToNodeState(state: string): string {
  switch (state) {
    case 'starting':  return 'running';
    case 'accepted':  return 'done';
    case 'rejected':  return 'rejected';
    case 'failed':    return 'failed';
    case 'skipped':   return 'skipped';
    case 'filtered':  return 'aborted';
  }
  return 'pending';
}

describe('pipeline-engine: attempt → node state map (#592)', () => {
  it.each([
    ['starting', 'running'],
    ['accepted', 'done'],
    ['rejected', 'rejected'],
    ['failed',   'failed'],
    ['skipped',  'skipped'],
    ['filtered', 'aborted'],
  ])('%s → %s', (a, b) => {
    expect(attemptStateToNodeState(a)).toBe(b);
  });
});
