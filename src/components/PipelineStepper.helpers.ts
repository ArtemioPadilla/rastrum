/**
 * PipelineStepper.helpers.ts
 *
 * Pure helpers for collapsing the 5-node pipeline graph into the 3 stepper
 * stages (photo → identify → save). Extracted from PipelineStepper.astro
 * so the derivation logic is unit-testable in isolation.
 *
 * Mapping:
 *   photo    ← input nodes
 *   identify ← identify + merge nodes
 *   save     ← save + location nodes (location is shown only in the save-step
 *              detail popover; it does not own its own stepper visual)
 *
 * Collapse rules (preserved from the original inline implementation):
 *   - empty             → 'pending'
 *   - any running       → 'running'
 *   - any failed        → 'failed'   (fires after running so a failed sibling
 *                                     of an in-flight node still surfaces)
 *   - all done          → 'done'
 *   - all skipped       → 'skipped'
 *   - some done         → 'running'  (partial done = still going)
 *   - otherwise         → 'pending'
 *
 * Part of #942 — Observation form redesign.
 */

import type { PipelineNode } from '../lib/pipeline-engine';

export type StepId = 'photo' | 'identify' | 'save';
export type StepState = 'pending' | 'running' | 'done' | 'failed' | 'skipped';

export interface StepDerived {
  state: StepState;
  /** Underlying nodes that belong to this stage; rendered into the detail popover. */
  nodes: PipelineNode[];
}

export type DerivedSteps = Record<StepId, StepDerived>;

export function collapseStates(nodes: PipelineNode[]): StepState {
  if (!nodes.length) return 'pending';
  if (nodes.some((n) => n.state === 'running')) return 'running';
  if (nodes.some((n) => n.state === 'failed' || n.state === 'aborted')) return 'failed';
  if (nodes.every((n) => n.state === 'done')) return 'done';
  if (nodes.every((n) => n.state === 'skipped')) return 'skipped';
  if (nodes.some((n) => n.state === 'done')) return 'running';
  return 'pending';
}

export function deriveSteps(nodes: PipelineNode[]): DerivedSteps {
  const inputNodes = nodes.filter((n) => n.kind === 'input');
  const identNodes = nodes.filter((n) => n.kind === 'identify' || n.kind === 'merge');
  const locationNodes = nodes.filter((n) => n.kind === 'location');
  const saveNodes = nodes.filter((n) => n.kind === 'save');

  const saveNodesToShow = [...saveNodes, ...locationNodes];

  return {
    photo: { state: collapseStates(inputNodes), nodes: inputNodes },
    identify: { state: collapseStates(identNodes), nodes: identNodes },
    save: { state: collapseStates(saveNodesToShow), nodes: saveNodesToShow },
  };
}
