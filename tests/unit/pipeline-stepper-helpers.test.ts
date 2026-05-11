import { describe, it, expect } from 'vitest';

import {
  collapseStates,
  deriveSteps,
  type StepState,
} from '../../src/components/PipelineStepper.helpers';
import type { PipelineNode, NodeKind, NodeState } from '../../src/lib/pipeline-engine';

// Tiny factory so the test cases stay focused on the state surface, not on
// the unrelated PipelineNode bookkeeping fields.
function node(kind: NodeKind, state: NodeState, id = `${kind}-${state}`): PipelineNode {
  return { id, kind, state, label: kind } as PipelineNode;
}

describe('collapseStates', () => {
  it('returns "pending" for an empty stage', () => {
    expect(collapseStates([])).toBe<StepState>('pending');
  });

  it('returns "running" when any node is running (running dominates failed)', () => {
    expect(
      collapseStates([
        node('identify', 'running'),
        node('identify', 'failed'),
      ]),
    ).toBe<StepState>('running');
  });

  it('returns "failed" when any node is failed and none are running', () => {
    expect(
      collapseStates([
        node('identify', 'failed'),
        node('identify', 'done'),
      ]),
    ).toBe<StepState>('failed');
  });

  it('returns "failed" when any node is aborted (treats aborted as failed)', () => {
    expect(
      collapseStates([
        node('identify', 'aborted'),
        node('identify', 'done'),
      ]),
    ).toBe<StepState>('failed');
  });

  it('returns "done" only when every node is done', () => {
    expect(
      collapseStates([
        node('identify', 'done'),
        node('merge', 'done'),
      ]),
    ).toBe<StepState>('done');
  });

  it('returns "skipped" only when every node is skipped', () => {
    expect(
      collapseStates([
        node('identify', 'skipped'),
        node('merge', 'skipped'),
      ]),
    ).toBe<StepState>('skipped');
  });

  it('returns "running" for partial done (still going)', () => {
    expect(
      collapseStates([
        node('identify', 'done'),
        node('merge', 'pending'),
      ]),
    ).toBe<StepState>('running');
  });

  it('returns "pending" when all nodes are pending', () => {
    expect(
      collapseStates([
        node('input', 'pending'),
      ]),
    ).toBe<StepState>('pending');
  });
});

describe('deriveSteps', () => {
  it('maps a fresh 5-node graph to all-pending stages', () => {
    const nodes: PipelineNode[] = [
      node('input', 'pending'),
      node('identify', 'pending'),
      node('merge', 'pending'),
      node('location', 'pending'),
      node('save', 'pending'),
    ];
    const out = deriveSteps(nodes);
    expect(out.photo.state).toBe<StepState>('pending');
    expect(out.identify.state).toBe<StepState>('pending');
    expect(out.save.state).toBe<StepState>('pending');
  });

  it('input done + identify running → photo done, identify running, save pending', () => {
    const nodes: PipelineNode[] = [
      node('input', 'done'),
      node('identify', 'running'),
      node('merge', 'pending'),
      node('location', 'pending'),
      node('save', 'pending'),
    ];
    const out = deriveSteps(nodes);
    expect(out.photo.state).toBe<StepState>('done');
    expect(out.identify.state).toBe<StepState>('running');
    expect(out.save.state).toBe<StepState>('pending');
  });

  it('any identify failure surfaces as identify=failed', () => {
    const nodes: PipelineNode[] = [
      node('input', 'done'),
      node('identify', 'failed'),
      node('merge', 'done'),
      node('location', 'done'),
      node('save', 'pending'),
    ];
    const out = deriveSteps(nodes);
    expect(out.identify.state).toBe<StepState>('failed');
  });

  it('save step folds the location node into its detail popover', () => {
    const nodes: PipelineNode[] = [
      node('input', 'done'),
      node('identify', 'done'),
      node('merge', 'done'),
      node('location', 'done', 'loc-1'),
      node('save', 'pending', 'save-1'),
    ];
    const out = deriveSteps(nodes);
    // partial done in the save+location stage → 'running' per the
    // collapse rule; the IDs prove the location node is included.
    expect(out.save.state).toBe<StepState>('running');
    expect(out.save.nodes.map((n) => n.id)).toEqual(['save-1', 'loc-1']);
  });

  it('all-done graph → every stage done', () => {
    const nodes: PipelineNode[] = [
      node('input', 'done'),
      node('identify', 'done'),
      node('merge', 'done'),
      node('location', 'done'),
      node('save', 'done'),
    ];
    const out = deriveSteps(nodes);
    expect(out.photo.state).toBe<StepState>('done');
    expect(out.identify.state).toBe<StepState>('done');
    expect(out.save.state).toBe<StepState>('done');
  });

  it('skipped identify → identify=skipped, save still works', () => {
    const nodes: PipelineNode[] = [
      node('input', 'done'),
      node('identify', 'skipped'),
      node('merge', 'skipped'),
      node('location', 'done'),
      node('save', 'pending'),
    ];
    const out = deriveSteps(nodes);
    expect(out.identify.state).toBe<StepState>('skipped');
    // save+location: location done, save pending → partial done → running
    expect(out.save.state).toBe<StepState>('running');
  });
});
